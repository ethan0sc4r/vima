# Fase 1: Utilizza un'immagine Python ufficiale e leggera come base
FROM python:3.11-slim

# Imposta la directory di lavoro all'interno del container
WORKDIR /app

# Installa gli strumenti di sistema richiesti (opzionale)
RUN apt-get update && \
    apt-get install -y --no-install-recommends wget nano && \
    rm -rf /var/lib/apt/lists/*

# Copia e installa le dipendenze Python
COPY requirements.txt .
RUN pip install --no-cache-dir --trusted-host pypi.org --trusted-host files.pythonhosted.org -r requirements.txt

# Copia i file dell'applicazione e le cartelle principali
COPY app.py config.json schema.sql database.py ./
COPY config.json /app/storage/
COPY templates/ /app/templates/
COPY static/ /app/static/

# Crea le sottocartelle necessarie all'interno di /app/storage
RUN mkdir -p /app/storage/shapefiles && \
    mkdir -p /app/storage/geojson

# Esegue lo script per creare il database, che verrà salvato in /app/storage/
RUN python database.py

# Concedi i permessi di scrittura all'intera cartella 'storage' per la compatibilità con OpenShift
RUN chmod -R g+w /app/storage

# Esponi la porta su cui Gunicorn eseguirà l'applicazione
EXPOSE 5000

# Definisci una variabile d'ambiente per la modalità di produzione
ENV FLASK_ENV=production

# Comando per avviare l'applicazione all'avvio del container
CMD ["gunicorn", "--bind", "0.0.0.0:5000", "--workers", "1", "--worker-class", "gevent", "app:app"]
