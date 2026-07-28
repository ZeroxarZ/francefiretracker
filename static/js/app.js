const franceBounds = [[41.0, -5.5], [51.5, 10.0]];
const map = L.map('map', { 
    zoomControl: false, attributionControl: false, preferCanvas: true,
    minZoom: 5, maxBounds: franceBounds, maxBoundsViscosity: 1.0 
}).setView([46.60, 1.88], 6);

const darkTile = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { maxZoom: 18 });
const satTile = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 18 });

let currentMapMode = 'dark';
darkTile.addTo(map);
L.control.zoom({ position: 'bottomright' }).addTo(map);

const plumeLayer = L.layerGroup(); 
const fireLayer = L.layerGroup().addTo(map);
const burnedLayer = L.layerGroup().addTo(map);
const aircraftLayer = L.layerGroup().addTo(map);
const airportLayer = L.layerGroup().addTo(map);
const cityLayer = L.layerGroup();
const rainRadarLayer = L.layerGroup();

const aircraftMarkers = {};
const fireMarkers = {};
let activePolylineOuter = null; let activePolylineCore = null;
let selectedCallsign = null; let latestWeatherData = null;
const persistentTraces = {};
let latestAircraftData = [];
let latestFiresData = null;

const MAJOR_CITIES = [
    { name: "Paris", lat: 48.8566, lon: 2.3522, major: true },
    { name: "Marseille", lat: 43.2965, lon: 5.3698, major: true },
    { name: "Nîmes", lat: 43.8367, lon: 4.3601, major: true },
    { name: "Bordeaux", lat: 44.8378, lon: -0.5792, major: true },
    { name: "Nice", lat: 43.7102, lon: 7.2620, major: true },
    { name: "Montpellier", lat: 43.6108, lon: 3.8767, major: false },
    { name: "Ajaccio", lat: 41.9270, lon: 8.7386, major: true },
    { name: "Bastia", lat: 42.6973, lon: 9.4509, major: false },
    { name: "Perpignan", lat: 42.6986, lon: 2.8956, major: false },
    { name: "Toulouse", lat: 43.6047, lon: 1.4442, major: true },
    { name: "Lyon", lat: 45.7640, lon: 4.8357, major: true },
    { name: "Toulon", lat: 43.1242, lon: 5.9280, major: false },
    { name: "Carcassonne", lat: 43.2122, lon: 2.3536, major: false },
    { name: "Avignon", lat: 43.9493, lon: 4.8055, major: false },
    { name: "Biscarrosse", lat: 44.3900, lon: -1.1600, major: false }
];

function openRightDrawer() {
    document.getElementById('right-drawer').classList.add('open');
    document.getElementById('drawer-backdrop').classList.remove('hidden');
}
function closeRightDrawer() {
    document.getElementById('right-drawer').classList.remove('open');
    document.getElementById('drawer-backdrop').classList.add('hidden');
}

let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if (window.innerWidth <= 1024) {
        setTimeout(() => {
            const banner = document.getElementById('pwa-install-banner');
            if (banner && !localStorage.getItem('pwa_dismissed')) {
                banner.classList.remove('hidden');
            }
        }, 3000);
    }
});

async function installPWA() {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
        console.log('✅ PWA installée par l’utilisateur');
    }
    deferredPrompt = null;
    closePWABanner();
}

function closePWABanner() {
    const banner = document.getElementById('pwa-install-banner');
    if (banner) banner.classList.add('hidden');
    localStorage.setItem('pwa_dismissed', 'true');
}

function loadCityLabels() {
    cityLayer.clearLayers();
    MAJOR_CITIES.forEach(city => {
        const cssClass = city.major ? "city-label-container city-label-major" : "city-label-container";
        const icon = L.divIcon({ className: 'custom-city-icon', html: `<div class="${cssClass}">${city.major ? '🏙️ ' : '📍 '}${city.name}</div>`, iconSize: [0, 0], iconAnchor: [0, 0] });
        L.marker([city.lat, city.lon], { icon: icon, interactive: false }).addTo(cityLayer);
    });
}

function toggleLegend() {
    const content = document.getElementById('legend-items'); const arrow = document.getElementById('legend-arrow');
    if (content.style.display === 'none') { content.style.display = 'flex'; arrow.innerText = '▼'; } else { content.style.display = 'none'; arrow.innerText = '▲'; }
}

async function fetchVersion() {
    try { const res = await fetch('/api/version'); const data = await res.json(); if (data.version) document.getElementById('app-version').innerText = data.version; } catch (err) {}
}

async function selectAircraft(callsign, lat, lon, localTrail, isTactical, hexCode) {
    selectedCallsign = callsign;
    if (activePolylineOuter) map.removeLayer(activePolylineOuter);
    if (activePolylineCore) map.removeLayer(activePolylineCore);
    activePolylineOuter = null; activePolylineCore = null;
    
    if (!persistentTraces[callsign] || persistentTraces[callsign].length < 2) {
        persistentTraces[callsign] = localTrail && localTrail.length > 0 ? [...localTrail] : [[lat, lon]];
    }
    const glowColor = isTactical ? '#ff8800' : '#0088ff'; const coreColor = isTactical ? '#ffff00' : '#00ffff';
    activePolylineOuter = L.polyline(persistentTraces[callsign], { color: glowColor, weight: 8, opacity: 0.4, lineCap: 'round', lineJoin: 'round' }).addTo(map);
    activePolylineCore = L.polyline(persistentTraces[callsign], { color: coreColor, weight: 3, opacity: 0.95, dashArray: '6, 6', lineCap: 'round' }).addTo(map);
    
    const targetLat = window.innerWidth <= 768 ? lat - 0.04 : lat;
    map.flyTo([targetLat, lon], 12, { animate: true, duration: 1.2 });
    setTimeout(() => { if (aircraftMarkers[callsign]) aircraftMarkers[callsign].openPopup(); }, 1250);

    const traceId = (hexCode && hexCode !== "N/A") ? hexCode : callsign;
    try {
        const res = await fetch(`/api/trace/${traceId}`); const traceData = await res.json();
        if (traceData.coords && traceData.coords.length > 3) {
            persistentTraces[callsign] = [...traceData.coords, ...persistentTraces[callsign]];
            const cleanCoords = [];
            persistentTraces[callsign].forEach(pt => { if (cleanCoords.length === 0 || Math.abs(cleanCoords[cleanCoords.length-1][0] - pt[0]) > 0.0001 || Math.abs(cleanCoords[cleanCoords.length-1][1] - pt[1]) > 0.0001) cleanCoords.push(pt); });
            persistentTraces[callsign] = cleanCoords;
            if (activePolylineOuter) activePolylineOuter.setLatLngs(persistentTraces[callsign]);
            if (activePolylineCore) activePolylineCore.setLatLngs(persistentTraces[callsign]);
        }
    } catch (err) {}
}

function selectFire(lat, lon, markerId) {
    const targetLat = window.innerWidth <= 768 ? lat - 0.03 : lat;
    map.flyTo([targetLat, lon], 13, { animate: true, duration: 1.2 });
    setTimeout(() => { if (fireMarkers[markerId]) fireMarkers[markerId].openPopup(); }, 1250);
}

function toggleMobileDrawer() {
    const sidebar = document.getElementById('sidebar-panel'); const legend = document.getElementById('map-legend'); const toggleText = document.getElementById('drawer-toggle-text');
    sidebar.classList.toggle('drawer-collapsed'); if (legend) legend.classList.toggle('drawer-collapsed');
    toggleText.innerText = sidebar.classList.contains('drawer-collapsed') ? "▲ Agrandir le panneau" : "▼ Réduire le panneau";
}

function switchMobileTab(tabName) {
    document.getElementById('tab-btn-aircraft').classList.remove('active'); document.getElementById('tab-btn-fires').classList.remove('active');
    document.getElementById(`tab-btn-${tabName}`).classList.add('active');
    document.getElementById('panel-aircraft').style.display = tabName === 'aircraft' ? 'flex' : 'none'; document.getElementById('panel-fires').style.display = tabName === 'fires' ? 'flex' : 'none';
}

function openWeatherModal() {
    if (!latestWeatherData) return;
    document.getElementById('modal-city').innerText = latestWeatherData.city || "Secteur France";
    const grid = document.getElementById('forecast-container'); grid.innerHTML = '';
    const f6h = latestWeatherData.forecast_6h || [];
    if (f6h.length === 0) { grid.innerHTML = '<div style="grid-column: span 6; padding:20px; text-align:center;">Prévisions horaires indisponibles.</div>'; } else {
        f6h.forEach(h => { grid.innerHTML += `<div class="forecast-card"><div class="forecast-time">${h.time}</div><div class="forecast-temp">${h.temp}°C</div><div class="forecast-detail">💧 Hum: ${h.hum}%</div><div class="forecast-detail">💨 ${h.wind_speed} km/h (${h.wind_dir}°)</div><div class="forecast-detail" style="color:${h.rain > 0 ? '#00e5ff' : '#8a9ba8'}; font-weight:700;">🌧️ ${h.rain} mm</div></div>`; });
    }
    document.getElementById('weather-modal').style.display = 'flex';
}
function closeWeatherModal(event, force) { if (force || event.target.id === 'weather-modal') document.getElementById('weather-modal').style.display = 'none'; }

function toggleSection(sectionName) {
    const panel = document.getElementById(`panel-${sectionName}`); const btn = document.getElementById(`btn-collapse-${sectionName}`);
    panel.classList.toggle('collapsed'); btn.innerText = panel.classList.contains('collapsed') ? '+' : '−';
}

function switchMapStyle() {
    const btn = document.getElementById('btn-map-switch');
    const drawerBtn = document.getElementById('drawer-btn-map-switch');
    if (currentMapMode === 'dark') { 
        map.removeLayer(darkTile); satTile.addTo(map); currentMapMode = 'sat'; 
        if (btn) { btn.innerText = "🗺️ Satellite HD"; btn.style.background = "linear-gradient(135deg, #2b1f15, #614023)"; }
        if (drawerBtn) { drawerBtn.innerText = "🗺️ Satellite HD"; drawerBtn.style.background = "linear-gradient(135deg, #2b1f15, #614023)"; }
    } else { 
        map.removeLayer(satTile); darkTile.addTo(map); currentMapMode = 'dark'; 
        if (btn) { btn.innerText = "🗺️ Carte Sombre"; btn.style.background = "linear-gradient(135deg, #1b2838, #2a3f5f)"; }
        if (drawerBtn) { drawerBtn.innerText = "🗺️ Carte Sombre"; drawerBtn.style.background = "linear-gradient(135deg, #1b2838, #2a3f5f)"; }
    }
}

const activeLayers = { 
    aircraft_tactical: true, 
    aircraft_civil: false, 
    airports: true, 
    cities: false, 
    fires_active: true,
    fires_extinguished: true,
    burned: true, 
    plumes: false, 
    weather_wind: false, 
    weather_rain: false 
};

function toggleLayer(layerName) {
    activeLayers[layerName] = !activeLayers[layerName]; 
    const btn = document.getElementById(`btn-${layerName}`);
    const drawerBtn = document.getElementById(`drawer-btn-${layerName}`);
    if (activeLayers[layerName]) {
        if (btn) btn.classList.add('active');
        if (drawerBtn) drawerBtn.classList.add('active');
        if (layerName === 'airports') map.addLayer(airportLayer); if (layerName === 'cities') map.addLayer(cityLayer); if (layerName === 'burned') map.addLayer(burnedLayer); if (layerName === 'plumes') map.addLayer(plumeLayer); 
    } else {
        if (btn) btn.classList.remove('active');
        if (drawerBtn) drawerBtn.classList.remove('active');
        if (layerName === 'airports') map.removeLayer(airportLayer); if (layerName === 'cities') map.removeLayer(cityLayer); if (layerName === 'burned') map.removeLayer(burnedLayer); if (layerName === 'plumes') map.removeLayer(plumeLayer); 
    }
}

function toggleMenuPopup(e, popupId) {
    if (e) e.stopPropagation();
    const allPopups = ['aircraft-menu-popup', 'fires-menu-popup', 'weather-menu-popup'];
    allPopups.forEach(id => {
        if (id !== popupId) {
            const el = document.getElementById(id);
            if (el && el.classList.contains('show')) el.classList.remove('show');
        }
    });
    
    const popup = document.getElementById(popupId);
    if (e && e.currentTarget && window.innerWidth > 1024) {
        const rect = e.currentTarget.getBoundingClientRect();
        popup.style.left = `${rect.left}px`;
        popup.style.top = `${rect.bottom + 6}px`;
        popup.style.transform = 'none';
    } else {
        popup.style.left = '50%';
        popup.style.top = '65px';
        popup.style.transform = 'translateX(-50%)';
    }
    popup.classList.toggle('show');
}
function toggleAircraftMenu(e) { toggleMenuPopup(e, 'aircraft-menu-popup'); }
function toggleFiresMenu(e) { toggleMenuPopup(e, 'fires-menu-popup'); }
function toggleWeatherMenu(e) { toggleMenuPopup(e, 'weather-menu-popup'); }

window.addEventListener('click', function(e) { 
    if (!e.target.matches('#btn-weather-main') && !e.target.closest('#weather-menu-popup')) { 
        const p = document.getElementById('weather-menu-popup'); 
        if (p && p.classList.contains('show')) p.classList.remove('show'); 
    }
    if (!e.target.matches('#btn-aircraft-main') && !e.target.closest('#aircraft-menu-popup')) { 
        const p = document.getElementById('aircraft-menu-popup'); 
        if (p && p.classList.contains('show')) p.classList.remove('show'); 
    }
    if (!e.target.matches('#btn-fires-main') && !e.target.closest('#fires-menu-popup')) { 
        const p = document.getElementById('fires-menu-popup'); 
        if (p && p.classList.contains('show')) p.classList.remove('show'); 
    }
});

function toggleAircraftSubLayer(type) {
    const key = `aircraft_${type}`;
    activeLayers[key] = !activeLayers[key];
    
    const btn = document.getElementById(`sub-btn-${type}`);
    const drawerBtn = document.getElementById(`drawer-btn-${type}`);
    
    if (activeLayers[key]) {
        if (btn) btn.classList.add('active_sub');
        if (drawerBtn) drawerBtn.classList.add('active');
    } else {
        if (btn) btn.classList.remove('active_sub');
        if (drawerBtn) drawerBtn.classList.remove('active');
    }
    
    const mainBtn = document.getElementById('btn-aircraft-main');
    if (mainBtn) {
        if (activeLayers.aircraft_tactical || activeLayers.aircraft_civil) {
            mainBtn.classList.add('active');
        } else {
            mainBtn.classList.remove('active');
        }
    }
    
    renderAircraftList();
}

function toggleFiresSubLayer(type) {
    const key = `fires_${type}`;
    activeLayers[key] = !activeLayers[key];
    
    const btn = document.getElementById(`sub-btn-fires_${type}`);
    const drawerBtn = document.getElementById(`drawer-btn-fires_${type}`);
    
    if (activeLayers[key]) {
        if (btn) btn.classList.add('active_sub');
        if (drawerBtn) drawerBtn.classList.add('active');
    } else {
        if (btn) btn.classList.remove('active_sub');
        if (drawerBtn) drawerBtn.classList.remove('active');
    }
    
    const mainBtn = document.getElementById('btn-fires-main');
    if (mainBtn) {
        if (activeLayers.fires_active || activeLayers.fires_extinguished) {
            mainBtn.classList.add('active');
        } else {
            mainBtn.classList.remove('active');
        }
    }
    
    renderFiresList();
}

async function fetchRainRadar() {
    try {
        const res = await fetch('https://api.rainviewer.com/public/weather-maps.json');
        const data = await res.json();
        if (data && data.radar && data.radar.past && data.radar.past.length > 0) {
            const latestFrame = data.radar.past[data.radar.past.length - 1];
            rainRadarLayer.clearLayers();
            
            const radarTile = L.tileLayer(`https://tilecache.rainviewer.com${latestFrame.path}/256/{z}/{x}/{y}/2/1_1.png`, {
                opacity: 0.75,
                maxNativeZoom: 7,
                maxZoom: 18,
                errorTileUrl: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
                zIndex: 400
            });
            radarTile.addTo(rainRadarLayer);
        }
    } catch (err) { console.error("Erreur chargement radar nuages :", err); }
}

function toggleWeatherSubLayer(type) {
    const key = `weather_${type}`; activeLayers[key] = !activeLayers[key];
    const btn = document.getElementById(`sub-btn-${type}`);
    const drawerBtn = document.getElementById(`drawer-btn-${type}`);
    
    if (activeLayers[key]) { 
        if (btn) btn.classList.add('active_sub'); 
        if (drawerBtn) drawerBtn.classList.add('active');
    } else { 
        if (btn) btn.classList.remove('active_sub'); 
        if (drawerBtn) drawerBtn.classList.remove('active');
    }
    
    if (type === 'rain') {
        if (activeLayers.weather_rain) {
            map.addLayer(rainRadarLayer);
            fetchRainRadar();
        } else {
            map.removeLayer(rainRadarLayer);
        }
    }
    
    if (activeLayers.weather_wind) { startWeatherAnimation(); } else { stopWeatherAnimation(); }
}

const canvas = document.getElementById('weather-canvas'); const ctx = canvas.getContext('2d');
let particles_wind = []; let animId = null; 
let currentWindDir = 240; let currentWindSpeed = 15;

function resizeCanvas() { canvas.width = window.innerWidth; canvas.height = window.innerHeight - 60; ctx.clearRect(0, 0, canvas.width, canvas.height); if (animId) initWeatherParticles(); }
window.addEventListener('resize', resizeCanvas); resizeCanvas();

function initWeatherParticles() {
    ctx.clearRect(0, 0, canvas.width, canvas.height); particles_wind = [];
    if (activeLayers.weather_wind) {
        const count_w = currentWindSpeed > 30 ? 120 : 60;
        for (let i = 0; i < count_w; i++) {
            particles_wind.push({ x: Math.random() * canvas.width, y: Math.random() * canvas.height, length: Math.random() * 20 + 10, speed: (Math.random() * 0.7 + 0.5) * Math.max(2.0, currentWindSpeed * 0.2) });
        }
    }
}

function startWeatherAnimation() { if (!animId) { initWeatherParticles(); animateWeather(); } }
function stopWeatherAnimation() { if (animId) { cancelAnimationFrame(animId); animId = null; ctx.clearRect(0, 0, canvas.width, canvas.height); } }

function animateWeather() {
    if (!activeLayers.weather_wind) { ctx.clearRect(0, 0, canvas.width, canvas.height); animId = null; return; }
    if (document.hidden) { animId = requestAnimationFrame(animateWeather); return; }
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const angR = ((currentWindDir + 180) % 360) * (Math.PI / 180); const dxW = Math.sin(angR); const dyW = -Math.cos(angR);
    ctx.strokeStyle = currentMapMode === 'sat' ? 'rgba(255, 255, 255, 0.6)' : 'rgba(0, 229, 255, 0.4)';
    ctx.lineWidth = 1.0; ctx.beginPath();
    particles_wind.forEach(p => {
        ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - dxW * p.length, p.y - dyW * p.length);
        p.x += dxW * p.speed; p.y += dyW * p.speed;
        if (p.x < 0) p.x = canvas.width; if (p.x > canvas.width) p.x = 0; if (p.y < 0) p.y = canvas.height; if (p.y > canvas.height) p.y = 0;
    });
    ctx.stroke();
    animId = requestAnimationFrame(animateWeather);
}
map.on('move', () => { if (animId) ctx.clearRect(0, 0, canvas.width, canvas.height); });

function getPlaneIcon(heading, isTactical, role, acType) {
    const color = isTactical ? "#ffcc00" : "#4a759c"; const scale = isTactical ? "1.25" : "0.85";
    const isHelico = (role && role.includes("Hélicoptère")) || ["EC25", "AS33", "H225", "EC45", "BK17", "H145", "EC55", "S365"].includes((acType || "").toUpperCase());
    let svgContent = isHelico ? `<svg width="26" height="26" viewBox="0 0 24 24" fill="${color}" xmlns="http://www.w3.org/2000/svg"><path d="M2 11H22V13H2V11Z" fill="${color}" opacity="0.9"/><path d="M11 2V22H13V2Z" fill="${color}" opacity="0.9"/><path d="M10.5 6C7.5 6 5.5 8 5.5 11.5C5.5 14.5 7.5 16.5 11 16.5H15L19 18.5V15.5L17 14.5V8.5L14.5 6H10.5Z" fill="${color}"/><circle cx="19.5" cy="17" r="2.5" fill="${color}"/></svg>` : `<svg width="24" height="24" viewBox="0 0 24 24" fill="${color}" xmlns="http://www.w3.org/2000/svg"><path d="M21 16V14L13 9V3.5C13 2.67 12.33 2 11.5 2C10.67 2 10 2.67 10 3.5V9L2 14V16L10 13.5V19L8 20.5V22L11.5 21L15 22V20.5L13 19V13.5L21 16Z"/></svg>`;
    return L.divIcon({ className: 'custom-plane-icon', html: `<div class="plane-icon-wrapper" style="transform: rotate(${heading}deg) scale(${scale});">${svgContent}</div>`, iconSize: [26, 26], iconAnchor: [13, 13] });
}

async function fetchAirports() {
    try {
        const res = await fetch('/api/airports'); const data = await res.json(); airportLayer.clearLayers();
        data.airports.forEach(apt => {
            const cssClass = apt.type.includes("Nationale") || apt.type.includes("Militaire") ? "airport-marker airport-strategic" : "airport-marker";
            const icon = L.divIcon({ className: 'custom-airport-icon', html: `<div class="${cssClass}">✈️</div>`, iconSize: [24, 24], iconAnchor: [12, 12] });
            L.marker([apt.lat, apt.lon], { icon: icon }).addTo(airportLayer).bindPopup(`<b>🛬 ${apt.name} (${apt.icao})</b><br><b>Rôle :</b> <span style="color:${cssClass.includes('strategic') ? '#fff' : '#00e5ff'};">${apt.type}</span><br><b>Piste :</b> ${apt.rwy}`);
        });
    } catch (err) {}
}

let weatherTimeout = null;
async function fetchWeather() {
    try {
        const center = map.getCenter(); const res = await fetch(`/api/weather?lat=${center.lat.toFixed(4)}&lon=${center.lng.toFixed(4)}`); const data = await res.json();
        latestWeatherData = data;
        document.getElementById('val-city').innerText = `${data.city || "Secteur France"}`; document.getElementById('val-temp').innerText = `${data.temp} °C`;
        document.getElementById('val-hum').innerText = `${data.humidity} %`; document.getElementById('val-rain').innerText = `${data.precipitation || 0} mm`;
        currentWindDir = data.wind_dir || 240; currentWindSpeed = data.wind_speed || 15;
        if (animId) initWeatherParticles(); 
    } catch (err) {}
}
map.on('moveend', () => { if (weatherTimeout) clearTimeout(weatherTimeout); weatherTimeout = setTimeout(fetchWeather, 600); });

// 👉 GÉNÉRATEUR D'ICÔNE VECTORIELLE SVG (GARANTIT LE NOIR ABSOLU SUR TOUS LES TÉLÉPHONES)
const svgFlamePath = "M12 23c-4.97 0-9-3.73-9-8.33 0-3.32 2.22-6.19 5.4-7.25.39-.13.82.08.97.47.16.4-.04.85-.43 1.05-2.39.79-4.01 2.82-4.01 5.23 0 3.49 3.14 6.33 7.07 6.33s7.07-2.84 7.07-6.33c0-2.41-1.62-4.44-4.01-5.23-.39-.2-.59-.65-.43-1.05.15-.39.58-.6 0.97-.47 3.18 1.06 5.4 3.93 5.4 7.25 0 4.6-4.03 8.33-9 8.33z M12 19c-2.21 0-4-1.66-4-3.71 0-1.48.99-2.76 2.41-3.23.36-.12.76.08.9.43.14.36-.04.77-.39.9-.84.28-1.42 1.01-1.42 1.9 0 1.1 1.12 2 2.5 2s2.5-.9 2.5-2c0-.89-.58-1.62-1.42-1.9-.35-.13-.53-.54-.39-.9.14-.35.54-.55.9-.43 1.42.47 2.41 1.75 2.41 3.23 0 2.05-1.79 3.71-4 3.71z";

function getFireSvgIcon(isExtinguished, isRecent) {
    let fillColor = "#ff5e00"; 
    let wrapperClass = "fire-svg-wrapper";
    let size = 28;

    if (isExtinguished) {
        fillColor = "#111318"; // Noir absolu pour éteint
        wrapperClass += " extinguished";
        size = 24;
    } else if (isRecent) {
        fillColor = "#ff1e00"; // Rouge urgent clignotant
        wrapperClass += " recent-pulse";
        size = 32;
    }

    let strokeAttr = isExtinguished ? 'stroke="#8a9ba8" stroke-width="1.2"' : '';
    const html = `<div class="${wrapperClass}"><svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="${fillColor}" ${strokeAttr} xmlns="http://www.w3.org/2000/svg"><path d="${svgFlamePath}"/></svg></div>`;
    return L.divIcon({ className: 'custom-fire-marker-svg', html: html, iconSize: [size, size], iconAnchor: [size/2, size/2] });
}

async function fetchFires() {
    try {
        const loader = document.getElementById('smoke-data-loader'); if (loader) loader.style.display = 'block';
        const res = await fetch('/api/fires'); const data = await res.json();
        latestFiresData = data;
        
        if (data.latest_detection_exact) {
            document.getElementById('sat-time-fr').innerText = data.latest_detection_exact;
        } else if (data.latest_satellite_utc) {
            const dateExacte = new Date(data.latest_satellite_utc);
            document.getElementById('sat-time-fr').innerText = dateExacte.toLocaleDateString('fr-FR') + ' à ' + dateExacte.toLocaleTimeString('fr-FR', {hour: '2-digit', minute:'2-digit', second:'2-digit'});
        }
        
        if (data.next_satellite_pass) {
            document.getElementById('sat-next-fr').innerText = data.next_satellite_pass;
        }
        
        if (data.stats) { document.getElementById('stat-hectares').innerText = data.stats.hectares; document.getElementById('stat-houses').innerText = data.stats.houses; document.getElementById('stat-evac').innerText = data.stats.evacuations; }

        plumeLayer.clearLayers(); burnedLayer.clearLayers();
        if (activeLayers.plumes && data.plumes) L.geoJSON(data.plumes, { style: { fillColor: '#ff3300', fillOpacity: 0.25, color: '#ff6600', weight: 1 } }).addTo(plumeLayer);
        if (activeLayers.burned && data.burned_areas) L.geoJSON(data.burned_areas, { style: { fillColor: '#8b0000', fillOpacity: 0.35, color: '#ff4500', weight: 2, dashArray: '5, 5', lineCap: 'round', lineJoin: 'round' } }).addTo(burnedLayer);
        
        renderFiresList();
        if (loader) loader.style.display = 'none';
    } catch (err) {}
}

function renderFiresList() {
    if (!latestFiresData) return;
    const data = latestFiresData;
    const fireListElem = document.getElementById('fire-list-container');
    
    fireLayer.clearLayers();
    Object.keys(fireMarkers).forEach(k => delete fireMarkers[k]);
    
    if (!data.fires || data.fires.features.length === 0) {
        fireListElem.innerHTML = `<div class="card-item" style="border-left-color: #00dd66;">Aucun foyer thermique actif.</div>`;
        document.getElementById('fire-count').innerText = `0`; if (document.getElementById('tab-count-fires')) document.getElementById('tab-count-fires').innerText = `0`;
        return;
    }
    
    // 👉 TRI TACTIQUE (1. RADAR EN DIRECT -> 2. RÉCENCE -> 3. FRP)
    data.fires.features.sort((a, b) => {
        const isTacticalA = (a.properties.source && a.properties.source.includes("Radar")) ? 1 : 0;
        const isTacticalB = (b.properties.source && b.properties.source.includes("Radar")) ? 1 : 0;
        const extA = a.properties.is_extinguished ? 1 : 0;
        const extB = b.properties.is_extinguished ? 1 : 0;
        const timeA = new Date(a.properties.time_utc).getTime() || 0;
        const timeB = new Date(b.properties.time_utc).getTime() || 0;
        const frpA = parseFloat(a.properties.frp) || 0;
        const frpB = parseFloat(b.properties.frp) || 0;

        if (extA !== extB) return extA - extB;
        if (isTacticalA !== isTacticalB) return isTacticalB - isTacticalA;
        if (timeB !== timeA) return timeB - timeA;
        return frpB - frpA;
    });

    let htmlBuffer = '';
    let visibleCount = 0;
    let activeCount = 0;

    data.fires.features.forEach(fire => {
        const props = fire.properties; const coords = fire.geometry.coordinates;
        const isTactical = props.source && props.source.includes("Radar"); 
        const isExtinguished = props.is_extinguished === true;
        
        // 👉 FILTRAGE EN DIRECT SELON L'ÉTAT DES COUCHES
        if (isExtinguished && !activeLayers.fires_extinguished) return;
        if (!isExtinguished && !activeLayers.fires_active) return;
        
        visibleCount++;
        if (!isExtinguished) activeCount++;
        
        const iconBg = isExtinguished ? "#333333" : (isTactical ? "#00aaff" : "#ff1e00");
        const ptTimeFr = new Date(props.time_utc).toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', second: '2-digit' });
        
        const fireTimeMs = new Date(props.time_utc).getTime();
        const diffMins = (Date.now() - fireTimeMs) / (1000 * 60);
        const isRecent = !isExtinguished && (isTactical || (diffMins >= 0 && diffMins < 60));
        
        // 👉 APPEL EFFECTIF DE LA FONCTION VECTORIELLE SVG SUR LA CARTE
        const fireIcon = getFireSvgIcon(isExtinguished, isRecent);
        
        const zIdx = isExtinguished ? -800 : -500;
        const marker = L.marker([coords[1], coords[0]], { icon: fireIcon, zIndexOffset: zIdx }).addTo(fireLayer);
        
        const badgePopup = isExtinguished ? '<span style="color:#8a9ba8; font-size:0.75rem;">[⚫ ÉTEINT / ARCHIVE]</span>' : (isRecent ? '<span class="badge-recent">⚡ DIRECT / RÉCENT</span>' : '');
        marker.bindPopup(`<b>🔥 ${props.name} ${badgePopup}</b><br><b>Heure FR:</b> ${ptTimeFr}<br><b>Source:</b> ${props.source}<br><b>Statut:</b> ${props.status}`);
        fireMarkers[props.id] = marker;
        
        const badgeList = isExtinguished ? '<span style="color:#8a9ba8; font-size:0.65rem;">⚫ ÉTEINT</span>' : (isRecent ? '<span class="badge-recent">🔴 DIRECT</span>' : '');
        htmlBuffer += `<div class="card-item fire" style="border-left-color: ${iconBg}; ${isExtinguished ? 'opacity:0.65;' : ''}" onclick="selectFire(${coords[1]}, ${coords[0]}, '${props.id}')"><div class="card-header"><span>${isExtinguished ? '⚫' : '🔥'} ${props.name} ${badgeList}</span><span>${props.status}</span></div><div class="card-details"><span>${props.source}</span><span>à ${ptTimeFr} FR</span></div></div>`;
    });
    
    if (visibleCount === 0) {
        fireListElem.innerHTML = `<div class="card-item" style="border-left-color: #8a9ba8;">Aucun foyer affiché avec les filtres actuels.</div>`;
    } else {
        fireListElem.innerHTML = htmlBuffer;
    }
    
    document.getElementById('fire-count').innerText = `${activeCount} actifs / ${visibleCount}`; 
    if (document.getElementById('tab-count-fires')) document.getElementById('tab-count-fires').innerText = `${visibleCount}`;
}

async function fetchAircraft() {
    try {
        const res = await fetch('/api/aircraft', { cache: 'no-store' }); 
        const data = await res.json();
        latestAircraftData = data.aircraft || [];
        renderAircraftList();
    } catch (err) {}
}

function renderAircraftList() {
    const aircraftListElem = document.getElementById('aircraft-list-container');
    if (!latestAircraftData || latestAircraftData.length === 0) {
        aircraftListElem.innerHTML = `<div class="card-item">Aucun avion en vol dans le secteur.</div>`;
        document.getElementById('aircraft-count').innerText = `0`; 
        if (document.getElementById('tab-count-aircraft')) document.getElementById('tab-count-aircraft').innerText = `0`;
        return;
    }
    
    const activeCallsigns = new Set(); 
    let htmlBuffer = '';
    let visibleCount = 0;
    let visibleTactical = 0;
    
    latestAircraftData.forEach(ac => {
        const shouldShow = ac.is_tactical ? activeLayers.aircraft_tactical : activeLayers.aircraft_civil;
        if (!shouldShow) {
            if (aircraftMarkers[ac.callsign]) {
                aircraftLayer.removeLayer(aircraftMarkers[ac.callsign]);
                delete aircraftMarkers[ac.callsign];
            }
            return;
        }
        
        visibleCount++;
        if (ac.is_tactical) visibleTactical++;
        activeCallsigns.add(ac.callsign); 
        
        const icon = getPlaneIcon(ac.heading, ac.is_tactical, ac.role, ac.type);
        if (!persistentTraces[ac.callsign]) { 
            persistentTraces[ac.callsign] = ac.trail && ac.trail.length > 0 ? [...ac.trail] : [[ac.lat, ac.lon]]; 
        } else {
            const lastPt = persistentTraces[ac.callsign][persistentTraces[ac.callsign].length - 1];
            if (Math.abs(lastPt[0] - ac.lat) > 0.0001 || Math.abs(lastPt[1] - ac.lon) > 0.0001) persistentTraces[ac.callsign].push([ac.lat, ac.lon]);
        }
        
        const altFeet = Math.round(ac.altitude * 3.28084); 
        const speedKts = Math.round(ac.speed / 1.852);
        const vspeedFormatted = ac.vspeed ? `${ac.vspeed > 0 ? '+' : ''}${ac.vspeed} ft/min` : 'N/A (Palier)';
        const badgeColor = ac.is_tactical ? "#ffcc00" : "#00e5ff";
        const techSheetHtml = `<div class="tech-sheet"><div class="tech-title"><span style="color:${badgeColor};">✈️ ${ac.callsign}</span><span style="font-size:0.75rem; background:rgba(255,255,255,0.1); padding:2px 6px; border-radius:4px;">Hex: ${ac.hex}</span></div><div class="tech-role" style="color:${ac.is_tactical ? '#ffaa00' : '#a0c0e0'};">${ac.role}</div><div class="tech-grid"><div class="tech-row"><span class="tech-label">Immat / Reg</span><span class="tech-val">${ac.reg}</span></div><div class="tech-row"><span class="tech-label">Modèle OACI</span><span class="tech-val">${ac.type}</span></div><div class="tech-row"><span class="tech-label">Altitude Baro</span><span class="tech-val">${ac.altitude} m (${altFeet} ft)</span></div><div class="tech-row"><span class="tech-label">Vitesse Sol</span><span class="tech-val">${ac.speed} km/h (${speedKts} kts)</span></div><div class="tech-row"><span class="tech-label">Vario (Montée)</span><span class="tech-val">${vspeedFormatted}</span></div><div class="tech-row"><span class="tech-label">Cap / Track</span><span class="tech-val">${ac.heading}°</span></div><div class="tech-row"><span class="tech-label">Squawk Radar</span><span class="tech-val">${ac.squawk}</span></div><div class="tech-row"><span class="tech-label">Trace GPS</span><span class="tech-val">${persistentTraces[ac.callsign].length} pts</span></div></div></div>`;
        
        const planeZIndex = ac.is_tactical ? 20000 : 10000;

        if (aircraftMarkers[ac.callsign]) { 
            aircraftMarkers[ac.callsign].setLatLng([ac.lat, ac.lon]); 
            aircraftMarkers[ac.callsign].setIcon(icon); 
            aircraftMarkers[ac.callsign].setZIndexOffset(planeZIndex);
            aircraftMarkers[ac.callsign].setPopupContent(techSheetHtml); 
        } else {
            const marker = L.marker([ac.lat, ac.lon], { icon: icon, zIndexOffset: planeZIndex }).addTo(aircraftLayer);
            marker.bindPopup(techSheetHtml); 
            marker.on('click', () => { selectAircraft(ac.callsign, ac.lat, ac.lon, persistentTraces[ac.callsign], ac.is_tactical, ac.hex); });
            aircraftMarkers[ac.callsign] = marker;
        }
        
        htmlBuffer += `<div class="card-item ${selectedCallsign === ac.callsign ? 'selected' : ''}" style="${ac.is_tactical ? 'border-left-color:#ffcc00; background:rgba(255,180,0,0.08);' : ''}" onclick="selectAircraft('${ac.callsign}', ${ac.lat}, ${ac.lon}, persistentTraces['${ac.callsign}'], ${ac.is_tactical}, '${ac.hex}')"><div class="card-header"><span style="color:${badgeColor}; font-weight:700;">✈️ ${ac.callsign}</span><span>${ac.speed} km/h</span></div><div class="card-details"><span>${ac.role} (${ac.type})</span><span>Alt: ${ac.altitude}m | Cap: ${ac.heading}°</span></div></div>`;
    });
    
    if (visibleCount === 0) {
        aircraftListElem.innerHTML = `<div class="card-item">Aucun avion affiché avec les filtres actuels.</div>`;
    } else {
        aircraftListElem.innerHTML = htmlBuffer;
    }
    
    Object.keys(aircraftMarkers).forEach(callsign => { 
        if (!activeCallsigns.has(callsign)) { 
            aircraftLayer.removeLayer(aircraftMarkers[callsign]); 
            delete aircraftMarkers[callsign]; 
        } 
    });
    
    document.getElementById('aircraft-count').innerText = `${visibleTactical} tactique / ${visibleCount}`; 
    if (document.getElementById('tab-count-aircraft')) document.getElementById('tab-count-aircraft').innerText = `${visibleCount}`;
    
    if (selectedCallsign && persistentTraces[selectedCallsign] && activePolylineOuter && activePolylineCore) { 
        if (activeCallsigns.has(selectedCallsign)) {
            activePolylineOuter.setLatLngs(persistentTraces[selectedCallsign]); 
            activePolylineCore.setLatLngs(persistentTraces[selectedCallsign]); 
        } else {
            map.removeLayer(activePolylineOuter);
            map.removeLayer(activePolylineCore);
            activePolylineOuter = null;
            activePolylineCore = null;
            selectedCallsign = null;
        }
    }
}

function hideLoader() {
    const loader = document.getElementById('page-loader');
    if (loader) { loader.classList.add('hidden'); setTimeout(() => loader.remove(), 400); }
}

async function startLiveLoop() {
    fetchVersion(); fetchAirports(); loadCityLabels();
    await Promise.all([fetchWeather(), fetchAircraft(), fetchFires()]);
    hideLoader();
    setInterval(fetchAircraft, 4000); setInterval(() => { fetchWeather(); fetchFires(); }, 45000);
    setInterval(() => { if (activeLayers.weather_rain) fetchRainRadar(); }, 300000);
}
window.addEventListener('DOMContentLoaded', startLiveLoop);