import sqlite3
import json
import os
import requests
from flask import Flask, render_template, request, jsonify, g, Response, send_from_directory
from flask_sock import Sock
from collections import defaultdict
from datetime import datetime

# --- CONFIGURAZIONE ---
app = Flask(__name__)
sock = Sock(app)
DATABASE = 'storage/database.db'
CONFIG_FILE = 'storage/config.json'
clients = []

# --- GESTIONE DATABASE ---
def get_db():
    db = getattr(g, '_database', None)
    if db is None:
        db = g._database = sqlite3.connect(DATABASE)
        db.row_factory = sqlite3.Row
    return db

@app.teardown_appcontext
def close_connection(exception):
    db = getattr(g, '_database', None)
    if db is not None:
        db.close()

# --- FUNZIONE PER WEB SOCKETS ---
def broadcast(message):
    for client in list(clients):
        try:
            client.send(json.dumps(message))
        except Exception:
            clients.remove(client)

# --- ROUTE E API ---
@app.route('/')
def index():
    return render_template('index.html')

# --- NUOVA ROUTE PER LA CARTELLA STORAGE ---
@app.route('/storage/<path:path>')
def send_storage_file(path):
    return send_from_directory('storage', path)

@sock.route('/ws')
def websocket(ws):
    clients.append(ws)
    try:
        while True:
            ws.receive(timeout=None)
    finally:
        if ws in clients:
            clients.remove(ws)

@app.route('/api/wms_proxy')
def wms_proxy():
    wms_params = request.args.to_dict()
    wms_server_url = wms_params.pop('wms_server_url', None)
    auth_type = wms_params.pop('authentication', 'none')
    if not wms_server_url:
        return "URL del server WMS mancante nel proxy", 400
    try:
        auth = None
        headers = {'User-Agent': 'QGIS/3.34.8'}
        if auth_type == 'basic':
            wms_user = wms_params.pop('username', None)
            wms_pass = wms_params.pop('password', None)
            if wms_user and wms_pass:
                auth = (wms_user, wms_pass)
        response = requests.get(wms_server_url, params=wms_params, headers=headers, auth=auth, stream=True, timeout=15, verify=False)
        response.raise_for_status()
        return Response(response.content, content_type=response.headers['content-type'])
    except requests.exceptions.RequestException as e:
        print(f"ERRORE PROXY WMS: {e}", flush=True)
        return f"Errore nella connessione al server WMS esterno: {e}", 502

@app.route('/api/wfs_proxy')
def wfs_proxy():
    params = request.args.to_dict()
    wfs_server_url = params.pop('wfs_server_url', None)
    auth_type = params.pop('authentication', 'none')
    if not wfs_server_url:
        return "URL del server WFS mancante nel proxy", 400
    try:
        auth = None
        headers = {'User-Agent': 'QGIS/3.34.8'}
        if auth_type == 'basic':
            wfs_user = params.pop('username', None)
            wfs_pass = params.pop('password', None)
            if wfs_user and wfs_pass:
                auth = (wfs_user, wfs_pass)
        response = requests.get(wfs_server_url, params=params, headers=headers, auth=auth, timeout=20, verify=False)
        response.raise_for_status()
        content_type = response.headers.get('content-type', '')
        if 'application/json' in content_type or 'text/json' in content_type:
            return jsonify(response.json())
        else:
            error_text = response.text
            print(f"RISPOSTA NON JSON DAL SERVER WFS:\n{error_text}")
            return jsonify({"error": "Il server WFS ha restituito una risposta non valida (non JSON).", "details": error_text}), 502
    except Exception as e:
        print(f"ERRORE PROXY WFS (generico): {e}", flush=True)
        return jsonify({"error": f"Errore generico nel proxy: {str(e)}"}), 502

@app.route('/api/config', methods=['GET', 'POST'])
def manage_config():
    if request.method == 'POST':
        try:
            new_config = request.json
            with open(CONFIG_FILE, 'w', encoding='utf-8') as f:
                json.dump(new_config, f, indent=4)
            broadcast({'type': 'config_updated', 'data': new_config})
            return jsonify({'status': 'success'})
        except Exception as e:
            return jsonify({'status': 'error', 'message': str(e)}), 500
    try:
        with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
            return jsonify(json.load(f))
    except FileNotFoundError:
        return jsonify({'error': 'File di configurazione non trovato sul server.'}), 404

@app.route('/api/logs', methods=['GET', 'POST'])
def manage_logs():
    db = get_db()
    if request.method == 'POST':
        log_data = request.json
        db.execute(
            'INSERT INTO logs (box_id, log_timestamp, ship, color_code, import_id) VALUES (?, ?, ?, ?, ?)',
            (log_data['boxId'], log_data['timestamp'], log_data['ship'], log_data['colorCode'], 'manual')
        )
        db.commit()
        log_cursor = db.execute('SELECT * FROM logs WHERE box_id = ? ORDER BY log_timestamp DESC', (log_data['boxId'],)).fetchall()
        updated_box_history = [dict(row) for row in log_cursor]
        broadcast({'type': 'box_history_updated', 'boxId': log_data['boxId'], 'data': updated_box_history})
        return jsonify({'status': 'success'})
    
    logs_cursor = db.execute('SELECT * FROM logs ORDER BY box_id, log_timestamp DESC').fetchall()
    logs_by_box = defaultdict(list)
    for row in logs_cursor:
        logs_by_box[row['box_id']].append(dict(row))
    return jsonify(logs_by_box)

@app.route('/api/logs/import', methods=['POST'])
def import_logs_batch():
    csv_text = request.data.decode('utf-8')
    import_id = f"import-{int(datetime.now().timestamp())}"
    logs_to_insert = []
    
    righe = csv_text.split('\n')
    for riga in righe:
        if not riga.strip() or riga.lower().startswith('timestamp;box'):
            continue
        parts = riga.strip().split(';')
        if len(parts) >= 4:
            timestamp, box_id, ship, color_code = parts[0], parts[1], parts[2], parts[3]
            logs_to_insert.append((box_id.upper(), timestamp, ship, color_code, import_id))

    if logs_to_insert:
        db = get_db()
        db.executemany(
            'INSERT INTO logs (box_id, log_timestamp, ship, color_code, import_id) VALUES (?, ?, ?, ?, ?)',
            logs_to_insert
        )
        db.commit()
        # Recupera tutti i log aggiornati e broadcast
        logs_cursor = db.execute('SELECT * FROM logs ORDER BY box_id, log_timestamp DESC').fetchall()
        logs_by_box = defaultdict(list)
        for row in logs_cursor:
            logs_by_box[row['box_id']].append(dict(row))
        
        broadcast({'type': 'all_logs_updated', 'data': dict(logs_by_box), 'import_id': import_id})
    
    return jsonify({'status': 'success', 'imported_count': len(logs_to_insert), 'import_id': import_id})

@app.route('/api/logs/batch_delete', methods=['POST'])
def delete_logs_batch():
    data = request.json
    db = get_db()
    
    if 'log_ids' in data and data['log_ids']:
        placeholders = ', '.join('?' for _ in data['log_ids'])
        db.execute(f"DELETE FROM logs WHERE id IN ({placeholders})", data['log_ids'])
    elif 'import_id' in data:
        db.execute("DELETE FROM logs WHERE import_id = ?", (data['import_id'],))
    
    db.commit()
    # Recupera tutti i log aggiornati e broadcast
    logs_cursor = db.execute('SELECT * FROM logs ORDER BY box_id, log_timestamp DESC').fetchall()
    logs_by_box = defaultdict(list)
    for row in logs_cursor:
        logs_by_box[row['box_id']].append(dict(row))
    broadcast({'type': 'all_logs_updated', 'data': dict(logs_by_box)})
    return jsonify({'status': 'success'})

@app.route('/api/imports', methods=['GET'])
def get_imports():
    db = get_db()
    cursor = db.execute("SELECT DISTINCT import_id FROM logs WHERE import_id IS NOT NULL AND import_id != 'manual'")
    imports = [row['import_id'] for row in cursor.fetchall()]
    return jsonify(imports)

@app.route('/api/logs/<int:log_id>', methods=['PUT', 'DELETE'])
def manage_single_log(log_id):
    db = get_db()
    log_to_manage = db.execute('SELECT box_id FROM logs WHERE id = ?', (log_id,)).fetchone()
    if not log_to_manage: return jsonify({'status': 'error', 'message': 'Log non trovato'}), 404
    box_id = log_to_manage['box_id']
    if request.method == 'PUT':
        log_data = request.json
        db.execute(
            'UPDATE logs SET log_timestamp = ?, ship = ?, color_code = ? WHERE id = ?',
            (log_data['timestamp'], log_data['ship'], log_data['colorCode'], log_id)
        )
    elif request.method == 'DELETE':
        db.execute('DELETE FROM logs WHERE id = ?', (log_id,))
    db.commit()
    log_cursor = db.execute('SELECT * FROM logs WHERE box_id = ? ORDER BY log_timestamp DESC', (box_id,)).fetchall()
    updated_box_history = [dict(row) for row in log_cursor]
    broadcast({'type': 'box_history_updated', 'boxId': box_id, 'data': updated_box_history})
    return jsonify({'status': 'success'})

@app.route('/api/logs/reset', methods=['POST'])
def reset_logs():
    db = get_db()
    db.execute('DELETE FROM logs')
    db.commit()
    # Recupera tutti i log (saranno vuoti) e broadcast
    logs_by_box = defaultdict(list)
    broadcast({'type': 'all_logs_updated', 'data': dict(logs_by_box)})
    return jsonify({'status': 'success'})

# BLOCCO DI AVVIO SERVER
if __name__ == '__main__':
    if not os.path.exists('storage'):
        os.makedirs('storage')
        
    if not os.path.exists(CONFIG_FILE):
        print(f"File '{CONFIG_FILE}' non trovato. Creazione di una configurazione di default.")
        default_config = {
            "grid_bounds": {"lat_start": 46.5, "lon_start": 12.0, "lat_end": 40.0, "lon_end": 20.0},
            "base_map": {"url_template": "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", "attribution": "&copy; OpenStreetMap contributors"},
            "external_layers": []
        }
        with open(CONFIG_FILE, 'w', encoding='utf-8') as f:
            json.dump(default_config, f, indent=4)

    app.run(debug=True, host='0.0.0.0', port=5000)
