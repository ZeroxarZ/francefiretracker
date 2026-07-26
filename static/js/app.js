const franceBounds = [[41.0, -5.5], [51.5, 10.0]];
const map = L.map('map', { 
    zoomControl: false, attributionControl: false,
    minZoom: 6, maxBounds: franceBounds, maxBoundsViscosity: 1.0 
}).setView([44.75, -0.60], 9);

const darkTile = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { maxZoom: 18 });
const satTile = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 18 });

let currentMapMode = 'dark';
darkTile.addTo(map);
L.control.zoom({ position: 'bottomright' }).addTo(map);

// 👉 Fumées et Vent initialisés à vide / non ajoutés à la carte par défaut pour la fluidité
const plumeLayer = L.layerGroup(); 
const fireLayer = L.layerGroup().addTo(map);
const aircraftLayer = L.layerGroup().addTo(map);
const airportLayer = L.layerGroup().addTo(map);

const aircraftMarkers = {};
const fireMarkers = {};

let activePolylineOuter = null;
let activePolylineCore = null;
let selectedCallsign = null;
let latestWeatherData = null;

const persistentTraces = {};

function toggleLegend() {
    const content = document.getElementById('legend-items');
    const arrow = document.getElementById('legend-arrow');
    if (content.style.display === 'none') {
        content.style.display = 'flex';
        arrow.innerText = '▼';
    } else {
        content.style.display = 'none';
        arrow.innerText = '▲';
    }
}

async function fetchVersion() {
    try {
        const res = await fetch('/api/version');
        const data = await res.json();
        if (data.version) {
            document.getElementById('app-version').innerText = data.version;
        }
    } catch (err) {}
}

async function selectAircraft(callsign, lat, lon, localTrail, isTactical, hexCode) {
    selectedCallsign = callsign;
    
    if (activePolylineOuter) map.removeLayer(activePolylineOuter);
    if (activePolylineCore) map.removeLayer(activePolylineCore);
    activePolylineOuter = null; activePolylineCore = null;
    
    if (!persistentTraces[callsign] || persistentTraces[callsign].length < 2) {
        persistentTraces[callsign] = localTrail && localTrail.length > 0 ? [...localTrail] : [[lat, lon]];
    }
    
    const glowColor = isTactical ? '#ff8800' : '#0088ff';
    const coreColor = isTactical ? '#ffff00' : '#00ffff';
    
    activePolylineOuter = L.polyline(persistentTraces[callsign], { color: glowColor, weight: 8, opacity: 0.4, lineCap: 'round', lineJoin: 'round' }).addTo(map);
    activePolylineCore = L.polyline(persistentTraces[callsign], { color: coreColor, weight: 3, opacity: 0.95, dashArray: '6, 6', lineCap: 'round' }).addTo(map);
    
    const isMobile = window.innerWidth <= 768;
    const targetLat = isMobile ? lat - 0.04 : lat;
    
    map.flyTo([targetLat, lon], 12, { animate: true, duration: 1.2 });
    setTimeout(() => { if (aircraftMarkers[callsign]) aircraftMarkers[callsign].openPopup(); }, 1250);

    const traceId = (hexCode && hexCode !== "N/A") ? hexCode : callsign;
    try {
        const res = await fetch(`/api/trace/${traceId}`);
        const traceData = await res.json();
        if (traceData.coords && traceData.coords.length > 3) {
            persistentTraces[callsign] = [...traceData.coords, ...persistentTraces[callsign]];
            
            const cleanCoords = [];
            persistentTraces[callsign].forEach(pt => {
                if (cleanCoords.length === 0 || Math.abs(cleanCoords[cleanCoords.length-1][0] - pt[0]) > 0.00005 || Math.abs(cleanCoords[cleanCoords.length-1][1] - pt[1]) > 0.00005) {
                    cleanCoords.push(pt);
                }
            });
            persistentTraces[callsign] = cleanCoords;
            
            if (activePolylineOuter) activePolylineOuter.setLatLngs(persistentTraces[callsign]);
            if (activePolylineCore) activePolylineCore.setLatLngs(persistentTraces[callsign]);
        }
    } catch (err) {}
}

function selectFire(lat, lon, markerId) {
    const isMobile = window.innerWidth <= 768;
    const targetLat = isMobile ? lat - 0.03 : lat;
    map.flyTo([targetLat, lon], 13, { animate: true, duration: 1.2 });
    setTimeout(() => { if (fireMarkers[markerId]) fireMarkers[markerId].openPopup(); }, 1250);
}

function toggleMobileDrawer() {
    const sidebar = document.getElementById('sidebar-panel');
    const toggleText = document.getElementById('drawer-toggle-text');
    sidebar.classList.toggle('drawer-collapsed');
    toggleText.innerText = sidebar.classList.contains('drawer-collapsed') ? "▲ Agrandir le panneau" : "▼ Réduire le panneau";
}

function switchMobileTab(tabName) {
    document.getElementById('tab-btn-aircraft').classList.remove('active');
    document.getElementById('tab-btn-fires').classList.remove('active');
    document.getElementById(`tab-btn-${tabName}`).classList.add('active');
    
    document.getElementById('panel-aircraft').style.display = tabName === 'aircraft' ? 'flex' : 'none';
    document.getElementById('panel-fires').style.display = tabName === 'fires' ? 'flex' : 'none';
}

function openWeatherModal() {
    if (!latestWeatherData) return;
    document.getElementById('modal-city').innerText = latestWeatherData.city || "Secteur Sud-Ouest";
    const grid = document.getElementById('forecast-container'); grid.innerHTML = '';
    const f6h = latestWeatherData.forecast_6h || [];
    if (f6h.length === 0) {
        grid.innerHTML = '<div style="grid-column: span 6; padding:20px; text-align:center;">Prévisions horaires indisponibles.</div>';
    } else {
        f6h.forEach(h => {
            grid.innerHTML += `<div class="forecast-card"><div class="forecast-time">${h.time}</div><div class="forecast-temp">${h.temp}°C</div><div class="forecast-detail">💧 Hum: ${h.hum}%</div><div class="forecast-detail">💨 ${h.wind_speed} km/h (${h.wind_dir}°)</div><div class="forecast-detail" style="color:${h.rain > 0 ? '#00e5ff' : '#8a9ba8'}; font-weight:700;">🌧️ ${h.rain} mm</div></div>`;
        });
    }
    document.getElementById('weather-modal').style.display = 'flex';
}
function closeWeatherModal(event, force) { if (force || event.target.id === 'weather-modal') document.getElementById('weather-modal').style.display = 'none'; }

function toggleSection(sectionName) {
    const panel = document.getElementById(`panel-${sectionName}`);
    const btn = document.getElementById(`btn-collapse-${sectionName}`);
    panel.classList.toggle('collapsed');
    btn.innerText = panel.classList.contains('collapsed') ? '+' : '−';
}

function switchMapStyle() {
    const btn = document.getElementById('btn-map-switch');
    if (currentMapMode === 'dark') {
        map.removeLayer(darkTile); satTile.addTo(map); currentMapMode = 'sat';
        btn.innerText = "🗺️ Satellite HD"; btn.style.background = "linear-gradient(135deg, #2b1f15, #614023)";
    } else {
        map.removeLayer(satTile); darkTile.addTo(map); currentMapMode = 'dark';
        btn.innerText = "🗺️ Carte Noire"; btn.style.background = "linear-gradient(135deg, #1b2838, #2a3f5f)";
    }
}

// 👉 Fumées et Vent désactivés par défaut (false)
const activeLayers = { aircraft: true, airports: true, fires: true, plumes: false, weather: false };
function toggleLayer(layerName) {
    activeLayers[layerName] = !activeLayers[layerName];
    const btn = document.getElementById(`btn-${layerName}`);
    if (activeLayers[layerName]) {
        btn.classList.add('active');
        if (layerName === 'aircraft') map.addLayer(aircraftLayer);
        if (layerName === 'airports') map.addLayer(airportLayer);
        if (layerName === 'fires') map.addLayer(fireLayer);
        if (layerName === 'plumes') map.addLayer(plumeLayer);
        if (layerName === 'weather') startWeatherAnimation();
    } else {
        btn.classList.remove('active');
        if (layerName === 'aircraft') map.removeLayer(aircraftLayer);
        if (layerName === 'airports') map.removeLayer(airportLayer);
        if (layerName === 'fires') map.removeLayer(fireLayer);
        if (layerName === 'plumes') map.removeLayer(plumeLayer);
        if (layerName === 'weather') stopWeatherAnimation();
    }
}

const canvas = document.getElementById('weather-canvas');
const ctx = canvas.getContext('2d');
let particles = []; let animId = null;
let currentWindDir = 240; let currentWindSpeed = 15; let currentRain = 0.0;

function resizeCanvas() { canvas.width = window.innerWidth; canvas.height = window.innerHeight - 90; }
window.addEventListener('resize', resizeCanvas); resizeCanvas();

function initWeatherParticles() {
    particles = []; const count = currentRain > 0.1 ? 250 : 150;
    for (let i = 0; i < count; i++) {
        particles.push({
            x: Math.random() * canvas.width, y: Math.random() * canvas.height,
            length: Math.random() * 20 + 12,
            speed: (Math.random() * 0.8 + 0.6) * Math.max(2.0, currentWindSpeed * 0.25),
            opacity: Math.random() * 0.5 + 0.2
        });
    }
}

function startWeatherAnimation() { if (!animId && activeLayers.weather) { initWeatherParticles(); animateWeather(); } }
function stopWeatherAnimation() { if (animId) { cancelAnimationFrame(animId); animId = null; ctx.clearRect(0, 0, canvas.width, canvas.height); } }

function animateWeather() {
    if (!activeLayers.weather) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const angleRad = ((currentWindDir + 180) % 360) * (Math.PI / 180);
    const dx = Math.sin(angleRad); const dy = -Math.cos(angleRad);
    
    if (currentRain > 0.1) { ctx.strokeStyle = 'rgba(100, 190, 255, 0.65)'; ctx.lineWidth = 1.6; }
    else if (currentMapMode === 'sat') { ctx.strokeStyle = 'rgba(255, 255, 255, 0.75)'; ctx.lineWidth = 1.4; }
    else { ctx.strokeStyle = 'rgba(0, 229, 255, 0.5)'; ctx.lineWidth = 1.2; }
    
    ctx.beginPath();
    for (let i = 0; i < particles.length; i++) {
        let p = particles[i];
        ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - dx * p.length, p.y - dy * p.length);
        p.x += dx * p.speed; p.y += dy * p.speed;
        if (currentRain > 0.1 && Math.random() < 0.02) { ctx.fillStyle = 'rgba(120, 200, 255, 0.8)'; ctx.fillRect(p.x, p.y, 2.5, 2.5); }
        if (p.x < 0) p.x = canvas.width; if (p.x > canvas.width) p.x = 0;
        if (p.y < 0) p.y = canvas.height; if (p.y > canvas.height) p.y = 0;
    }
    ctx.stroke(); animId = requestAnimationFrame(animateWeather);
}
map.on('move', () => { if (activeLayers.weather) ctx.clearRect(0, 0, canvas.width, canvas.height); });

function getPlaneIcon(heading, isTactical, role, acType) {
    const color = isTactical ? "#ffcc00" : "#4a759c";
    const scale = isTactical ? "1.25" : "0.85";
    const isHelico = (role && role.includes("Hélicoptère")) || ["EC25", "AS33", "H225", "EC45", "BK17", "H145", "EC55", "S365"].includes((acType || "").toUpperCase());
    
    let svgContent = "";
    if (isHelico) {
        svgContent = `<svg width="26" height="26" viewBox="0 0 24 24" fill="${color}" xmlns="http://www.w3.org/2000/svg"><path d="M2 11H22V13H2V11Z" fill="${color}" opacity="0.9"/><path d="M11 2V22H13V2Z" fill="${color}" opacity="0.9"/><path d="M10.5 6C7.5 6 5.5 8 5.5 11.5C5.5 14.5 7.5 16.5 11 16.5H15L19 18.5V15.5L17 14.5V8.5L14.5 6H10.5Z" fill="${color}"/><circle cx="19.5" cy="17" r="2.5" fill="${color}"/></svg>`;
    } else {
        svgContent = `<svg width="24" height="24" viewBox="0 0 24 24" fill="${color}" xmlns="http://www.w3.org/2000/svg"><path d="M21 16V14L13 9V3.5C13 2.67 12.33 2 11.5 2C10.67 2 10 2.67 10 3.5V9L2 14V16L10 13.5V19L8 20.5V22L11.5 21L15 22V20.5L13 19V13.5L21 16Z"/></svg>`;
    }
    return L.divIcon({ className: 'custom-plane-icon', html: `<div class="plane-icon-wrapper" style="transform: rotate(${heading}deg) scale(${scale});">${svgContent}</div>`, iconSize: [26, 26], iconAnchor: [13, 13] });
}

async function fetchAirports() {
    try {
        const res = await fetch('/api/airports'); const data = await res.json();
        airportLayer.clearLayers();
        data.airports.forEach(apt => {
            const icon = L.divIcon({ className: 'custom-airport-icon', html: `<div class="airport-marker" title="${apt.name}">✈️</div>`, iconSize: [22, 22], iconAnchor: [11, 11] });
            const marker = L.marker([apt.lat, apt.lon], { icon: icon }).addTo(airportLayer);
            marker.bindPopup(`<b>🛬 ${apt.name} (${apt.icao})</b><br><b>Rôle :</b> <span style="color:#00e5ff;">${apt.type}</span><br><b>Piste :</b> ${apt.rwy}`);
        });
    } catch (err) {}
}

let weatherTimeout = null;
async function fetchWeather() {
    try {
        const center = map.getCenter();
        const res = await fetch(`/api/weather?lat=${center.lat.toFixed(4)}&lon=${center.lng.toFixed(4)}`);
        const data = await res.json();
        
        latestWeatherData = data;
        document.getElementById('val-city').innerText = `${data.city || "Secteur Sud-Ouest"}`;
        document.getElementById('val-temp').innerText = `${data.temp} °C`;
        document.getElementById('val-hum').innerText = `${data.humidity} %`;
        document.getElementById('val-wind').innerText = `${data.wind_speed} km/h`;
        document.getElementById('val-dir').innerText = `${data.wind_dir}°`;
        document.getElementById('val-rain').innerText = `${data.precipitation || 0} mm`;
        
        currentWindDir = data.wind_dir || 240; currentWindSpeed = data.wind_speed || 15; currentRain = data.precipitation || 0;
        if (activeLayers.weather) { initWeatherParticles(); if (!animId) startWeatherAnimation(); }
    } catch (err) {}
}

map.on('moveend', () => { 
    if (weatherTimeout) clearTimeout(weatherTimeout); 
    weatherTimeout = setTimeout(() => { if (activeLayers.weather) fetchWeather(); }, 600); 
});

async function fetchFires() {
    try {
        const res = await fetch('/api/fires'); const data = await res.json();
        fireLayer.clearLayers(); plumeLayer.clearLayers();
        Object.keys(fireMarkers).forEach(k => delete fireMarkers[k]);
        
        const fireListElem = document.getElementById('fire-list-container'); fireListElem.innerHTML = '';
        if (data.latest_satellite_utc) {
            const dateObj = new Date(data.latest_satellite_utc);
            document.getElementById('sat-time-fr').innerText = `${dateObj.toLocaleString('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'short', timeStyle: 'medium' })} (Heure Légale Française)`;
        }
        if (!data.fires || data.fires.features.length === 0) {
            fireListElem.innerHTML = `<div class="card-item" style="border-left-color: #00dd66;">Aucun foyer thermique actif.</div>`;
            document.getElementById('fire-count').innerText = `0`; 
            if (document.getElementById('tab-count-fires')) document.getElementById('tab-count-fires').innerText = `0`;
            return;
        }
        
        // Ajout des fumées uniquement si le calque actif est activé par l'utilisateur
        const geoJsonPlumes = L.geoJSON(data.plumes, { style: { fillColor: '#ff3300', fillOpacity: 0.3, color: '#ff6600', weight: 1 } });
        if (activeLayers.plumes) geoJsonPlumes.addTo(plumeLayer);
        
        data.fires.features.forEach(fire => {
            const props = fire.properties; const coords = fire.geometry.coordinates;
            const isTactical = props.source && props.source.includes("Radar"); const iconBg = isTactical ? "#00aaff" : "#ff1e00";
            const ptTimeFr = new Date(props.time_utc).toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' });
            
            const fireIcon = L.divIcon({ className: 'custom-fire-marker', html: `<div class="fire-marker" style="background: ${iconBg};"></div>`, iconSize: [18, 18], iconAnchor: [9, 9] });
            const marker = L.marker([coords[1], coords[0]], { icon: fireIcon }).addTo(fireLayer);
            marker.bindPopup(`<b>🔥 ${props.name}</b><br><b>Heure FR:</b> ${ptTimeFr}<br><b>Source:</b> ${props.source}<br><b>Statut:</b> ${props.status}`);
            
            fireMarkers[props.id] = marker;
            fireListElem.innerHTML += `<div class="card-item fire" style="border-left-color: ${iconBg};" onclick="selectFire(${coords[1]}, ${coords[0]}, '${props.id}')"><div class="card-header"><span>🔥 ${props.name}</span><span>${props.status}</span></div><div class="card-details"><span>${props.source}</span><span>à ${ptTimeFr} FR</span></div></div>`;
        });
        document.getElementById('fire-count').innerText = `${data.count}`;
        if (document.getElementById('tab-count-fires')) document.getElementById('tab-count-fires').innerText = `${data.count}`;
    } catch (err) {}
}

async function fetchAircraft() {
    try {
        const res = await fetch('/api/aircraft'); const data = await res.json();
        const aircraftListElem = document.getElementById('aircraft-list-container'); aircraftListElem.innerHTML = '';
        if (!data.aircraft || data.aircraft.length === 0) {
            aircraftListElem.innerHTML = `<div class="card-item">Aucun avion en vol dans le secteur.</div>`;
            document.getElementById('aircraft-count').innerText = `0`; 
            if (document.getElementById('tab-count-aircraft')) document.getElementById('tab-count-aircraft').innerText = `0`;
            return;
        }
        
        const activeCallsigns = new Set();
        data.aircraft.forEach(ac => {
            activeCallsigns.add(ac.callsign); 
            const icon = getPlaneIcon(ac.heading, ac.is_tactical, ac.role, ac.type);
            
            if (!persistentTraces[ac.callsign]) {
                persistentTraces[ac.callsign] = ac.trail && ac.trail.length > 0 ? [...ac.trail] : [[ac.lat, ac.lon]];
            } else {
                const lastPt = persistentTraces[ac.callsign][persistentTraces[ac.callsign].length - 1];
                if (Math.abs(lastPt[0] - ac.lat) > 0.00002 || Math.abs(lastPt[1] - ac.lon) > 0.00002) {
                    persistentTraces[ac.callsign].push([ac.lat, ac.lon]);
                }
            }
            
            const altFeet = Math.round(ac.altitude * 3.28084);
            const speedKts = Math.round(ac.speed / 1.852);
            const vspeedFormatted = ac.vspeed ? `${ac.vspeed > 0 ? '+' : ''}${ac.vspeed} ft/min` : 'N/A (Palier)';
            const badgeColor = ac.is_tactical ? "#ffcc00" : "#00e5ff";
            
            const techSheetHtml = `
                <div class="tech-sheet">
                    <div class="tech-title">
                        <span style="color:${badgeColor};">✈️ ${ac.callsign}</span>
                        <span style="font-size:0.75rem; background:rgba(255,255,255,0.1); padding:2px 6px; border-radius:4px;">Hex: ${ac.hex}</span>
                    </div>
                    <div class="tech-role" style="color:${ac.is_tactical ? '#ffaa00' : '#a0c0e0'};">${ac.role}</div>
                    <div class="tech-grid">
                        <div class="tech-row"><span class="tech-label">Immat / Reg</span><span class="tech-val">${ac.reg}</span></div>
                        <div class="tech-row"><span class="tech-label">Modèle OACI</span><span class="tech-val">${ac.type}</span></div>
                        <div class="tech-row"><span class="tech-label">Altitude Baro</span><span class="tech-val">${ac.altitude} m (${altFeet} ft)</span></div>
                        <div class="tech-row"><span class="tech-label">Vitesse Sol</span><span class="tech-val">${ac.speed} km/h (${speedKts} kts)</span></div>
                        <div class="tech-row"><span class="tech-label">Vario (Montée)</span><span class="tech-val">${vspeedFormatted}</span></div>
                        <div class="tech-row"><span class="tech-label">Cap / Track</span><span class="tech-val">${ac.heading}°</span></div>
                        <div class="tech-row"><span class="tech-label">Squawk Radar</span><span class="tech-val">${ac.squawk}</span></div>
                        <div class="tech-row"><span class="tech-label">Trace GPS</span><span class="tech-val">${persistentTraces[ac.callsign].length} pts</span></div>
                    </div>
                </div>`;
            
            if (aircraftMarkers[ac.callsign]) { 
                aircraftMarkers[ac.callsign].setLatLng([ac.lat, ac.lon]); 
                aircraftMarkers[ac.callsign].setIcon(icon); 
                aircraftMarkers[ac.callsign].setPopupContent(techSheetHtml);
            } else {
                const marker = L.marker([ac.lat, ac.lon], { icon: icon }).addTo(aircraftLayer);
                marker.bindPopup(techSheetHtml);
                marker.on('click', () => { selectAircraft(ac.callsign, ac.lat, ac.lon, persistentTraces[ac.callsign], ac.is_tactical, ac.hex); });
                aircraftMarkers[ac.callsign] = marker;
            }
            
            const trailString = JSON.stringify(persistentTraces[ac.callsign] || []).replace(/"/g, '&quot;');
            aircraftListElem.innerHTML += `
                <div class="card-item ${selectedCallsign === ac.callsign ? 'selected' : ''}" style="${ac.is_tactical ? 'border-left-color:#ffcc00; background:rgba(255,180,0,0.08);' : ''}" onclick="selectAircraft('${ac.callsign}', ${ac.lat}, ${ac.lon}, JSON.parse('${trailString}'), ${ac.is_tactical}, '${ac.hex}')">
                    <div class="card-header"><span style="color:${badgeColor}; font-weight:700;">✈️ ${ac.callsign}</span><span>${ac.speed} km/h</span></div>
                    <div class="card-details"><span>${ac.role} (${ac.type})</span><span>Alt: ${ac.altitude}m | Cap: ${ac.heading}°</span></div>
                </div>`;
        });
        
        Object.keys(aircraftMarkers).forEach(callsign => {
            if (!activeCallsigns.has(callsign)) { aircraftLayer.removeLayer(aircraftMarkers[callsign]); delete aircraftMarkers[callsign]; }
        });
        document.getElementById('aircraft-count').innerText = `${data.tactical_count} tactique / ${data.total_count}`;
        if (document.getElementById('tab-count-aircraft')) document.getElementById('tab-count-aircraft').innerText = `${data.total_count}`;
        
        if (selectedCallsign && persistentTraces[selectedCallsign] && activePolylineOuter && activePolylineCore) {
            activePolylineOuter.setLatLngs(persistentTraces[selectedCallsign]);
            activePolylineCore.setLatLngs(persistentTraces[selectedCallsign]);
        }
    } catch (err) {}
}

function startLiveLoop() {
    fetchVersion();
    fetchAirports();
    fetchWeather();
    fetchAircraft();
    fetchFires();
    // Le vent (weather) démarre à l'état désactivé par défaut (pas d'animation lourde inutile au chargement)
    
    setInterval(fetchAircraft, 4000);
    setInterval(() => { fetchWeather(); fetchFires(); }, 45000);
}
window.addEventListener('DOMContentLoaded', startLiveLoop);