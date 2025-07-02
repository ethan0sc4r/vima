DROP TABLE IF EXISTS grid;
DROP TABLE IF EXISTS logs;

CREATE TABLE grid (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    lat_start REAL NOT NULL,
    lon_start REAL NOT NULL,
    lat_end REAL NOT NULL,
    lon_end REAL NOT NULL
);

CREATE TABLE logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    box_id TEXT NOT NULL,
    log_timestamp TEXT NOT NULL,
    ship TEXT NOT NULL,
    color_code TEXT NOT NULL,
    -- NUOVA COLONNA per raggruppare i log per importazione
    import_id TEXT
);