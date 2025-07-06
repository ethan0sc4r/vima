import serial
import time
import math
import json
from datetime import datetime
import os

CONFIG_FILE = 'config.json'

# ========= LOGICA DI CALCOLO DEI BOX (identica a quella JavaScript) =========
def get_letter_code(index: int) -> str:
    """Converte un indice numerico (0, 1, 2...) nel suo codice a due lettere (AA, AB, AC...)."""
    alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    if index < 0: return "??"
    first_letter_index, second_letter_index = divmod(index, 26)
    if first_letter_index >= len(alphabet): return "!!"
    return alphabet[first_letter_index] + alphabet[second_letter_index]

def get_box_id_from_coords(lat: float, lon: float, grid_bounds: dict) -> str | None:
    """Calcola l'ID del box (es. AA-01) date le coordinate e i limiti della griglia."""
    box_size = 10 / 60
    if not (grid_bounds['lat_end'] <= lat <= grid_bounds['lat_start'] and
            grid_bounds['lon_start'] <= lon <= grid_bounds['lon_end']):
        return None
    grid_lat_start = math.ceil(grid_bounds['lat_start'] / box_size) * box_size
    grid_lon_start = math.floor(grid_bounds['lon_start'] / box_size) * box_size
    row_index = int((grid_lat_start - lat) / box_size)
    col_index = int((lon - grid_lon_start) / box_size)
    row_label = get_letter_code(row_index)
    col_label = f"{col_index + 1:02d}"
    return f"{row_label}-{col_label}"

# ========= FUNZIONI DI CONVERSIONE E PARSING GPS =========
def decimal_to_dms(decimal_degrees: float, is_latitude: bool) -> str:
    """Converte gradi decimali in una stringa Gradi, Minuti, Secondi (DMS)."""
    if decimal_degrees < 0:
        hemisphere = 'S' if is_latitude else 'W'
    else:
        hemisphere = 'N' if is_latitude else 'E'
    decimal_degrees = abs(decimal_degrees)
    degrees = int(decimal_degrees)
    minutes_decimal = (decimal_degrees - degrees) * 60
    minutes = int(minutes_decimal)
    seconds = (minutes_decimal - minutes) * 60
    return f"{degrees}° {minutes}' {seconds:.1f}\" {hemisphere}"

def convert_nmea_to_decimal(nmea_val: float, hemisphere: str) -> float:
    """Converte una coordinata NMEA (ddmm.mmmm) in gradi decimali."""
    degrees = int(nmea_val / 100)
    minutes = nmea_val - (degrees * 100)
    decimal_degrees = degrees + (minutes / 60)
    if hemisphere in ['S', 'W']:
        decimal_degrees = -decimal_degrees
    return decimal_degrees

def parse_gga_sentence(sentence: str) -> dict | None:
    """Estrae i dati di posizione da una stringa NMEA $--GGA."""
    parts = sentence.split(',')
    if len(parts) > 7 and parts[0].endswith('GGA') and parts[6] != '0':
        try:
            latitude = convert_nmea_to_decimal(float(parts[2]), parts[3])
            longitude = convert_nmea_to_decimal(float(parts[4]), parts[5])
            return {'lat': latitude, 'lon': longitude}
        except (ValueError, IndexError): return None
    return None

def parse_rmc_sentence(sentence: str) -> dict | None:
    """Estrae posizione, velocità e rotta da una stringa NMEA $--RMC."""
    parts = sentence.split(',')
    if len(parts) > 9 and parts[0].endswith('RMC') and parts[2] == 'A':
        try:
            latitude = convert_nmea_to_decimal(float(parts[3]), parts[4])
            longitude = convert_nmea_to_decimal(float(parts[5]), parts[6])
            speed_knots = float(parts[7]) if parts[7] else 0.0
            course_deg = float(parts[8]) if parts[8] else 0.0
            return {'lat': latitude, 'lon': longitude, 'speed': speed_knots, 'course': course_deg}
        except (ValueError, IndexError): return None
    return None

# ========= FUNZIONI DI GESTIONE FILE =========
def read_last_line_from_file(filename: str) -> str | None:
    """Legge l'ultima riga non vuota di un file."""
    if not os.path.exists(filename): return None
    try:
        with open(filename, 'r', encoding='utf-8') as f:
            lines = [line for line in f if line.strip()]
            return lines[-1].strip() if lines else None
    except (IOError, IndexError):
        return None

# ========= LOGICA DI CONFIGURAZIONE =========
def load_config():
    """Tenta di caricare la configurazione dal file JSON."""
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        except (json.JSONDecodeError, IOError):
            print(f"ATTENZIONE: Il file '{CONFIG_FILE}' è corrotto o illeggibile.")
            return None
    return None

def save_config(config_data):
    """Salva la configurazione in un file JSON."""
    try:
        with open(CONFIG_FILE, 'w', encoding='utf-8') as f:
            json.dump(config_data, f, indent=4)
        print(f"Configurazione salvata con successo in '{CONFIG_FILE}'.")
    except IOError:
        print(f"ERRORE: Impossibile salvare il file di configurazione '{CONFIG_FILE}'.")

def prompt_for_config():
    """Chiede all'utente di inserire i dati di configurazione."""
    try:
        config_data = {}
        config_data['ship_name'] = input("Inserisci il nome della nave: ").strip()
        while True:
            config_data['default_color'] = input("Inserisci il codice colore di default (1=Rosso, 2=Blu, 3=Verde): ").strip()
            if config_data['default_color'] in ['1', '2', '3']: break
            print("Errore: Inserire solo 1, 2, o 3.")
        
        print("\n--- Definizione Griglia Geografica ---")
        config_data['grid_bounds'] = {
            'lat_start': float(input("Latitudine Inizio (es. 46.5): ")),
            'lon_start': float(input("Longitudine Inizio (es. 12.0): ")),
            'lat_end': float(input("Latitudine Fine (es. 40.0): ")),
            'lon_end': float(input("Longitudine Fine (es. 20.0): "))
        }
        return config_data
    except ValueError:
        print("ERRORE: Inserito un valore non numerico. Riprova.")
        return None

# ========= BLOCCO PRINCIPALE DELLO SCRIPT =========
if __name__ == "__main__":
    print("--- Avvio Logger GPS v5.6 ---")
    
    config = load_config()

    if not config:
        print("Nessuna configurazione trovata. Avvio configurazione manuale.")
        config = prompt_for_config()
        if config:
            save_config(config)
        else:
            print("Configurazione non valida. Uscita.")
            exit()
    else:
        print(f"File di configurazione '{CONFIG_FILE}' caricato.")

    ship_name = config['ship_name']
    default_color = config['default_color']
    grid_bounds = config['grid_bounds']

    mode = ''
    while mode not in ['l', 'f']:
        mode = input("\nScegli la modalità: [L]ive da porta COM o [F]ile di simulazione? ").lower()

    boxes_filename = "box_crossings.csv"
    last_line_boxes = read_last_line_from_file(boxes_filename)
    last_written_box = None
    if last_line_boxes and len(last_line_boxes.split(';')) > 1:
        parts_last_line = last_line_boxes.split(';')
        if len(parts_last_line) >= 2:
            last_written_box = parts_last_line[1]

    if not os.path.exists(boxes_filename):
        with open(boxes_filename, 'w', encoding='utf-8') as f:
            f.write("Timestamp;Box;Nave;Colore\n") # Intestazione

    if mode == 'l':
        raw_spool_filename = "gps_raw_spool.log"
        path_spool_filename = "path_spool.csv"
        last_written_path_line = read_last_line_from_file(path_spool_filename)
        if not os.path.exists(path_spool_filename):
            with open(path_spool_filename, 'w', encoding='utf-8') as f: f.write("DataOra,Latitudine(Dec),Latitudine(DMS),Longitudine(Dec),Longitudine(DMS),Velocita(Nodi),Rotta(Gradi)\n")
        
        print(f"\nUltimo box registrato: {last_written_box or 'Nessuno'}")
        print(f"Logging attivo su '{boxes_filename}' e '{path_spool_filename}'.")

        try:
            com_port = input("Inserisci la porta COM del GPS (es. COM3): ").strip()
            baud_rate = int(input("Inserisci la velocità (baud rate) (default 4800): ") or "4800")
            print(f"\nConnessione a {com_port} a {baud_rate} baud...")
            ser = serial.Serial(com_port, baud_rate, timeout=5)
            print("Connessione riuscita. In ascolto... (Premi Ctrl+C per fermare)")

            while True:
                gps_line = ser.readline().decode('ascii', errors='replace').strip()
                if not gps_line: continue
                
                with open(raw_spool_filename, 'a', encoding='utf-8') as f_spool:
                    f_spool.write(f"{datetime.now().isoformat()} | {gps_line}\n")
                
                position_data, path_data = None, None
                if gps_line.startswith(('$GPGGA', '$GNGGA')):
                    position_data = parse_gga_sentence(gps_line)
                elif gps_line.startswith(('$GPRMC', '$GNRMC')):
                    path_data = parse_rmc_sentence(gps_line)
                    if path_data: position_data = {'lat': path_data['lat'], 'lon': path_data['lon']}

                if path_data:
                    now_dt = datetime.now()
                    now_str_path = now_dt.strftime('%Y-%m-%d %H:%M:%S')
                    lat_dms = decimal_to_dms(path_data['lat'], is_latitude=True)
                    lon_dms = decimal_to_dms(path_data['lon'], is_latitude=False)
                    current_path_line = f"{now_str_path},{path_data['lat']:.6f},{lat_dms},{path_data['lon']:.6f},{lon_dms},{path_data['speed']:.2f},{path_data['course']:.1f}"
                    if current_path_line != last_written_path_line:
                        with open(path_spool_filename, 'a', encoding='utf-8') as f_path: f_path.write(current_path_line + "\n")
                        last_written_path_line = current_path_line

                if position_data:
                    current_box = get_box_id_from_coords(position_data['lat'], position_data['lon'], grid_bounds)
                    if current_box and current_box != last_written_box:
                        print(f"Nuovo Box Rilevato: {current_box} | Posizione: {position_data['lat']:.4f}, {position_data['lon']:.4f}")
                        log_timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
                        log_entry = f"{log_timestamp};{current_box};{ship_name};{default_color}\n"
                        with open(boxes_filename, 'a', encoding='utf-8') as f_boxes: f_boxes.write(log_entry)
                        last_written_box = current_box
        except serial.SerialException as e:
            print(f"ERRORE CRITICO: Impossibile aprire la porta {com_port}. Dettagli: {e}")
        except KeyboardInterrupt:
            print("\n--- Script interrotto. ---")
        finally:
            if 'ser' in locals() and ser.is_open:
                ser.close()

    elif mode == 'f':
        try:
            input_file = input("Inserisci il percorso del file CSV di input (es. path_spool.csv): ")
            if not os.path.exists(input_file):
                print(f"ERRORE: File '{input_file}' non trovato."); exit()
            
            print(f"\nAvvio simulazione dal file '{input_file}'...")
            with open(input_file, 'r', encoding='utf-8') as f:
                next(f, None)
                line_number = 1
                
                for line in f:
                    line_number += 1
                    parts = line.strip().split(';') # Split per ';' come nel file di esempio
                    if len(parts) < 5: continue

                    try:
                        # Assicurati che il timestamp venga parsato e poi riformattato
                        timestamp_raw_str = parts[0]
                        # Esempio: "05-07-2025 10:00:00" -> "2025-07-05 10:00:00"
                        # Prova a parsare il formato DD-MM-YYYY HH:MM:SS
                        try:
                            dt_object = datetime.strptime(timestamp_raw_str, '%d-%m-%Y %H:%M:%S')
                        except ValueError:
                            # Se non funziona, potrebbe essere già YYYY-MM-DD o un altro formato
                            # Qui è dove dovresti aggiungere altri formati comuni se necessario.
                            # Per semplicità, riprovo con il formato YYYY-MM-DD HH:MM:SS
                            dt_object = datetime.strptime(timestamp_raw_str, '%Y-%m-%d %H:%M:%S')
                        
                        # Riformatta SEMPRE in YYYY-MM-DD HH:MM:SS per box_crossings.csv
                        log_timestamp = dt_object.strftime('%Y-%m-%d %H:%M:%S')

                        lat_dec = float(parts[1].replace(',', '.')) # Sostituisci la virgola con il punto
                        lon_dec = float(parts[3].replace(',', '.')) # Sostituisci la virgola con il punto
                        
                        current_box = get_box_id_from_coords(lat_dec, lon_dec, grid_bounds)
                        
                        if current_box and current_box != last_written_box:
                            print(f"[Riga {line_number}] Pos: {lat_dec:.4f},{lon_dec:.4f} -> Nuovo Box: {current_box}")
                            log_entry = f"{log_timestamp};{current_box};{ship_name};{default_color}\n"
                            with open(boxes_filename, 'a', encoding='utf-8') as f_boxes:
                                f_boxes.write(log_entry)
                            last_written_box = current_box
                        
                        if line_number % 20 == 0:
                            print('.', end='', flush=True)
                        time.sleep(0.02)

                    except (ValueError, IndexError) as e:
                        print(f"\nERRORE: Impossibile processare la riga {line_number}: '{line.strip()}'. Dettagli: {e}")
                        continue
            print("\n--- Simulazione completata. ---")
        except KeyboardInterrupt:
            print("\n--- Simulazione interrotta dall'utente. ---")
        except Exception as e:
            print(f"ERRORE inaspettato durante la simulazione: {e}")