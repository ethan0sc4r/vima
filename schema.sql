-- Elimina le tabelle se esistono per una reinizializzazione pulita
DROP TABLE IF EXISTS grid;
DROP TABLE IF EXISTS logs;

-- Tabella per conservare la definizione della griglia (avrà sempre una sola riga con id=1)
CREATE TABLE grid (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    lat_start REAL NOT NULL,
    lon_start REAL NOT NULL,
    lat_end REAL NOT NULL,
    lon_end REAL NOT NULL
);

-- Tabella per i log, dove ogni riga è un'analisi unica
CREATE TABLE logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, -- Chiave univoca per ogni singola analisi
    box_id TEXT NOT NULL,                 -- Può contenere duplicati (es. più analisi su AA-01)
    log_date TEXT NOT NULL,
    ship TEXT NOT NULL,
    color_code TEXT NOT NULL -- Codice colore 1, 2 o 3
);