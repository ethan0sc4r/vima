# Fase 1: Utilizza un'immagine Python ufficiale e leggera come base
FROM python:3.11-slim

# Imposta la directory di lavoro all'interno del container
WORKDIR /app

# Copia il file dei requisiti prima del resto del codice per ottimizzare la cache
COPY requirements.txt .

# Installa le dipendenze Python
RUN pip install --no-cache-dir -r requirements.txt

# Copia i file principali dalla root del progetto alla root dell'app nel container
COPY app.py config.json schema.sql database.py ./

# Copia l'intera cartella 'templates' e il suo contenuto
COPY templates/ /app/templates/

# Copia l'intera cartella 'static' con tutte le sue sottocartelle
# (css, js, images, geojson, shapefiles, etc.)
COPY static/ /app/static/

# Esegue lo script per creare il database nella cartella 'storage'
# (come da nostra precedente modifica a database.py)
RUN python database.py

# Esponi la porta su cui Gunicorn eseguirà l'applicazione
EXPOSE 5000

# Definisci una variabile d'ambiente per la modalità di produzione
ENV FLASK_ENV=production

# Comando per avviare l'applicazione all'avvio del container
CMD ["gunicorn", "--bind", "0.0.0.0:5000", "--workers", "1", "--worker-class", "gevent", "app:app"]