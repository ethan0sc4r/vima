import sqlite3
import os

# Definisci la cartella e il nome del database
STORAGE_DIR = 'storage'
DB_NAME = os.path.join(STORAGE_DIR, 'database.db') # Percorso completo del DB
SCHEMA_NAME = 'schema.sql'

# Crea la cartella 'storage' se non esiste
os.makedirs(STORAGE_DIR, exist_ok=True)

# Rimuove il vecchio database se esiste, per essere sicuri di applicare il nuovo schema
if os.path.exists(DB_NAME):
    os.remove(DB_NAME)

# Connessione al file del database (lo crea nella cartella 'storage')
connection = sqlite3.connect(DB_NAME)

# Apriamo il file schema.sql e lo eseguiamo per creare le tabelle
with open(SCHEMA_NAME) as f:
    connection.executescript(f.read())

connection.close()
print(f"Database '{DB_NAME}' creato/reimpostato con successo.")