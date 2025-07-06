// --- 1. DICHIARAZIONE GLOBALE ---
let map;
let layerControl;
let gridLayerGroup;
let gridLabelsLayerGroup;
let tuttiDatiLog = {};
let gridLayers = {};
let config = {};
let colorChartInstance = null, shipChartInstance = null;
let loadedExternalLayers = {};
let intersectionCache = {};
let cableReportCache = {};
let currentPage = 1; // Pagina corrente per la tabella log
const logsPerPage = 50; // Log per pagina per la tabella log

// Costanti globali
const boxSize = 10 / 60;
const GIORNI_BORDO_GIALLO = 15;
const GIORNI_BORDO_ROSSO = 30;
const styleDefault = { color: "#333", weight: 1, opacity: 0.6, fillOpacity: 0.1, fillColor: "#fff" };
const BORDO_VERDE = "#66BB6A", BORDO_GIALLO = "#FFEE58", BORDO_ROSSO = "#EF5350";
const COLOR_MAP = { '1': '#f44336', '2': '#2196F3', '3': '#4CAF50' };


// --- 2. LOGICA MODALI, PANNELLI E NOTIFICHE ---
function openModal(modalId) {
    if (modalId === 'modal-log-entry') {
        document.getElementById('log-modal-title').textContent = 'Aggiungi Log';
        const saveButton = document.getElementById('log-save-button');
        const timeInput = document.getElementById('timeInput');
        if(timeInput) {
            const now = new Date();
            timeInput.value = now.toTimeString().slice(0,5); 
        }
        if(saveButton) saveButton.textContent = 'Aggiungi Log';
        
        const logIdInput = document.getElementById('logIdInput');
        if(logIdInput) logIdInput.value = '';

        const boxInput = document.getElementById('boxInput');
        if(boxInput) boxInput.readOnly = false;
        
        const logForm = document.getElementById('log-form');
        if (logForm) logForm.reset();
        
        const dateInput = document.getElementById('dateInput');
        if(dateInput) dateInput.valueAsDate = new Date();
    }
    const modal = document.getElementById(modalId);
    if(modal) modal.classList.add('visible');
}
function closeAllModals() {
    document.querySelectorAll('.modal-overlay').forEach(modal => modal.classList.remove('visible'));
    closeHistoryPanel();
    closeLayerManager();
}
function openHistoryPanel() { document.getElementById('history-panel').classList.add('visible'); }
function closeHistoryPanel() { document.getElementById('history-panel').classList.remove('visible'); }
function openLayerManager() {
    renderLayerManagerList();
    document.getElementById('layer-manager-panel').classList.add('visible');
}
function closeLayerManager() { document.getElementById('layer-manager-panel').classList.remove('visible'); }

function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
        toast.classList.add('show');
    }, 10);
    setTimeout(() => {
        toast.classList.remove('show');
        toast.addEventListener('transitionend', () => toast.remove());
    }, 4000);
}

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
            lat_start: parseFloat(document.getElementById('lat_start').value),
            lon_start: parseFloat(document.getElementById('lon_start').value),
            lat_end: parseFloat(document.getElementById('lat_end').value),
            lon_end: parseFloat(document.getElementById('lon_end').value)
        };
        if (Object.values(boundsToDraw).some(isNaN)) {
            showToast("Coordinate non valide.", 'error');
            return;
        }
        const newConfig = { ...config, grid_bounds: boundsToDraw };
        await fetch('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newConfig) });
    }
    
    gridLayerGroup.clearLayers();
    gridLabelsLayerGroup.clearLayers();
    gridLayers = {};

    const gridLatStart = Math.ceil(boundsToDraw.lat_start / boxSize) * boxSize;
    const gridLonStart = Math.floor(boundsToDraw.lon_start / boxSize) * boxSize;
    let relativeRowIndex = 0;

    for (let lat = gridLatStart; lat > boundsToDraw.lat_end; lat -= boxSize) {
        let relativeColIndex = 0;
        for (let lon = gridLonStart; lon < boundsToDraw.lon_end; lon += boxSize) {
            const rowLabel = getLetterCode(relativeRowIndex);
            const colLabel = String(relativeColIndex + 1).padStart(2, '0');
            const boxId = `${rowLabel}-${colLabel}`;
            const rectBounds = [[lat, lon], [lat - boxSize, lon + boxSize]];
            
            const rectangle = L.rectangle(rectBounds, styleDefault).bindTooltip(`<b>ID Box:</b> ${boxId}`);
            rectangle.on('click', () => handleBoxClick(boxId));
            gridLayerGroup.addLayer(rectangle);
            gridLayers[boxId] = rectangle;

            const centerLat = lat - boxSize / 2;
            const centerLon = lon + boxSize / 2;
            
            const label = L.marker([centerLat, centerLon], {
                icon: L.divIcon({
                    className: 'grid-label',
                    html: `<span>${boxId}</span>`,
                    iconSize: [40, 10]
                }),
                interactive: false
            });
            gridLabelsLayerGroup.addLayer(label);

            relativeColIndex++;
        }
        relativeRowIndex++;
    }
    if (gridLayerGroup.getLayers().length > 0 && !boundsToDraw.isFromWebSocket) {
        map.fitBounds(gridLayerGroup.getBounds());
    }
    await caricaLogIniziali();
    if (!bounds) closeAllModals();
}


// --- 4. GESTIONE DATI LOG E STORICO---
function handleBoxClick(boxId) {
    document.getElementById('boxInput').value = boxId;
    document.getElementById('history-title').innerText = `Storico Box: ${boxId}`;
    document.getElementById('history-content').innerHTML = `<p style="padding: 15px;">Seleziona un periodo e clicca "Mostra Storico".</p>`;
    
    const showBtn = document.getElementById('history-show-btn');
    showBtn.onclick = () => renderHistory(boxId);
    
    displayIntersectionResults(boxId); 
    
    openHistoryPanel();
}

function displayIntersectionResults(boxId) {
    const resultsContainer = document.getElementById('intersection-results');
    const intersectingCables = intersectionCache[boxId] || [];

    if (intersectingCables.length > 0) {
        resultsContainer.innerHTML = '<ul>' + intersectingCables.map(cable => `<li>${cable.name} (${cable.NOBJNM || 'N/D'})</li>`).join('') + '</ul>';
    } else {
        resultsContainer.innerHTML = '<p>Nessuna intersezione trovata.</p>';
    }
}

function renderHistory(boxId) {
    const historyContent = document.getElementById('history-content');
    const years = parseInt(document.getElementById('history-years').value, 10);
    if (isNaN(years) || years < 1) { showToast("Inserisci un numero di anni valido.", 'error'); return; }
    
    // Assicurati che log_timestamp sia un formato parsabile da Date
    const logsForBox = [...(tuttiDatiLog[boxId] || [])].sort((a, b) => new Date(b.log_timestamp) - new Date(a.log_timestamp));
    if (logsForBox.length === 0) {
        historyContent.innerHTML = "<p style='padding: 15px;'>Nessun log trovato per questo box.</p>";
        return;
    }

    const cutoffDate = new Date();
    cutoffDate.setFullYear(cutoffDate.getFullYear() - years);
    const filteredLogs = logsForBox.filter(log => new Date(log.log_timestamp.split(' ')[0]) >= cutoffDate);
    
    if (filteredLogs.length === 0) {
        historyContent.innerHTML = `<p style='padding: 15px;'>Nessun log trovato negli ultimi ${years} anni.</p>`;
        return;
    }

    let tableHTML = `
        <table class="history-table">
            <thead>
                <tr>
                    <th>Data/Ora</th>
                    <th>Nave</th>
                    <th>Colore</th>
                    <th>Azioni</th>
                </tr>
            </thead>
            <tbody>
    `;

    filteredLogs.forEach(log => {
        tableHTML += `
            <tr>
                <td>${log.log_timestamp}</td>
                <td>${log.ship}</td>
                <td><span style="color:${COLOR_MAP[log.color_code]}; font-size: 20px; font-weight:bold;">●</span></td>
                <td class="actions-cell">
                    <span title="Modifica Log" onclick='openEditLogModal(${JSON.stringify(log)})'>✎</span>
                    <span title="Cancella Log" onclick='deleteLog(${log.id}, "${log.box_id}")'>🗑️</span>
                </td>
            </tr>
        `;
    });

    tableHTML += `</tbody></table>`;
    historyContent.innerHTML = tableHTML;
}

function openEditLogModal(log) {
    closeHistoryPanel();
    // Split del timestamp per popolare correttamente data e ora
    const [datePart, timePart] = log.log_timestamp.split(' ');
    document.getElementById('log-modal-title').textContent = 'Modifica Log';
    document.getElementById('log-save-button').textContent = 'Salva Modifiche';
    document.getElementById('logIdInput').value = log.id;
    document.getElementById('boxInput').value = log.box_id;
    document.getElementById('boxInput').readOnly = true;
    document.getElementById('dateInput').value = datePart;
    document.getElementById('timeInput').value = timePart || '00:00'; // Assicurati che ci sia un valore di default
 
    document.getElementById('shipInput').value = log.ship;
    document.querySelector(`input[name="logColor"][value="${log.color_code}"]`).checked = true;
    openModal('modal-log-entry');
}

async function deleteLog(logId, boxId) {
    if (confirm(`Sei sicuro di voler cancellare il log #${logId} dal box ${boxId}?`)) {
        await fetch(`/api/logs/${logId}`, { method: 'DELETE' });
        showToast(`Log #${logId} cancellato.`, 'info');
        // Non è più necessario chiamare closeHistoryPanel qui, il WS si occuperà dell'aggiornamento
    }
}

async function saveLog() {
    const logId = document.getElementById('logIdInput').value;
    const date = document.getElementById('dateInput').value;
    const time = document.getElementById('timeInput').value;
    const boxData = {
        boxId: document.getElementById('boxInput').value.toUpperCase(),
        timestamp: `${date} ${time}`, // Combina data e ora
        ship: document.getElementById('shipInput').value,
        colorCode: document.querySelector('input[name="logColor"]:checked').value
    };
    if (!boxData.boxId || !date || !time || !boxData.ship) { 
        showToast("Tutti i campi sono obbligatori.", 'error'); 
        return; 
    }
    if (!gridLayers[boxData.boxId]) { showToast(`L'ID Box "${boxData.boxId}" non esiste sulla mappa.`, 'error'); return; }
    
    const url = logId ? `/api/logs/${logId}` : '/api/logs';
    const method = logId ? 'PUT' : 'POST';

    await fetch(url, {
        method: method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(boxData)
    });
    showToast(logId ? "Log aggiornato con successo!" : "Log aggiunto con successo!", 'success');
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
        // Ordina i log per timestamp decrescente
        const logsOrdinati = [...logsPerBox].sort((a, b) => new Date(b.log_timestamp) - new Date(a.log_timestamp));
        const logsFiltrati = logsOrdinati.filter(data => {
            if (!filtro) return true;
            let mostra = true;
            // Assicurati che il confronto della data includa anche l'orario se necessario,
            // ma per il filtro data semplice, solo la parte YYYY-MM-DD va bene.
            if (filtro.data && !data.log_timestamp.startsWith(filtro.data)) mostra = false;
            if (filtro.nave && !data.ship.toLowerCase().includes(filtro.nave.toLowerCase())) mostra = false;
            if (filtro.colore && data.color_code !== filtro.colore) mostra = false;
            if (filtro.stato && mostra) {
                const oggi = new Date(); 
                // Considera solo la data per il calcolo della differenza giorni per coerenza con il filtro stato
                const dataBox = new Date(data.log_timestamp.split(' ')[0]); 
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
        const oggi = new Date(); 
        const dataBox = new Date(logPiuRecente.log_timestamp.split(' ')[0]); // Prendi solo la data per il calcolo della differenza giorni
        const differenzaGiorni = (oggi - dataBox) / (1000 * 3600 * 24);
        let borderColor;
        if (differenzaGiorni > GIORNI_BORDO_ROSSO) borderColor = BORDO_ROSSO;
        else if (differenzaGiorni > GIORNI_BORDO_GIALLO) borderColor = BORDO_GIALLO;
        else borderColor = BORDO_VERDE;
        layer.setStyle({ fillColor: COLOR_MAP[logPiuRecente.color_code] || '#808080', color: borderColor, weight: 2, fillOpacity: 0.5, opacity: 1 });
        let tooltipContent = `<b>Box:</b> ${boxId} (${logsOrdinati.length} log)<hr><i>Log più recente:</i><br><b>Data/Ora:</b> ${logPiuRecente.log_timestamp}<br><b>Nave:</b> ${logPiuRecente.ship}`;
        layer.setTooltipContent(tooltipContent);
        layer.bringToFront();
    }
}

async function resetDatiLog() {
    if (confirm("Sei sicuro di voler cancellare TUTTI i log dal database?")) {
        await fetch('/api/logs/reset', { method: 'POST' });
        showToast("Tutti i log sono stati cancellati.", 'info');
        closeAllModals(); // Non è più necessario ricaricare la pagina
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
    showToast("Filtri applicati.", 'info');
    closeAllModals();
}
function rimuoviFiltri() {
    document.getElementById('filterDate').value = '';
    document.getElementById('filterShip').value = '';
    document.getElementById('filterColor').value = '';
    document.getElementById('filterStatus').value = '';
    renderizzaStili(null);
    showToast("Filtri rimossi.", 'info');
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
    const allLogs = Object.values(tuttiDatiLog).flat();
    if (allLogs.length === 0) { showToast("Nessun dato log da esportare.", 'error'); return; }
    let csvContent = "Timestamp;Box;Nave;Colore\n";
    allLogs.forEach(data => {
        // Assicurati che i dati siano puliti per l'esportazione CSV
        const timestamp = data.log_timestamp.replace(/"/g, '""'); // Escapa le virgolette
        const boxId = data.box_id.replace(/"/g, '""');
        const ship = data.ship.replace(/"/g, '""');
        csvContent += `${timestamp};${boxId};${ship};${data.color_code}\n`;
    });
    triggerCSVDownload(csvContent, "mappa_log_export.csv");
}
function processCSV(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
        const csvContent = e.target.result;
        try {
            const response = await fetch('/api/logs/import', {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain; charset=utf-8' },
                body: csvContent
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.message || 'Errore del server');
            showToast(`Importati ${result.imported_count} log dal CSV.`, 'success');
            // Non ricarichiamo la pagina, l'aggiornamento avverrà via WebSocket
        } catch (error) {
            console.error("Errore durante l'importazione del CSV:", error);
            showToast(`Errore importazione CSV: ${error.message}`, 'error');
        }
    };
    reader.readAsText(file, "UTF-8");
    event.target.value = '';
    closeAllModals();
}

// --- 7. GESTIONE LAYER ESTERNI ---
function renderLayerManagerList() {
    const container = document.getElementById('layer-list-container');
    container.innerHTML = '';
    const gridItem = document.createElement('div');
    gridItem.className = 'layer-item';
    gridItem.innerHTML = `<span class="visibility-toggle" onclick="toggleLayerVisibility('gridLayerGroup')">${map.hasLayer(gridLayerGroup) ? '👁️' : '⚪'}</span><span class="layer-name"><strong>Griglia Interattiva</strong></span>`;
    container.appendChild(gridItem);
    if (config.external_layers && config.external_layers.length > 0) {
        config.external_layers.forEach((layer, index) => {
            const layerId = `${layer.type}-${index}`;
            const item = document.createElement('div');
            item.className = 'layer-item';
            
            const actionsHTML = layer.protected ? 
                '<span style="font-size: 14px; color: #999;">(Protetto)</span>' : 
                `<div class="layer-actions"><span title="Modifica Layer" onclick="openEditLayerModal(${index})">✎</span><span title="Cancella Layer" onclick="deleteLayer(${index})">🗑️</span></div>`;

            item.innerHTML = `
                <span class="visibility-toggle" onclick="toggleLayerVisibility('${layerId}')">${loadedExternalLayers[layerId] && map.hasLayer(loadedExternalLayers[layerId]) ? '👁️' : '⚪'}</span>
                <div class="reorder-arrows"><span onclick="reorderLayer(${index}, -1)">▲</span><span onclick="reorderLayer(${index}, 1)">▼</span></div>
                <span class="layer-name">${layer.name} (${layer.type.toUpperCase()})</span>
                ${actionsHTML}`;
            container.appendChild(item);
        });
    } else {
        container.innerHTML += '<p>Nessun layer esterno configurato.</p>';
    }
}
function toggleLayerVisibility(layerId) {
    const layer = (layerId === 'gridLayerGroup') ? gridLayerGroup : loadedExternalLayers[layerId];
    if (!layer) return;
    if (map.hasLayer(layer)) { map.removeLayer(layer); } else { map.addLayer(layer); }
    renderLayerManagerList();
}
async function reorderLayer(index, direction) {
    const layers = config.external_layers;
    if (layers[index].protected) {
        showToast("Questo layer è protetto e non può essere riordinato.", "error");
        return;
    }
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= layers.length) return;
    if (layers[newIndex].protected) {
        showToast("Non è possibile spostare un layer sopra un layer protetto.", "error");
        return;
    }
    [layers[index], layers[newIndex]] = [layers[newIndex], layers[index]];
    await saveConfigAndReload();
}
function openAddLayerModal() {
    document.getElementById('layer-form').reset();
    document.getElementById('layer-form-title').textContent = `Aggiungi Nuovo Layer`;
    document.getElementById('layer-index-input').value = -1;
    toggleLayerFormFields();
    openModal('modal-add-edit-layer');
}
function openEditLayerModal(index) {
    const layer = config.external_layers[index];
    if (layer.protected) {
        showToast("Questo layer è protetto e non può essere modificato.", "error");
        return;
    }
    document.getElementById('layer-form-title').textContent = `Modifica Layer: ${layer.name}`;
    document.getElementById('layer-type').value = layer.type;
    document.getElementById('layer-index-input').value = index;
    document.getElementById('layer-name').value = layer.name;
    document.getElementById('layer-url').value = layer.url;
    document.getElementById('layer-color').value = layer.style.color;
    document.getElementById('layer-weight').value = layer.style.weight;

    if (layer.type === 'wms') {
        document.getElementById('wms-layers').value = layer.layers || '';
        document.getElementById('layer-auth-type').value = layer.authentication || 'none';
        document.getElementById('layer-username').value = layer.username || '';
        document.getElementById('layer-password').value = layer.password || '';
    } else if (layer.type === 'wfs') {
        document.getElementById('wfs-typename').value = layer.typeName || '';
        document.getElementById('layer-auth-type').value = layer.authentication || 'none';
        document.getElementById('layer-username').value = layer.username || '';
        document.getElementById('layer-password').value = layer.password || '';
    }
    
    toggleLayerFormFields();
    openModal('modal-add-edit-layer');
}
function toggleLayerFormFields() {
    const type = document.getElementById('layer-type').value;
    const isWMS = type === 'wms';
    const isWFS = type === 'wfs';

    const wmsFields = document.getElementById('wms-fields');
    if (wmsFields) wmsFields.style.display = isWMS ? 'flex' : 'none';
    
    const authContainer = document.getElementById('auth-fields-container');
    if (authContainer) authContainer.style.display = (isWMS || isWFS) ? 'block' : 'none';
    
    const wfsFields = document.getElementById('wfs-fields');
    if (wfsFields) wfsFields.style.display = isWFS ? 'flex' : 'none';
    
    if (isWMS || isWFS) {
        toggleAuthFields();
    }
}
function toggleAuthFields() {
    const authType = document.getElementById('layer-auth-type').value;
    const basicAuthFields = document.getElementById('basic-auth-fields');
    if(basicAuthFields) basicAuthFields.style.display = (authType === 'basic') ? 'block' : 'none';
}
async function saveLayer() {
    const index = parseInt(document.getElementById('layer-index-input').value, 10);
    const layerData = {
        type: document.getElementById('layer-type').value,
        name: document.getElementById('layer-name').value,
        url: document.getElementById('layer-url').value,
        style: { 
            color: document.getElementById('layer-color').value, 
            weight: parseInt(document.getElementById('layer-weight').value, 10), 
            fillColor: document.getElementById('layer-color').value, 
            fillOpacity: 0.2 
        }
    };
    
    if (layerData.type === 'wms') {
        layerData.layers = document.getElementById('wms-layers').value;
        const authType = document.getElementById('layer-auth-type').value;
        layerData.authentication = authType;

        if (authType === 'basic') {
            layerData.username = document.getElementById('layer-username').value;
            layerData.password = document.getElementById('layer-password').value;
        }
    } else if (layerData.type === 'wfs') {
        layerData.typeName = document.getElementById('wfs-typename').value;
        const authType = document.getElementById('layer-auth-type').value;
        layerData.authentication = authType;
        if (authType === 'basic') {
            layerData.username = document.getElementById('layer-username').value;
            layerData.password = document.getElementById('layer-password').value;
        }
    }
    
    if (!layerData.name || !layerData.url || (layerData.type === 'wms' && !layerData.layers)) { 
        showToast("Tutti i campi per questo tipo di layer sono obbligatori.", 'error'); 
        return; 
    }
    
    if (!config.external_layers) config.external_layers = [];
    
    if (index === -1) { 
        config.external_layers.push(layerData); 
    } else { 
        config.external_layers[index] = layerData; 
    }
    
    await saveConfigAndReload();
}
async function deleteLayer(index) {
    const layer = config.external_layers[index];
    if (layer.protected) {
        showToast("Questo layer è protetto e non può essere cancellato.", "error");
        return;
    }
    if (confirm(`Sei sicuro di voler cancellare il layer "${layer.name}"?`)) {
        config.external_layers.splice(index, 1);
        await saveConfigAndReload();
    }
}
async function saveConfigAndReload() {
    await fetch('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(config) });
    showToast("Configurazione dei layer salvata. La pagina verrà ricaricata.", 'success');
    setTimeout(() => window.location.reload(), 1500);
}
function loadExternalLayers() {
    for (const key in loadedExternalLayers) {
        if (map.hasLayer(loadedExternalLayers[key])) {
            map.removeLayer(loadedExternalLayers[key]);
        }
        if (layerControl) {
            layerControl.removeLayer(loadedExternalLayers[key]);
        }
    }
    
    loadedExternalLayers = {};

    if (!config.external_layers) {
        return [];
    }
    
    const promises = [];

    const onEachFeaturePopup = (feature, layer) => {
        if (feature.properties) {
            let popupContent = '<div style="max-height: 200px; overflow-y: auto;"><b>Proprietà:</b><br>';
            for (const [key, value] of Object.entries(feature.properties)) {
                popupContent += `<b>${key}:</b> ${value}<br>`;
            }
            popupContent += '</div>';
            layer.bindPopup(popupContent);
        }
    };

    config.external_layers.forEach((layerConfig, index) => {
        const layerId = `${layerConfig.type}-${index}`;
        let layer;

        if (layerConfig.type === 'wms') {
            const proxyUrl = `/api/wms_proxy`;
            layer = L.tileLayer.wms(proxyUrl, {
                ...layerConfig,
                pane: 'shapefilePane',
                wms_server_url: layerConfig.url,
                version: '1.3.0',
                crs: L.CRS.EPSG4326
            });
            loadedExternalLayers[layerId] = layer;
            layerControl.addOverlay(layer, layerConfig.name);
        }
        else if (layerConfig.type === 'wfs') {
            layer = L.geoJSON(null, {
                pane: 'shapefilePane',
                style: () => layerConfig.style,
                onEachFeature: onEachFeaturePopup
            });
            
            const params = new URLSearchParams({
                wfs_server_url: layerConfig.url,
                service: 'WFS', version: '2.0.0', request: 'GetFeature',
                typeName: layerConfig.typeName, outputFormat: 'GEOJSON',
                authentication: layerConfig.authentication || 'none',
                username: layerConfig.username || '', password: layerConfig.password || ''
            });
            const proxyUrl = `/api/wfs_proxy?${params.toString()}`;

            const promise = fetch(proxyUrl)
                .then(res => res.ok ? res.json() : Promise.reject(new Error(`Errore HTTP ${res.status}`)))
                .then(data => {
                    if (data.error) throw new Error(data.error);
                    layer.addData(data);
                    showToast(`Layer WFS "${layerConfig.name}" caricato.`, 'success');
                })
                .catch(error => {
                    console.error(`Errore caricamento WFS ${layerConfig.name}:`, error);
                    showToast(`Errore caricamento WFS "${layerConfig.name}": ${error.message}`, 'error');
                });
            
            loadedExternalLayers[layerId] = layer;
            layerControl.addOverlay(layer, layerConfig.name);
            promises.push(promise);
        }
        else if (layerConfig.type === 'geojson') {
            layer = L.geoJSON(null, {
                pane: 'shapefilePane',
                style: () => layerConfig.style,
                onEachFeature: onEachFeaturePopup
            });

            const promise = fetch(layerConfig.url)
                .then(res => res.ok ? res.json() : Promise.reject(new Error(`Errore HTTP ${res.status}`)))
                .then(data => {
                    layer.addData(data);
                    showToast(`Layer GeoJSON "${layerConfig.name}" caricato.`, 'success');
                })
                .catch(error => {
                    console.error(`Errore caricamento GeoJSON ${layerConfig.name}:`, error);
                    showToast(`Errore caricamento GeoJSON "${layerConfig.name}": ${error.message}`, 'error');
                });
            
            loadedExternalLayers[layerId] = layer;
            layerControl.addOverlay(layer, layerConfig.name);
            promises.push(promise);
        }
        else if (layerConfig.type === 'shp') {
            showToast(`Caricamento shapefile "${layerConfig.name}" in corso...`, 'info');
            const promise = shp(layerConfig.url).then(geojson => {
                const shpLayer = L.geoJSON(geojson, {
                    pane: 'shapefilePane',
                    style: () => layerConfig.style,
                    onEachFeature: onEachFeaturePopup
                });
                loadedExternalLayers[layerId] = shpLayer;
                layerControl.addOverlay(shpLayer, layerConfig.name);
                showToast(`Shapefile "${layerConfig.name}" caricato.`, 'success');
            }).catch(error => {
                console.error(`Errore caricamento Shapefile ${layerConfig.name}:`, error);
                showToast(`Errore caricamento Shapefile "${layerConfig.name}": ${error.message}`, 'error');
            });
            promises.push(promise);
        }
    });

    return promises;
}

// --- 8. ANALISI GEOSPAZIALE ---
async function precomputeAllIntersections() {
    showToast('Calcolo intersezioni geospaziali in corso...', 'info');
    
    const allCableFeatures = [];
    for (const layerId in loadedExternalLayers) {
        const externalLayer = loadedExternalLayers[layerId];
        // Assicurati che il layer sia un GeoJSON o abbia un metodo toGeoJSON valido e non sia nullo
        if (externalLayer && externalLayer.toGeoJSON) {
            const layerData = externalLayer.toGeoJSON();
            if (layerData && layerData.features) {
                allCableFeatures.push(...layerData.features);
            }
        }
    }

    if (allCableFeatures.length === 0) {
        showToast('Nessun layer di cavi trovato per l\'analisi.', 'info');
        return;
    }
    
    for (const boxId in gridLayers) {
        const boxLayer = gridLayers[boxId];
        const bounds = boxLayer.getBounds();
        const boxPolygon = turf.polygon([[
            [bounds.getWest(), bounds.getSouth()],
            [bounds.getEast(), bounds.getSouth()],
            [bounds.getEast(), bounds.getNorth()],
            [bounds.getWest(), bounds.getNorth()],
            [bounds.getWest(), bounds.getSouth()]
        ]]);

        const intersectingCables = [];
        for (const cableFeature of allCableFeatures) {
            // Controlla che cableFeature.geometry esista prima di passare a turf.booleanIntersects
            if (cableFeature.geometry && turf.booleanIntersects(boxPolygon, cableFeature)) {
                const props = cableFeature.properties;
                const cableInfo = {
                    name: props.Name || props.nome || 'Cavo senza nome',
                    NOBJNM: props.NOBJNM || 'N/D'
                };
                intersectingCables.push(cableInfo);
            }
        }
        
        intersectionCache[boxId] = intersectingCables;
    }

    console.log("Pre-calcolo intersezioni completato.", intersectionCache);
    showToast('Analisi intersezioni completata!', 'success');
}

// --- 9. DASHBOARD E REPORT ---
function renderExpiredLogsList() {
    const container = document.getElementById('expired-logs-list');
    const expiredBoxes = [];
    const oggi = new Date();
    oggi.setHours(0, 0, 0, 0);

    for (const boxId in tuttiDatiLog) {
        const logsPerBox = tuttiDatiLog[boxId];
        if (logsPerBox && logsPerBox.length > 0) {
            // Prendi il log più recente per determinare la scadenza
            const logPiuRecente = logsPerBox.sort((a, b) => new Date(b.log_timestamp) - new Date(a.log_timestamp))[0];
            
            // Estrai solo la parte della data per il confronto
            const dataBox = new Date(logPiuRecente.log_timestamp.split(' ')[0]);
            dataBox.setHours(0, 0, 0, 0); // Azzera l'orario per confrontare solo le date

            const differenzaGiorni = (oggi - dataBox) / (1000 * 3600 * 24);

            if (differenzaGiorni > GIORNI_BORDO_ROSSO) {
                expiredBoxes.push({
                    boxId: boxId,
                    log: logPiuRecente
                });
            }
        }
    }

    if (expiredBoxes.length === 0) {
        container.innerHTML = '<p style="padding: 10px;">Nessun box scaduto.</p>';
        return;
    }

    expiredBoxes.sort((a, b) => a.boxId.localeCompare(b.boxId));

    let html = '';
    expiredBoxes.forEach(item => {
        const intersections = intersectionCache[item.boxId] || [];
        const cablesText = intersections.length > 0 ? `Cavi: ${intersections.map(c => c.name).join(', ')}` : 'Nessuna intersezione';
        html += `
            <div class="content-item" style="padding: 10px;">
                <b>Box: ${item.boxId}</b><br>
                <small>Ultimo log: ${item.log.log_timestamp}</small><br>
                <small>Nave: ${item.log.ship}</small><br>
                <small style="color: #007BFF;">${cablesText}</small>
            </div>
        `;
    });
    container.innerHTML = html;
}
function openDashboard() {
    updateDashboardStats();
    renderTodaysActivityDetail();
    renderExpiredLogsList();
    createOrUpdateCharts();
    openModal('modal-dashboard');
}
function updateDashboardStats() {
    const allLogs = Object.values(tuttiDatiLog).flat();
    document.getElementById('stat-total-logs').textContent = allLogs.length;
    const todayString = new Date().toISOString().split('T')[0];
    const logsToday = allLogs.filter(log => log.log_timestamp.startsWith(todayString)).length;
    document.getElementById('stat-today').textContent = logsToday;
}
function renderTodaysActivityDetail() {
    const container = document.getElementById('today-activity-detail');
    const todayString = new Date().toISOString().split('T')[0];
    const logsToday = Object.values(tuttiDatiLog).flat().filter(log => log.log_timestamp.startsWith(todayString));
    if (logsToday.length === 0) {
        container.innerHTML = "<p>Nessuna attività registrata oggi.</p>";
        return;
    }
    let html = '';
    logsToday.sort((a,b) => a.box_id.localeCompare(b.box_id)).forEach(log => {
        const timePart = log.log_timestamp.split(' ')[1] || '';
        const intersections = intersectionCache[log.box_id] || [];
        const cablesText = intersections.length > 0 ? ` <span style="color: #007BFF;">(Interseca: ${intersections.map(c => c.name).join(', ')})</span>` : '';

        html += `<div class="history-item" style="padding: 5px 0;">` +
                `<span style="color:${COLOR_MAP[log.color_code]}; font-weight:bold;">●</span> ` +
                `Nave <b>${log.ship}</b> ha loggato il box <b>${log.box_id}</b> alle ${timePart}.${cablesText}` +
                `</div>`;
    });
    container.innerHTML = html;
}
function createOrUpdateCharts() {
    const allLogs = Object.values(tuttiDatiLog).flat();
    const colorCounts = allLogs.reduce((acc, log) => { acc[log.color_code] = (acc[log.color_code] || 0) + 1; return acc; }, {});
    const colorLabels = Object.keys(colorCounts).map(code => ({'1':'Rosso','2':'Blu','3':'Verde'}[code] || 'Sconosciuto'));
    const colorData = Object.values(colorCounts);
    const colorBackgrounds = Object.keys(colorCounts).map(code => COLOR_MAP[code] || '#808080');
    const shipCounts = allLogs.reduce((acc, log) => { acc[log.ship] = (acc[log.ship] || 0) + 1; return acc; }, {});
    const shipLabels = Object.keys(shipCounts);
    const shipData = Object.values(shipCounts);
    const colorCtx = document.getElementById('colorChart').getContext('2d');
    if (colorChartInstance) colorChartInstance.destroy();
    colorChartInstance = new Chart(colorCtx, {
        type: 'doughnut',
        data: { labels: colorLabels, datasets: [{ data: colorData, backgroundColor: colorBackgrounds, borderColor: '#fff', borderWidth: 2 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'top' }, title: { display: true, text: 'Distribuzione Attività per Tipo' } } }
    });
    const shipCtx = document.getElementById('shipChart').getContext('2d');
    if (shipChartInstance) shipChartInstance.destroy();
    shipChartInstance = new Chart(shipCtx, {
        type: 'bar',
        data: { labels: shipLabels, datasets: [{ label: 'Numero di Log', data: shipData, backgroundColor: '#008CBA' }] },
        options: { responsive: true, maintainAspectRatio: false, indexAxis: 'y', plugins: { legend: { display: false }, title: { display: true, text: 'Attività per Nave' } }, scales: { x: { beginAtZero: true } } }
    });
}

function generateCableReportData() {
    const invertedIntersections = {};

    for (const boxId in intersectionCache) {
        const cables = intersectionCache[boxId];
        for (const cableInfo of cables) {
            if (!invertedIntersections[cableInfo.name]) {
                invertedIntersections[cableInfo.name] = {
                    NOBJNM: cableInfo.NOBJNM,
                    boxes: []
                };
            }
            invertedIntersections[cableInfo.name].boxes.push(boxId);
        }
    }

    const reportData = {};
    for (const cableName in invertedIntersections) {
        const cableData = invertedIntersections[cableName];
        reportData[cableName] = {
            NOBJNM: cableData.NOBJNM,
            boxes: []
        };
        
        for (const boxId of cableData.boxes) {
            const logsForBox = tuttiDatiLog[boxId] || [];
            let lastLogTimestamp = 'Nessun Log';
            let lastShip = '-';

            if (logsForBox.length > 0) {
                // Ordina per prendere l'ultimo log basato sul timestamp completo
                const latestLog = logsForBox.reduce((latest, current) => {
                    return new Date(current.log_timestamp) > new Date(latest.log_timestamp) ? current : latest;
                });
                lastLogTimestamp = latestLog.log_timestamp;
                lastShip = latestLog.ship;
            }
            reportData[cableName].boxes.push({ boxId: boxId, lastLog: lastLogTimestamp, lastShip: lastShip });
        }
    }
    cableReportCache = reportData;
    console.log("Report per cavo generato.", cableReportCache);
}

function renderCableReport() {
    const container = document.getElementById('cable-report-container');
    if (!container) return;

    // Assicurati che i dati del report siano stati generati prima di renderizzare
    generateCableReportData(); 
    const sortedCableNames = Object.keys(cableReportCache).sort();

    if (sortedCableNames.length === 0) {
        container.innerHTML = '<p style="padding: 20px; text-align: center;">Nessuna intersezione trovata.</p>';
        return;
    }

    let tableHTML = '<table id="cable-report-table" class="history-table" style="width: 100%;">';
    tableHTML += `
        <thead>
            <tr>
                <th>Nome Cavo</th>
                <th>Collega</th>
                <th>Box Intersecato</th>
                <th>Data Ultima Ispezione</th>
                <th>Assetto (Nave)</th>
            </tr>
        </thead>
        <tbody>
    `;

    for (const cableName of sortedCableNames) {
        const cableData = cableReportCache[cableName];
        const boxData = cableData.boxes;
        if (boxData.length > 0) {
            boxData.sort((a, b) => a.boxId.localeCompare(b.boxId));

            const totalRows = boxData.length;
            tableHTML += `
                <tr>
                    <td rowspan="${totalRows}" style="vertical-align: top; border-bottom: 2px solid #000;"><b>${cableName}</b></td>
                    <td rowspan="${totalRows}" style="vertical-align: top; border-bottom: 2px solid #000;">${cableData.NOBJNM}</td>
                    <td>${boxData[0].boxId}</td>
                    <td>${boxData[0].lastLog}</td>
                    <td>${boxData[0].lastShip}</td>
                </tr>
            `;
            for (let i = 1; i < totalRows; i++) {
                tableHTML += `
                    <tr>
                        <td>${boxData[i].boxId}</td>
                        <td>${boxData[i].lastLog}</td>
                        <td>${boxData[i].lastShip}</td>
                    </tr>
                `;
            }
            // Aggiungi un bordo inferiore solo all'ultima riga di un gruppo se ce ne sono più di una
            if (totalRows > 1) {
                const lastRowIndex = tableHTML.lastIndexOf('<tr>');
                tableHTML = tableHTML.substring(0, lastRowIndex) + '<tr style="border-bottom: 2px solid #000;">' + tableHTML.substring(lastRowIndex + 4);
            }
        }
    }

    tableHTML += '</tbody></table>';
    container.innerHTML = tableHTML;
}

function openCableReport() {
    renderCableReport(); // Chiamata diretta della funzione resa disponibile
    openModal('modal-cable-report');
}

function exportCableReportToPDF() {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({
        orientation: 'landscape',
        unit: 'pt',
        format: 'a4'
    });

    const title = "Report Stato Sorveglianza Cavi";
    const timestamp = `Generato il: ${new Date().toLocaleString('it-IT')}`;

    doc.setFontSize(18);
    doc.text(title, 40, 40);
    doc.setFontSize(10);
    doc.text(timestamp, 40, 55);

    try {
        doc.autoTable({
            html: '#cable-report-table',
            startY: 70,
            theme: 'grid',
            headStyles: {
                fillColor: [41, 128, 185],
                textColor: 255
            },
            didDrawCell: (data) => {
                // Questa logica serve per gestire le rowspan nella tabella HTML,
                // assicurandosi che i bordi siano disegnati correttamente
                if (data.column.index <= 1 && data.cell.raw && data.cell.raw.rowSpan > 1) {
                    doc.rect(data.cell.x, data.cell.y, data.cell.width, data.cell.height * data.cell.raw.rowSpan, 'S');
                    doc.autoTableText(data.cell.text, data.cell.x + data.cell.padding('left'), data.cell.y + data.cell.height / 2, {
                        halign: 'left',
                        valign: 'middle'
                    });
                }
            }
        });
    } catch (e) {
        console.error("Errore durante la generazione della tabella PDF:", e);
        showToast("Impossibile generare il PDF.", "error");
        return;
    }

    doc.save('report_cavi.pdf');
}


// --- 10. GESTIONE LOG COMPLETA (MODAL) ---
function openLogManager() {
    currentPage = 1; // Resetta la pagina alla prima all'apertura
    renderLogTable();
    populateImportSelect();
    openModal('modal-log-manager');
}
function renderLogTable(logs) {
    const tableBody = document.getElementById('log-table-body');
    const paginationContainer = document.getElementById('log-pagination');
    if (!tableBody || !paginationContainer) return;

    // Filtra i log prima di impaginarli
    let filteredLogs = logs;
    if (!filteredLogs) {
        filteredLogs = Object.values(tuttiDatiLog).flat();
        const dateFilter = document.getElementById('log-table-filter-date').value;
        const shipFilter = document.getElementById('log-table-filter-ship').value.toLowerCase();
        const colorFilter = document.getElementById('log-table-filter-color').value;

        filteredLogs = filteredLogs.filter(log => {
            const shipMatch = !shipFilter || log.ship.toLowerCase().includes(shipFilter);
            // Il confronto della data deve tenere conto del formato YYYY-MM-DD HH:MM:SS
            const dateMatch = !dateFilter || log.log_timestamp.startsWith(dateFilter);
            const colorMatch = !colorFilter || log.color_code === colorFilter;
            return shipMatch && dateMatch && colorMatch;
        });
    }

    // Ordina i log per timestamp decrescente per la visualizzazione nella tabella
    filteredLogs.sort((a, b) => new Date(b.log_timestamp) - new Date(a.log_timestamp));

    const totalPages = Math.ceil(filteredLogs.length / logsPerPage);
    const start = (currentPage - 1) * logsPerPage;
    const end = start + logsPerPage;
    const paginatedLogs = filteredLogs.slice(start, end);

    tableBody.innerHTML = paginatedLogs.map(log => {
        const intersections = intersectionCache[log.box_id] || [];
        const cablesText = intersections.map(c => c.name).join(', ') || '-';
        return `
            <tr data-log-id="${log.id}">
                <td><input type="checkbox" class="log-select-checkbox" value="${log.id}"></td>
                <td>${log.log_timestamp}</td>
                <td>${log.box_id}</td>
                <td>${log.ship}</td>
                <td><span style="color:${COLOR_MAP[log.color_code] || '#808080'}; font-size: 1.2em; font-weight:bold;">●</span></td>
                <td>${log.import_id || 'manual'}</td>
                <td>${cablesText}</td>
            </tr>
        `}).join('') || '<tr><td colspan="7" class="empty-row" style="text-align:center; padding: 15px;">Nessun log trovato.</td></tr>';

    // Gestione della paginazione
    paginationContainer.innerHTML = '';
    if (totalPages > 1) {
        const prevButton = document.createElement('button');
        prevButton.textContent = 'Precedente';
        prevButton.disabled = currentPage === 1;
        prevButton.classList.add('pagination-button');
        prevButton.onclick = () => { currentPage--; renderLogTable(); };
        paginationContainer.appendChild(prevButton);

        const pageInfo = document.createElement('span');
        pageInfo.textContent = ` Pagina ${currentPage} di ${totalPages} `;
        pageInfo.classList.add('page-info');
        paginationContainer.appendChild(pageInfo);

        const nextButton = document.createElement('button');
        nextButton.textContent = 'Successiva';
        nextButton.disabled = currentPage === totalPages;
        nextButton.classList.add('pagination-button');
        nextButton.onclick = () => { currentPage++; renderLogTable(); };
        paginationContainer.appendChild(nextButton);
    }
    
    // Aggiorna lo stato del checkbox "Seleziona Tutto"
    const masterCheckbox = document.querySelector('#log-table-body').closest('table').querySelector('th input[type="checkbox"]');
    if (masterCheckbox) {
        masterCheckbox.checked = false; // Deseleziona tutto al cambio pagina o filtro
    }
}
async function populateImportSelect() {
    try {
        const response = await fetch('/api/imports');
        if (!response.ok) throw new Error('Errore di rete nel fetch degli imports');
        const imports = await response.json();
        const select = document.getElementById('import-select');
        if (!select) return;

        select.innerHTML = '<option value="">Seleziona un batch...</option>';
        imports.forEach(importId => {
            select.innerHTML += `<option value="${importId}">${importId}</option>`;
        });
    } catch (error) {
        console.error("Errore nel caricamento dei batch di importazione:", error);
        showToast("Errore caricamento batch di importazione", 'error');
    }
}
function applyLogTableFilters() {
    currentPage = 1; // Resetta alla prima pagina quando i filtri cambiano
    renderLogTable();
}
function resetLogTableFilters() {
    document.getElementById('log-table-filter-date').value = '';
    document.getElementById('log-table-filter-ship').value = '';
    document.getElementById('log-table-filter-color').value = '';
    // Non azzerare il master checkbox qui, verrà gestito da renderLogTable
    currentPage = 1; // Resetta alla prima pagina
    renderLogTable();
}
function toggleSelectAll(masterCheckbox) {
    const checkboxes = document.querySelectorAll('#log-table-body .log-select-checkbox');
    checkboxes.forEach(cb => {
        cb.checked = masterCheckbox.checked;
    });
}
async function deleteSelectedImport() {
    const importId = document.getElementById('import-select').value;
    if (!importId) {
        showToast('Seleziona un batch di importazione da eliminare.', 'error');
        return;
    }
    if (confirm(`Sei sicuro di voler eliminare tutti i log dall'import "${importId}"? L'azione è irreversibile.`)) {
        await fetch('/api/logs/batch_delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ import_id: importId })
        });
        showToast(`Batch "${importId}" eliminato con successo.`, 'info');
        // Il broadcast gestirà l'aggiornamento del DOM
    }
}
async function deleteSelectedLogs() {
    const selectedIds = Array.from(document.querySelectorAll('#log-table-body .log-select-checkbox:checked')).map(cb => cb.value);
    if (selectedIds.length === 0) {
        showToast('Nessun log selezionato.', 'error');
        return;
    }
    if (confirm(`Sei sicuro di voler eliminare i ${selectedIds.length} log selezionati? L'azione è irreversibile.`)) {
         await fetch('/api/logs/batch_delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ log_ids: selectedIds })
        });
        showToast(`Eliminati ${selectedIds.length} log selezionati.`, 'info');
        // Il broadcast gestirà l'aggiornamento del DOM
    }
}
function exportVisibleLogs() {
    const headers = ["Timestamp", "Box", "Nave", "Colore", "Import ID", "Cavi Intersecati"];
    const rows = Array.from(document.querySelectorAll('#log-table-body tr:not(.empty-row)')); // Escludi la riga "Nessun log trovato."

    if (rows.length === 0) {
        showToast('Nessun dato da esportare.', 'info');
        return;
    }

    let csvContent = headers.join(";") + "\n";
    rows.forEach(row => {
        // Ignora il primo td (checkbox) e mappa gli innerText delle celle
        const rowData = Array.from(row.cells).slice(1).map(cell => {
            // Pulizia del testo per il CSV, rimuovendo emoji o caratteri non desiderati
            let cellText = cell.innerText;
            if (cell.querySelector('span[style*="font-weight:bold"]')) { // Se è la cella del colore
                cellText = cell.innerText.replace('●', '').trim(); // Rimuovi il pallino
                // Oppure potresti voler convertire il codice colore effettivo
                // ad esempio, trovare il value di log.color_code in base allo stile del pallino
            }
            return `"${cellText.replace(/"/g, '""')}"`; // Escapa le virgolette e avvolge tra virgolette
        });
        csvContent += rowData.join(";") + "\n";
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "log_visibili_export.csv";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}


// --- 11. CARICAMENTO INIZIALE E WEBSOCKETS ---
async function caricaLogIniziali() {
    try {
        const response = await fetch('/api/logs');
        if (!response.ok) throw new Error("Errore nel fetch dei log");
        tuttiDatiLog = await response.json();
        renderizzaStili(); // Aggiorna la mappa con i dati iniziali
    } catch(e) { console.error("Impossibile caricare dati log:", e); }
}

function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws_url = `${protocol}//${window.location.host}/ws`;

    console.log(`Tentativo di connessione a WebSocket: ${ws_url}`);

    const ws = new WebSocket(ws_url);

    ws.onmessage = function(event) {
        const message = JSON.parse(event.data);
        console.log("WebSocket message received:", message);

        if (message.type === 'config_updated') {
            showToast("Configurazione aggiornata. Ricaricamento in corso...", 'info');
            setTimeout(() => window.location.reload(), 1500);
            return; 
        }

        if (message.type === 'box_history_updated') {
            tuttiDatiLog[message.boxId] = message.data;
            renderizzaStili();
            // Se il pannello storico è aperto per il box aggiornato, renderizza di nuovo la cronologia
            if (document.getElementById('history-title').innerText.includes(message.boxId)) {
                renderHistory(message.boxId);
            }
            generateCableReportData();
        }

        if (message.type === 'all_logs_updated') { // Nuovo tipo di messaggio per aggiornamenti massivi
            tuttiDatiLog = message.data;
            renderizzaStili();
            generateCableReportData(); // Rigenera la cache delle intersezioni per il report cavi
            // Aggiorna la selezione degli import se la modale è aperta
            if (document.getElementById('modal-log-manager').classList.contains('visible')) {
                populateImportSelect();
                renderLogTable(); // Ricarica la tabella dei log
            }
            // Aggiorna anche la dashboard se è aperta
            if (document.getElementById('modal-dashboard').classList.contains('visible')) {
                updateDashboardStats();
                renderTodaysActivityDetail();
                renderExpiredLogsList();
                createOrUpdateCharts();
            }
        }
      
        if (document.getElementById('modal-dashboard').classList.contains('visible')) {
             updateDashboardStats();
             renderTodaysActivityDetail();
             renderExpiredLogsList();
             createOrUpdateCharts();
        }
        if (document.getElementById('modal-log-manager').classList.contains('visible')) {
             renderLogTable(); // Assicura che la tabella dei log sia aggiornata se visibile
        }
    };

    ws.onclose = () => {
        console.log("WebSocket disconnesso. Riconnessione tra 5 secondi...");
        setTimeout(connectWebSocket, 5000);
    };
    
    ws.onerror = (err) => {
        console.error("Errore WebSocket:", err);
        ws.close();
    };
}
async function inizializzaApplicazione() {
    document.getElementById('dateInput').valueAsDate = new Date();

    try {
        const response = await fetch('/api/config');
        if (!response.ok) throw new Error('File di configurazione non trovato sul server.');
        config = await response.json();
        
        map = L.map('map').setView([43.5, 16], 7);
        
        const baseMapLayer = L.tileLayer(config.base_map.url_template, { attribution: config.base_map.attribution });
        baseMapLayer.addTo(map);

        gridLayerGroup = L.featureGroup().addTo(map);
        gridLabelsLayerGroup = L.featureGroup();

        const baseLayers = { "Mappa Base": baseMapLayer };
        const overlayLayers = { 
            "Griglia Interattiva": gridLayerGroup,
            "ID Box": gridLabelsLayerGroup 
        };
        layerControl = L.control.layers(baseLayers, overlayLayers, { collapsed: true }).addTo(map);
        
        map.createPane('shapefilePane');
        map.getPane('shapefilePane').style.zIndex = 390;

        const gridBounds = config.grid_bounds;
        document.getElementById('lat_start').value = gridBounds.lat_start;
        document.getElementById('lon_start').value = gridBounds.lon_start;
        document.getElementById('lat_end').value = gridBounds.lat_end;
        document.getElementById('lon_end').value = gridBounds.lon_end;
        
        await disegnaGriglia(gridBounds);
        
        const layerPromises = loadExternalLayers();

        await Promise.allSettled(layerPromises);

        // Precompute intersezioni dopo che i layer esterni sono caricati
        await precomputeAllIntersections();

        // Genera i dati del report cavi inizialmente
        generateCableReportData();

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