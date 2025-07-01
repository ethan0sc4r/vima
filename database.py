import sqlite3
import os

DB_NAME = 'database.db'
SCHEMA_NAME = 'schema.sql'

# Rimuove il vecchio database se esiste, per essere sicuri di applicare il nuovo schema
if os.path.exists(DB_NAME):
    os.remove(DB_NAME)

# Connessione al file del database (lo crea)
connection = sqlite3.connect(DB_NAME)

# Apriamo il file schema.sql e lo eseguiamo per creare le tabelle
with open(SCHEMA_NAME) as f:
    connection.executescript(f.read())

connection.close()
print(f"Database '{DB_NAME}' creato/reimpostato con successo usando '{SCHEMA_NAME}'.")