-- Elimina le tabelle se esistono per una reinizializzazione pulita
DROP TABLE IF EXISTS grid;
DROP TABLE IF EXISTS logs;

-- Tabella per conservare la definizione della griglia
CREATE TABLE grid (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    lat_start REAL NOT NULL,
    lon_start REAL NOT NULL,
    lat_end REAL NOT NULL,
    lon_end REAL NOT NULL
);

-- Tabella per i log, dove ogni riga è un'analisi unica
CREATE TABLE logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    box_id TEXT NOT NULL,
    -- MODIFICATO: La colonna ora memorizza data e ora
    log_timestamp TEXT NOT NULL,
    ship TEXT NOT NULL,
    color_code TEXT NOT NULL
);