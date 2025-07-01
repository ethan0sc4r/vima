import sqlite3
import json
import os
import requests
from flask import Flask, render_template, request, jsonify, g, Response
from flask_sock import Sock
from collections import defaultdict

# --- CONFIGURAZIONE ---
app = Flask(__name__)
sock = Sock(app)
DATABASE = 'database.db'
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
    for client in clients:
        try:
            client.send(json.dumps(message))
        except Exception:
            disconnected_clients.append(client)
    
    # Rimuove i client la cui connessione è stata persa
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
    clients.append(ws)
    try:
        while True:
            ws.receive(timeout=None)
    except Exception:
        pass
    finally:
        if ws in clients:
            clients.remove(ws)

# --- PROXY WMS CON LOGICA DI DEBUG MIGLIORATA ---
@app.route('/api/wms_proxy')
def wms_proxy():
    wms_params = request.args.to_dict()
    wms_server_url = wms_params.pop('wms_server_url', None)
    if not wms_server_url:
        return "URL del server WMS mancante nel proxy", 400

    try:
        full_request_url = requests.Request('GET', wms_server_url, params=wms_params).prepare().url
        
        # Stampa di debug forzata per essere sicuri di vederla nel terminale
        print("--- Richiesta WMS Proxy Ricevuta ---", flush=True)
        print(f"URL Completo Richiesto al Server Esterno: {full_request_url}", flush=True)
        print("--------------------------", flush=True)

        headers = {'User-Agent': 'Mozilla/5.0'}
        
        response = requests.get(wms_server_url, params=wms_params, headers=headers, stream=True, timeout=15)
        response.raise_for_status()
        
        return Response(response.content, content_type=response.headers['content-type'])
        
    except requests.exceptions.RequestException as e:
        print(f"ERRORE PROXY WMS: {e}", flush=True)
        return f"Errore nella connessione al server WMS esterno: {e}", 502


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
        db.execute('INSERT INTO logs (box_id, log_date, ship, color_code) VALUES (?, ?, ?, ?)', (log_data['boxId'], log_data['date'], log_data['ship'], log_data['colorCode']))
        db.commit()
        log_cursor = db.execute('SELECT * FROM logs WHERE box_id = ? ORDER BY log_date DESC', (log_data['boxId'],)).fetchall()
        updated_box_history = [dict(row) for row in log_cursor]
        broadcast({'type': 'box_history_updated', 'boxId': log_data['boxId'], 'data': updated_box_history})
        return jsonify({'status': 'success'})
    
    logs_cursor = db.execute('SELECT * FROM logs ORDER BY box_id, log_date DESC').fetchall()
    logs_by_box = defaultdict(list)
    for row in logs_cursor:
        logs_by_box[row['box_id']].append(dict(row))
    return jsonify(logs_by_box)

@app.route('/api/logs/<int:log_id>', methods=['PUT', 'DELETE'])
def manage_single_log(log_id):
    db = get_db()
    log_to_manage = db.execute('SELECT box_id FROM logs WHERE id = ?', (log_id,)).fetchone()
    if not log_to_manage: return jsonify({'status': 'error', 'message': 'Log non trovato'}), 404
    box_id = log_to_manage['box_id']
    if request.method == 'PUT':
        log_data = request.json
        db.execute('UPDATE logs SET log_date = ?, ship = ?, color_code = ? WHERE id = ?', (log_data['date'], log_data['ship'], log_data['colorCode'], log_id))
    elif request.method == 'DELETE':
        db.execute('DELETE FROM logs WHERE id = ?', (log_id,))
    db.commit()
    log_cursor = db.execute('SELECT * FROM logs WHERE box_id = ? ORDER BY log_date DESC', (box_id,)).fetchall()
    updated_box_history = [dict(row) for row in log_cursor]
    broadcast({'type': 'box_history_updated', 'boxId': box_id, 'data': updated_box_history})
    return jsonify({'status': 'success'})

@app.route('/api/logs/reset', methods=['POST'])
def reset_logs():
    db = get_db()
    db.execute('DELETE FROM logs')
    db.commit()
    broadcast({'type': 'logs_reset'})
    return jsonify({'status': 'success'})

# BLOCCO DI AVVIO SERVER
if __name__ == '__main__':
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
