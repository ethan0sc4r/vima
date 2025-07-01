// --- 1. DICHIARAZIONE GLOBALE ---
let map;
let layerControl;
let gridLayerGroup;
let tuttiDatiLog = {};
let gridLayers = {};
let config = {};

// Costanti globali
const boxSize = 10 / 60;
const GIORNI_BORDO_GIALLO = 15;
const GIORNI_BORDO_ROSSO = 30;
const styleDefault = { color: "#333", weight: 1, opacity: 0.6, fillOpacity: 0.1, fillColor: "#fff" };
const BORDO_VERDE = "#66BB6A", BORDO_GIALLO = "#FFEE58", BORDO_ROSSO = "#EF5350";
const COLOR_MAP = { '1': '#f44336', '2': '#2196F3', '3': '#4CAF50' };

// --- 2. LOGICA MODALI E HELPERS ---
function openModal(modalId) { document.getElementById(modalId).classList.add('visible'); }
function closeAllModals() {
    document.querySelectorAll('.modal-overlay').forEach(modal => modal.classList.remove('visible'));
    closeHistoryPanel();
}
function openHistoryPanel() { document.getElementById('history-panel').classList.add('visible'); }
function closeHistoryPanel() { document.getElementById('history-panel').classList.remove('visible'); }

function getLetterCode(index) {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    if (index < 0) return "??";
    const firstLetter = alphabet[Math.floor(index / 26)];
    const secondLetter = alphabet[index % 26];
    return firstLetter + secondLetter;
}

function getBoxIdFromCoordsJS(lat, lng) {
    if (!config || !config.grid_bounds) return null;
    const bounds = config.grid_bounds;
    if (!(bounds.lat_end <= lat && lat <= bounds.lat_start && bounds.lon_start <= lng && lng <= bounds.lon_end)) return null;
    const gridLatStart = Math.ceil(bounds.lat_start / boxSize) * boxSize;
    const gridLonStart = Math.floor(bounds.lon_start / boxSize) * boxSize;
    const relativeRow = (gridLatStart - lat) / boxSize;
    const relativeCol = (lng - gridLonStart) / boxSize;
    const rowIndex = Math.floor(relativeRow);
    const colIndex = Math.floor(relativeCol);
    const rowLabel = getLetterCode(rowIndex);
    const colLabel = String(colIndex + 1).padStart(2, '0');
    return `${rowLabel}-${colLabel}`;
}

function decimalToDms(decimalDegrees, isLatitude) {
    const hemisphere = decimalDegrees < 0 ? (isLatitude ? 'S' : 'W') : (isLatitude ? 'N' : 'E');
    const absDd = Math.abs(decimalDegrees);
    const degrees = Math.floor(absDd);
    const minutesDecimal = (absDd - degrees) * 60;
    const minutes = Math.floor(minutesDecimal);
    const seconds = (minutesDecimal - minutes) * 60;
    return `${degrees}° ${minutes}' ${seconds.toFixed(1)}" ${hemisphere}`;
}

// --- 3. LOGICA DI DISEGNO GRIGLIA ---
async function disegnaGriglia(bounds) {
    let boundsToDraw = bounds;
    if (!boundsToDraw) {
        boundsToDraw = {
            latStart: parseFloat(document.getElementById('lat_start').value),
            lonStart: parseFloat(document.getElementById('lon_start').value),
            latEnd: parseFloat(document.getElementById('lat_end').value),
            lonEnd: parseFloat(document.getElementById('lon_end').value)
        };
        if (Object.values(boundsToDraw).some(isNaN)) { alert("Coordinate non valide."); return; }
        config.grid_bounds = boundsToDraw;
        await fetch('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(config) });
    }
    
    const normBounds = {
        lat_start: boundsToDraw.latStart || boundsToDraw.lat_start,
        lon_start: boundsToDraw.lonStart || boundsToDraw.lon_start,
        lat_end: boundsToDraw.latEnd || boundsToDraw.lat_end,
        lon_end: boundsToDraw.lonEnd || boundsToDraw.lon_end,
        isFromWebSocket: boundsToDraw.isFromWebSocket
    };
    
    gridLayerGroup.clearLayers();
    gridLayers = {};
    const gridLatStart = Math.ceil(normBounds.lat_start / boxSize) * boxSize;
    const gridLonStart = Math.floor(normBounds.lon_start / boxSize) * boxSize;
    let relativeRowIndex = 0;
    for (let lat = gridLatStart; lat > normBounds.lat_end; lat -= boxSize) {
        let relativeColIndex = 0;
        for (let lon = gridLonStart; lon < normBounds.lon_end; lon += boxSize) {
            const rowLabel = getLetterCode(relativeRowIndex);
            const colLabel = String(relativeColIndex + 1).padStart(2, '0');
            const boxId = `${rowLabel}-${colLabel}`;
            const rectBounds = [[lat, lon], [lat - boxSize, lon + boxSize]];
            const rectangle = L.rectangle(rectBounds, styleDefault).bindTooltip(`<b>ID Box:</b> ${boxId}`);
            rectangle.on('click', () => handleBoxClick(boxId));
            gridLayerGroup.addLayer(rectangle);
            gridLayers[boxId] = rectangle;
            relativeColIndex++;
        }
        relativeRowIndex++;
    }
    if (gridLayerGroup.getLayers().length > 0 && !normBounds.isFromWebSocket) {
        map.fitBounds(gridLayerGroup.getBounds());
    }
    await caricaLogIniziali();
    if (!bounds) closeAllModals();
}

// --- 4. GESTIONE DATI LOG E STORICO---
function handleBoxClick(boxId) {
    document.getElementById('history-title').innerText = `Storico Box: ${boxId}`;
    document.getElementById('history-content').innerHTML = `<p>Seleziona un periodo e clicca "Mostra".</p>`;
    const showBtn = document.getElementById('history-show-btn');
    showBtn.onclick = () => renderHistory(boxId);
    openHistoryPanel();
}
function renderHistory(boxId) {
    const historyContent = document.getElementById('history-content');
    const years = parseInt(document.getElementById('history-years').value, 10);
    if (isNaN(years) || years < 1) { alert("Inserisci un numero di anni valido."); return; }
    const logsForBox = [...(tuttiDatiLog[boxId] || [])].sort((a, b) => new Date(b.log_date) - new Date(a.log_date));
    if (logsForBox.length === 0) { historyContent.innerHTML = "<p>Nessun log trovato per questo box.</p>"; return; }
    const cutoffDate = new Date();
    cutoffDate.setFullYear(cutoffDate.getFullYear() - years);
    const filteredLogs = logsForBox.filter(log => new Date(log.log_date) >= cutoffDate);
    if (filteredLogs.length === 0) { historyContent.innerHTML = `<p>Nessun log trovato negli ultimi ${years} anni.</p>`; return; }
    let html = '';
    filteredLogs.forEach(log => {
        html += `<div class="history-item"><b>Data:</b> ${log.date}<br><b>Nave:</b> ${log.ship}<br><b>Colore:</b> <span style="color:${COLOR_MAP[log.color_code]}; font-weight:bold;">●</span></div>`;
    });
    historyContent.innerHTML = html;
}
async function aggiungiBoxDaInput() {
    const boxData = {
        boxId: document.getElementById('boxInput').value.toUpperCase(),
        date: document.getElementById('dateInput').value,
        ship: document.getElementById('shipInput').value,
        colorCode: document.querySelector('input[name="logColor"]:checked').value
    };
    if (!boxData.boxId || !boxData.date || !boxData.ship) { alert("ID Box, Data e Nave sono campi obbligatori."); return; }
    if (!gridLayers[boxData.boxId]) { alert(`L'ID Box "${boxData.boxId}" non esiste sulla mappa.`); return; }
    await fetch('/api/logs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(boxData) });
    closeAllModals();
}
function renderizzaStili(filtro = null) {
    for (const boxId in gridLayers) {
        const layer = gridLayers[boxId];
        const logsPerBox = tuttiDatiLog[boxId] || [];
        const defaultTooltip = `<b>ID Box:</b> ${boxId}<br><i>Nessun log.</i>`;
        if (logsPerBox.length === 0) {
            layer.setStyle(styleDefault).setTooltipContent(defaultTooltip);
            continue;
        }
        const logsOrdinati = [...logsPerBox].sort((a, b) => new Date(b.log_date) - new Date(a.log_date));
        const logsFiltrati = logsOrdinati.filter(data => {
            if (!filtro) return true;
            let mostra = true;
            if (filtro.data && data.log_date !== filtro.data) mostra = false;
            if (filtro.nave && !data.ship.toLowerCase().includes(filtro.nave.toLowerCase())) mostra = false;
            if (filtro.colore && data.color_code !== filtro.colore) mostra = false;
            if (filtro.stato && mostra) {
                const oggi = new Date(); const dataBox = new Date(data.log_date);
                const diffGiorni = (oggi - dataBox) / (1000 * 3600 * 24);
                if (filtro.stato === 'ok' && diffGiorni > GIORNI_BORDO_GIALLO) mostra = false;
                if (filtro.stato === 'warning' && (diffGiorni <= GIORNI_BORDO_GIALLO || diffGiorni > GIORNI_BORDO_ROSSO)) mostra = false;
                if (filtro.stato === 'expired' && diffGiorni <= GIORNI_BORDO_ROSSO) mostra = false;
            }
            return mostra;
        });
        if (logsFiltrati.length === 0) {
            layer.setStyle(styleDefault).setTooltipContent(defaultTooltip);
            continue;
        }
        const logPiuRecente = logsFiltrati[0];
        const oggi = new Date(); const dataBox = new Date(logPiuRecente.log_date);
        const differenzaGiorni = (oggi - dataBox) / (1000 * 3600 * 24);
        let borderColor;
        if (differenzaGiorni > GIORNI_BORDO_ROSSO) borderColor = BORDO_ROSSO;
        else if (differenzaGiorni > GIORNI_BORDO_GIALLO) borderColor = BORDO_GIALLO;
        else borderColor = BORDO_VERDE;
        layer.setStyle({ fillColor: COLOR_MAP[logPiuRecente.color_code] || '#808080', color: borderColor, weight: 2, fillOpacity: 0.5, opacity: 1 });
        let tooltipContent = `<b>Box:</b> ${boxId} (${logsOrdinati.length} log)<hr><i>Log più recente:</i><br><b>Data:</b> ${logPiuRecente.date}<br><b>Nave:</b> ${logPiuRecente.ship}`;
        layer.setTooltipContent(tooltipContent);
        layer.bringToFront();
    }
}
async function resetDatiLog() {
    if (confirm("Sei sicuro di voler cancellare TUTTI i log dal database?")) {
        await fetch('/api/logs/reset', { method: 'POST' });
        closeAllModals();
    }
}

// --- 5. GESTIONE FILTRI ---
function applicaFiltri() {
    const filtro = {
        data: document.getElementById('filterDate').value || null,
        nave: document.getElementById('filterShip').value.trim() || null,
        colore: document.getElementById('filterColor').value || null,
        stato: document.getElementById('filterStatus').value || null
    };
    renderizzaStili(filtro);
    closeAllModals();
}
function rimuoviFiltri() {
    document.getElementById('filterDate').value = '';
    document.getElementById('filterShip').value = '';
    document.getElementById('filterColor').value = '';
    document.getElementById('filterStatus').value = '';
    renderizzaStili(null);
    closeAllModals();
}

// --- 6. IMPORT/EXPORT CSV ---
function triggerCSVDownload(csvContent, fileName) {
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}
function esportaLogCSV() {
    const boxIds = Object.keys(tuttiDatiLog);
    if (boxIds.length === 0) { alert("Nessun dato log da esportare."); return; }
    let csvContent = "Data;Box;Nave;Colore\n";
    boxIds.forEach(boxId => {
        tuttiDatiLog[boxId].forEach(data => {
            csvContent += `${data.date};${boxId};${data.ship};${data.color_code}\n`;
        });
    });
    triggerCSVDownload(csvContent, "mappa_log_export.csv");
}
function processCSV(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
        const righe = e.target.result.split('\n');
        for (const riga of righe) {
            if (!riga.trim() || riga.toLowerCase().startsWith('data;box')) continue;
            const parts = riga.split(';');
            if (parts.length >= 4) {
                const boxData = { date: parts[0].trim(), boxId: parts[1].trim().toUpperCase(), ship: parts[2].trim(), colorCode: parts[3].trim() };
                if (gridLayers[boxData.boxId]) {
                    await fetch('/api/logs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(boxData) });
                }
            }
        }
        alert('Importazione completata!');
    };
    reader.readAsText(file);
    event.target.value = '';
    closeAllModals();
}

// --- 7. CARICAMENTO LAYER ESTERNI ---
async function caricaLayerWMS(wmsConfig) { /*...*/ }
async function caricaLayerShapefile(nomeLayer, urlFileZip, stile) { /*...*/ }
async function caricaLayerGeoJSON(nomeLayer, urlFile, stile) { /*...*/ }

// --- 8. CARICAMENTO INIZIALE E WEBSOCKETS ---
async function caricaLogIniziali() {
    try {
        const response = await fetch('/api/logs');
        if (!response.ok) throw new Error("Errore nel fetch dei log");
        tuttiDatiLog = await response.json();
        renderizzaStili();
    } catch(e) { console.error("Impossibile caricare dati log:", e); }
}

function connectWebSocket() {
    const ws_url = `ws://${window.location.host}/ws`;
    const ws = new WebSocket(ws_url);
    ws.onmessage = function(event) {
        const message = JSON.parse(event.data);
        if (message.type === 'box_history_updated') {
            tuttiDatiLog[message.boxId] = message.data;
        } else if (message.type === 'logs_reset') {
            tuttiDatiLog = {};
        } else if (message.type === 'config_updated') {
            alert("La configurazione è stata aggiornata. La pagina verrà ricaricata.");
            window.location.reload();
            return;
        }
        renderizzaStili();
    };
    ws.onclose = () => setTimeout(connectWebSocket, 5000);
}

// NUOVA FUNZIONE DI INIZIALIZZAZIONE UNIFICATA E CORRETTA
async function inizializzaApplicazione() {
    document.getElementById('dateInput').valueAsDate = new Date();
    try {
        const response = await fetch('/api/config');
        if (!response.ok) throw new Error('File di configurazione non trovato sul server.');
        
        config = await response.json();
        
        // Inizializza la mappa UNA SOLA VOLTA
        map = L.map('map').setView([43.5, 16], 7);

        // Crea il layer della mappa base e lo salva in una variabile
        const baseMapLayer = L.tileLayer(config.base_map.url_template, { attribution: config.base_map.attribution });
        baseMapLayer.addTo(map);

        // Inizializza i componenti della mappa
        gridLayerGroup = L.featureGroup().addTo(map);
        
        // CORREZIONE: Passa l'oggetto layer corretto al controllo
        const baseLayers = { "Mappa Base": baseMapLayer };
        const overlayLayers = { "Griglia Interattiva": gridLayerGroup };
        layerControl = L.control.layers(baseLayers, overlayLayers, { collapsed: false }).addTo(map);
        
        map.createPane('shapefilePane');
        map.getPane('shapefilePane').style.zIndex = 390;

        const gridBounds = config.grid_bounds;
        document.getElementById('lat_start').value = gridBounds.lat_start;
        document.getElementById('lon_start').value = gridBounds.lon_start;
        document.getElementById('lat_end').value = gridBounds.lat_end;
        document.getElementById('lon_end').value = gridBounds.lon_end;
        
        await disegnaGriglia(gridBounds);
        
        if (config.wms_layers) config.wms_layers.forEach(wms => caricaLayerWMS(wms));

        map.on('mousemove', function(e) {
            const coordsBox = document.getElementById('coords-box');
            const dmsBox = document.getElementById('dms-box');
            if (!coordsBox || !dmsBox) return;
            const lat = e.latlng.lat, lng = e.latlng.lng;
            const boxId = getBoxIdFromCoordsJS(lat, lng);
            coordsBox.innerHTML = `Dec: ${lat.toFixed(5)}, ${lng.toFixed(5)}<br>${boxId ? `<b>Box: ${boxId}</b>` : '<i>Fuori Griglia</i>'}`;
            dmsBox.innerHTML = `GMS: ${decimalToDms(lat, true)}, ${decimalToDms(lng, false)}`;
        });

        connectWebSocket();

    } catch(e) {
        console.error("Errore fatale durante l'inizializzazione:", e);
        document.body.innerHTML = `<h1>Errore critico durante l'avvio. Controlla la console (F12).</h1><p>${e.message}</p>`;
    }
}

window.onload = inizializzaApplicazione;