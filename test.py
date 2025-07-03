import requests

# 1. Definisci i dettagli della richiesta
base_url = "https://geoportalemm.marina.difesa.it/server/services/Hosted/TEST_WFS_DBMFF_CABLE/MapServer/WFSServer"
type_name = "TEST_WFS_DBMFF_CABLE:CBLSUB"

# 2. Definisci i parametri
params = {
    'service': 'WFS',
    'version': '2.0.0',
    'request': 'GetFeature',
    'typeName': type_name,
    'outputFormat': 'GEOJSON'  # <-- MODIFICA EFFETTUATA
}

# 3. Definisci gli header (ci "fingiamo" QGIS)
headers = {
    'User-Agent': 'QGIS/3.34.8'
}

# --- Esecuzione del Test ---
try:
    print(f"Sto contattando il server WFS a: {base_url}")
    print(f"Con i parametri: {params}\n")

    # Eseguiamo la richiesta GET (con verify=False per ignorare errori SSL)
    response = requests.get(base_url, params=params, headers=headers, timeout=30, verify=False)

    # Stampa lo stato della risposta
    print(f"===> STATO RISPOSTA: {response.status_code}\n")

    # Stampa i primi 500 caratteri della risposta per vedere cosa ci dice il server
    print("===> INIZIO RISPOSTA DAL SERVER:")
    print(response.text[:500])
    print("===> FINE RISPOSTA DAL SERVER")

except requests.exceptions.RequestException as e:
    print(f"\n!!!!!! ERRORE DI CONNESSIONE !!!!!!\n{e}")