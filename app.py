import sqlite3
import json
import os
from flask import Flask, render_template, request, jsonify, g
from flask_sock import Sock
from collections import defaultdict # <-- ECCO LA RIGA MANCANTE

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
    disconnected_clients = []
    for client in clients:
        try:
            client.send(json.dumps(message))
        except Exception:
            disconnected_clients.append(client)
    for client in disconnected_clients:
        clients.remove(client)

# --- ROUTE E API ---
@app.route('/')
def index():
    return render_template('index.html')

@sock.route('/ws')
def websocket(ws):
    print(f"Nuovo client connesso al WebSocket. Totale client: {len(clients) + 1}")
    clients.append(ws)
    try:
        while True:
            ws.receive(timeout=None)
    except Exception:
        print(f"Client WebSocket disconnesso. Totale client: {len(clients) - 1}")
    finally:
        if ws in clients:
            clients.remove(ws)

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
    # GET
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
            'INSERT INTO logs (box_id, log_date, ship, color_code) VALUES (?, ?, ?, ?)',
            (log_data['boxId'], log_data['date'], log_data['ship'], log_data['colorCode'])
        )
        db.commit()
        log_cursor = db.execute('SELECT * FROM logs WHERE box_id = ? ORDER BY log_date DESC', (log_data['boxId'],)).fetchall()
        updated_box_history = [dict(row) for row in log_cursor]
        broadcast({'type': 'box_history_updated', 'boxId': log_data['boxId'], 'data': updated_box_history})
        return jsonify({'status': 'success'})
    
    # GET
    logs_cursor = db.execute('SELECT * FROM logs ORDER BY box_id, log_date DESC').fetchall()
    logs_by_box = defaultdict(list)
    for row in logs_cursor:
        logs_by_box[row['box_id']].append(dict(row))
    return jsonify(logs_by_box)


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
            "wms_layers": []
        }
        with open(CONFIG_FILE, 'w', encoding='utf-8') as f:
            json.dump(default_config, f, indent=4)
            
    app.run(debug=True, host='0.0.0.0', port=5000)