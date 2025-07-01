import sqlite3
import json
import os
from flask import Flask, render_template, request, jsonify, g
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

@app.route('/api/config', methods=['GET', 'POST'])
def manage_config():
    """Legge e scrive il file di configurazione globale."""
    if request.method == 'POST':
        try:
            new_config = request.json
            with open(CONFIG_FILE, 'w', encoding='utf-8') as f:
                json.dump(new_config, f, indent=4)
            # Notifica a tutti i client che la configurazione è cambiata
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
    """Gestisce l'aggiunta e la lettura dei log dal database."""
    db = get_db()
    if request.method == 'POST':
        log_data = request.json
        # Aggiunge un nuovo record di log. L'ID è autoincrementante.
        db.execute(
            'INSERT INTO logs (box_id, log_date, ship, color_code) VALUES (?, ?, ?, ?)',
            (log_data['boxId'], log_data['date'], log_data['ship'], log_data['colorCode'])
        )
        db.commit()
        # Invia a tutti i client l'intero storico aggiornato per il box modificato
        log_cursor = db.execute('SELECT * FROM logs WHERE box_id = ? ORDER BY log_date DESC', (log_data['boxId'],)).fetchall()
        updated_box_history = [dict(row) for row in log_cursor]
        broadcast({'type': 'box_history_updated', 'boxId': log_data['boxId'], 'data': updated_box_history})
        return jsonify({'status': 'success'})
    
    # GET: Restituisce tutti i log, raggruppati per box_id
    logs_cursor = db.execute('SELECT * FROM logs ORDER BY box_id, log_date DESC').fetchall()
    logs_by_box = defaultdict(list)
    for row in logs_cursor:
        logs_by_box[row['box_id']].append(dict(row))
    return jsonify(logs_by_box)

@app.route('/api/logs/<int:log_id>', methods=['PUT', 'DELETE'])
def manage_single_log(log_id):
    """Aggiorna o cancella un singolo record di log."""
    db = get_db()
    
    # Prima di qualsiasi operazione, otteniamo il box_id per la notifica
    log_to_manage = db.execute('SELECT box_id FROM logs WHERE id = ?', (log_id,)).fetchone()
    if not log_to_manage:
        return jsonify({'status': 'error', 'message': 'Log non trovato'}), 404
    box_id = log_to_manage['box_id']

    if request.method == 'PUT':
        log_data = request.json
        db.execute(
            'UPDATE logs SET log_date = ?, ship = ?, color_code = ? WHERE id = ?',
            (log_data['date'], log_data['ship'], log_data['colorCode'], log_id)
        )
        db.commit()
    
    elif request.method == 'DELETE':
        db.execute('DELETE FROM logs WHERE id = ?', (log_id,))
        db.commit()

    # Dopo la modifica o cancellazione, invia lo storico aggiornato del box a tutti
    log_cursor = db.execute('SELECT * FROM logs WHERE box_id = ? ORDER BY log_date DESC', (box_id,)).fetchall()
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