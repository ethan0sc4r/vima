# --- Fase 1: Base e Dipendenze ---

# Partiamo da un'immagine Python ufficiale, specificando la piattaforma per la compatibilità.
FROM --platform=linux/amd64 python:3.10-slim

# Impostiamo una directory di lavoro all'interno del container.
WORKDIR /app

# Copiamo prima il file dei requisiti per sfruttare la cache di Docker.
COPY requirements.txt .

# Installiamo le dipendenze Python e l'editor 'nano' per il debug.
# Usiamo un unico comando RUN per creare meno layer nell'immagine.
RUN pip install --no-cache-dir -r requirements.txt && \
    apt-get update && apt-get install -y nano && \
    rm -rf /var/lib/apt/lists/*

# --- Fase 2: Copia dell'Applicazione e Setup ---

# Ora copiamo tutti i file della nostra applicazione.
COPY . .
     
# Eseguiamo lo script per inizializzare il database SQLite.
# Verrà eseguito solo una volta, durante la creazione dell'immagine.
RUN python database.py


# --- Fase 3: Esecuzione ---

# Esponiamo la porta 5000, quella su cui il nostro server Gunicorn sarà in ascolto.
EXPOSE 5000

# CORRETTO: Eseguiamo gunicorn come modulo python per evitare problemi di PATH.
# Questo è il comando corretto e robusto per avviare l'applicazione.
CMD ["python", "-m", "gunicorn", "--bind", "0.0.0.0:5000", "--workers", "2", "app:app"]