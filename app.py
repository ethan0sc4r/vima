import sqlite3
import json
import os
import requests
from flask import Flask, render_template, request, jsonify, g, Response
from flask_sock import Sock
from collections import defaultdict
from datetime import datetime

# --- CONFIGURAZIONE ---
app = Flask(__name__)
sock = Sock(app)
DATABASE = 'storage/database.db'
CONFIG_FILE = 'config.json'
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
    """Invia un messaggio a tutti i client connessi."""
    disconnected_clients = []
    for client in list(clients):
        try:
            client.send(json.dumps(message))
        except Exception:
            disconnected_clients.append(client)
    for client in disconnected_clients:
        clients.remove(client)

# --- ROUTE E API ---
@app.route('/')
def index():
    """Serve la pagina web principale."""
    return render_template('index.html')

@sock.route('/ws')
def websocket(ws):
    """Gestisce le connessioni WebSocket in entrata."""
    print(f"Nuovo client connesso al WebSocket. Totale client: {len(clients) + 1}")
    clients.append(ws)
    try:
        while True:
            # Mantiene la connessione attiva. Il client non invia dati.
            ws.receive(timeout=None)
    except Exception:
        print(f"Client WebSocket disconnesso. Totale client: {len(clients) - 1}")
    finally:
        if ws in clients:
            clients.remove(ws)

@app.route('/api/wms_proxy')
def wms_proxy():
    """Funziona come un proxy per le richieste WMS per aggirare i problemi di CORS."""
    wms_params = request.args.to_dict()
    wms_server_url = wms_params.pop('wms_server_url', None)
    if not wms_server_url:
        return "URL del server WMS mancante nel proxy", 400
    try:
        full_request_url = requests.Request('GET', wms_server_url, params=wms_params).prepare().url
        print(f"Richiesta WMS Proxy a: {full_request_url}", flush=True)
        headers = {'User-Agent': 'Mozilla/5.0'}
        response = requests.get(wms_server_url, params=wms_params, headers=headers, stream=True, timeout=15)
        response.raise_for_status()
        return Response(response.content, content_type=response.headers['content-type'])
    except requests.exceptions.RequestException as e:
        print(f"ERRORE PROXY WMS: {e}", flush=True)
        return f"Errore nella connessione al server WMS esterno: {e}", 502

@app.route('/api/config', methods=['GET', 'POST'])
def manage_config():
    """Legge e scrive il file di configurazione globale."""
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
    """Gestisce l'aggiunta e la lettura dei log dal database."""
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
    """Importa un intero batch di log da un CSV."""
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
        broadcast({'type': 'full_reload_needed'})
    
    return jsonify({'status': 'success', 'imported_count': len(logs_to_insert), 'import_id': import_id})

@app.route('/api/logs/batch_delete', methods=['POST'])
def delete_logs_batch():
    """Cancella un gruppo di log (per ID o per import_id)."""
    data = request.json
    db = get_db()
    
    if 'log_ids' in data and data['log_ids']:
        placeholders = ', '.join('?' for _ in data['log_ids'])
        db.execute(f"DELETE FROM logs WHERE id IN ({placeholders})", data['log_ids'])
    elif 'import_id' in data:
        db.execute("DELETE FROM logs WHERE import_id = ?", (data['import_id'],))
    
    db.commit()
    broadcast({'type': 'full_reload_needed'})
    return jsonify({'status': 'success'})

@app.route('/api/imports', methods=['GET'])
def get_imports():
    """Restituisce una lista di tutti i batch di importazione unici."""
    db = get_db()
    cursor = db.execute("SELECT DISTINCT import_id FROM logs WHERE import_id IS NOT NULL AND import_id != 'manual'")
    imports = [row['import_id'] for row in cursor.fetchall()]
    return jsonify(imports)

@app.route('/api/logs/<int:log_id>', methods=['PUT', 'DELETE'])
def manage_single_log(log_id):
    """Aggiorna o cancella un singolo record di log."""
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
    """Svuota completamente la tabella dei log."""
    db = get_db()
    db.execute('DELETE FROM logs')
    db.commit()
    broadcast({'type': 'logs_reset'})
    return jsonify({'status': 'success'})

# BLOCCO DI AVVIO SERVER
if __name__ == '__main__':
    # Crea un file di configurazione di default se non esiste al primo avvio
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