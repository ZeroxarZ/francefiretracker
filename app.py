import csv
import io
import math
import time
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor
from flask import Flask, jsonify, render_template, request
import requests

app = Flask(__name__)

GIRONDE_BBOX = {"lat_min": 43.50, "lat_max": 45.80, "lon_min": -1.80, "lon_max": 0.80}
BORDEAUX_COORDS = {"lat": 44.8378, "lon": -0.5792}

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Accept": "application/json, text/csv, */*"
}

SHOW_CIVIL_TRAFFIC = True 

# 👉 LISTE ÉLARGIE AVEC LES INDICATIFS MILITAIRES ET LOGISTIQUES (BLADE, CTM, RRR, FAF, etc.)
TACTICAL_CALLSIGNS = [
    "OMBHG", "OMBH", "PUMA", "PUMAB", "DRAG", "DRAGON", "RESCU", "SAMU", "SECUR", "CIVIL", 
    "HELIC", "HELI", "GIFF", "F-Z", "F-O", "F-PUMA", "MILAN", "PELIC", "TRACT", "TRACK", 
    "BENG", "ICAR", "ATLAS", "ABEL", "HORNET", "VANGUARD", "FIRE", "WATER", "SCOUT", 
    "BEAVER", "DASH", "CANADAIR", "BOMBER", "SUPERPUMA", "SDIS", "GIES",
    "BLADE", "CTM", "RRR", "FAF", "FRB", "COTE", "F-RBAX"
]

# 👉 CODES TYPES OACI : AVIONS, HÉLICOPTÈRES & TRANSPORT MILITAIRE (A400, C130, etc.)
TACTICAL_TYPES = [
    "EC25", "AS33", "H225", # Super Puma
    "EC45", "BK17", "H145", # Dragon Sécurité Civile
    "EC55", "S365", "AS36", # Dauphin / SAMU
    "AT8T",                 # Air Tractor AT-802
    "CL2T", "CL41", "CL21", # Canadair CL-415
    "DH8D",                 # Dash 8 Q400 MR
    "A400",                 # Airbus A400M Atlas (Armée de l'Air)
    "C130", "C30J",         # Lockheed C-130 Hercules
    "CN35", "C295"          # Casa / Transport tactique
]

REGIONAL_AIRPORTS = [
    {"icao": "LFBD", "name": "Bordeaux-Mérignac", "type": "Hub Principal & Pélicandrome Sécurité Civile", "lat": 44.8283, "lon": -0.7155, "rwy": "3100m"},
    {"icao": "LFBC", "name": "Base Aérienne 120 Cazaux", "type": "Base Militaire & Escadron Incendie", "lat": 44.5333, "lon": -1.1333, "rwy": "2400m"},
    {"icao": "LFBM", "name": "Base Aérienne 118 Mont-de-Marsan", "type": "Base Aérienne Militaire", "lat": 43.9130, "lon": -0.5064, "rwy": "3600m"},
    {"icao": "LFCH", "name": "Arcachon - La Teste-de-Buch", "type": "Aérodrome Civil & Surveillance Forêt", "lat": 44.5950, "lon": -1.1117, "rwy": "1400m"},
    {"icao": "LFCS", "name": "Bordeaux - Léognan - Saucats", "type": "Aérodrome de Guet Aérien", "lat": 44.7083, "lon": -0.5933, "rwy": "800m"},
    {"icao": "LFPS", "name": "Biscarrosse - Parentis", "type": "Aérodrome des Grands Lacs / Canadair", "lat": 44.3683, "lon": -1.1250, "rwy": "1300m"},
    {"icao": "LFDW", "name": "Andernos-les-Bains", "type": "Aérodrome Bassin d'Arcachon", "lat": 44.7533, "lon": -1.0783, "rwy": "900m"},
    {"icao": "LFDY", "name": "Libourne - Artigues-de-Lussac", "type": "Aérodrome Libournais", "lat": 44.9817, "lon": -0.1383, "rwy": "1000m"},
    {"icao": "LFBE", "name": "Bergerac - Dordogne-Périgord", "type": "Aéroport Régional", "lat": 44.8244, "lon": 0.5206, "rwy": "2200m"},
    {"icao": "LFBP", "name": "Pau - Pyrénées", "type": "Aéroport Civil & Régiment Hélicoptères", "lat": 43.3800, "lon": -0.4186, "rwy": "2500m"},
    {"icao": "LFBZ", "name": "Biarritz - Pays Basque", "type": "Aéroport International", "lat": 43.4683, "lon": -1.5233, "rwy": "2250m"},
    {"icao": "LFBU", "name": "Angoulême - Cognac", "type": "Aéroport Régional", "lat": 45.7292, "lon": 0.2214, "rwy": "1860m"},
    {"icao": "LFDK", "name": "Soulac-sur-Mer", "type": "Aérodrome Pointe du Médoc", "lat": 45.5267, "lon": -1.1017, "rwy": "850m"},
    {"icao": "LFBA", "name": "Agen - La Garenne", "type": "Aérodrome Lot-et-Garonne", "lat": 44.1747, "lon": 0.5906, "rwy": "2160m"}
]

CACHE_MEMORY = {}
THREAD_POOL = ThreadPoolExecutor(max_workers=8)
AIRCRAFT_TRAILS = {}

def update_aircraft_trail(callsign, lat, lon):
    if callsign not in AIRCRAFT_TRAILS:
        AIRCRAFT_TRAILS[callsign] = []
    trail = AIRCRAFT_TRAILS[callsign]
    if not trail or (abs(trail[-1][0] - lat) > 0.00005 or abs(trail[-1][1] - lon) > 0.00005):
        trail.append([round(lat, 5), round(lon, 5)])
    if len(trail) > 500:
        AIRCRAFT_TRAILS[callsign] = trail[-500:]
    return AIRCRAFT_TRAILS[callsign]

def get_cached_data(key, ttl_seconds, fetch_function, *args):
    now = time.time()
    if key in CACHE_MEMORY and (now - CACHE_MEMORY[key]["timestamp"]) < ttl_seconds:
        return CACHE_MEMORY[key]["data"]
    data = fetch_function(*args)
    CACHE_MEMORY[key] = {"timestamp": now, "data": data}
    return data

def fetch_url_safe(url, timeout=3.0):
    try:
        res = requests.get(url, headers=HEADERS, timeout=timeout)
        if res.status_code == 200: return res
    except Exception: pass
    return None

def calculate_smoke_plume(lat, lon, wind_dir, wind_speed, frp=15.0):
    plume_dir = (wind_dir + 180) % 360
    length_km = max(3.0, min(45.0, (wind_speed * 0.35) * (frp / 12.0)))
    spread_angle = max(12.0, 45.0 - (wind_speed * 0.5))
    lat_deg_per_km = 1.0 / 111.0
    lon_deg_per_km = 1.0 / (111.0 * math.cos(math.radians(lat)))
    points = [[lon, lat]]
    steps = 6
    for i in range(steps + 1):
        angle_deg = plume_dir - (spread_angle / 2.0) + (spread_angle * (i / float(steps)))
        angle_rad = math.radians(angle_deg)
        p_lat = lat + (length_km * math.cos(angle_rad) * lat_deg_per_km)
        p_lon = lon + (length_km * math.sin(angle_rad) * lon_deg_per_km)
        points.append([p_lon, p_lat])
    points.append([lon, lat])
    return {"type": "Feature", "properties": {"length_km": round(length_km, 1), "wind_speed": wind_speed, "frp": frp}, "geometry": {"type": "Polygon", "coordinates": [points]}}

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/api/airports")
def get_airports():
    return jsonify({"airports": REGIONAL_AIRPORTS, "count": len(REGIONAL_AIRPORTS)})

@app.route("/api/weather")
def get_weather():
    lat = request.args.get("lat", default=BORDEAUX_COORDS['lat'], type=float)
    lon = request.args.get("lon", default=BORDEAUX_COORDS['lon'], type=float)
    cache_key = f"weather_{round(lat, 2)}_{round(lon, 2)}"
    
    def fetch_w():
        url_w = (f"https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}"
                 f"&current=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,precipitation,rain"
                 f"&hourly=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,precipitation"
                 f"&forecast_days=1&timezone=Europe%2FParis")
        url_geo = f"https://api.bigdatacloud.net/data/reverse-geocode-client?latitude={lat}&longitude={lon}&localityLanguage=fr"
        
        results = list(THREAD_POOL.map(lambda u: fetch_url_safe(u, timeout=2.5), [url_w, url_geo]))
        
        city_name = "Secteur Gironde"
        if results[1]:
            try:
                g_data = results[1].json()
                city_name = g_data.get("locality") or g_data.get("city") or g_data.get("principalSubdivision") or "Secteur Forêt"
            except Exception: pass
            
        if results[0]:
            data = results[0].json()
            current = data.get("current", {})
            hourly = data.get("hourly", {})
            
            forecast_6h = []
            if "time" in hourly:
                now_str = datetime.now().strftime("%Y-%m-%dT%H:00")
                times = hourly["time"]
                start_idx = 0
                for idx, t in enumerate(times):
                    if t >= now_str:
                        start_idx = idx
                        break
                
                for i in range(start_idx, min(start_idx + 6, len(times))):
                    forecast_6h.append({
                        "time": times[i].split("T")[1] + "h",
                        "temp": hourly["temperature_2m"][i],
                        "hum": hourly["relative_humidity_2m"][i],
                        "wind_speed": hourly["wind_speed_10m"][i],
                        "wind_dir": hourly["wind_direction_10m"][i],
                        "rain": hourly["precipitation"][i]
                    })
            
            return {
                "temp": current.get("temperature_2m", "--"),
                "humidity": current.get("relative_humidity_2m", "--"),
                "wind_speed": current.get("wind_speed_10m", 15),
                "wind_dir": current.get("wind_direction_10m", 240),
                "precipitation": current.get("precipitation", 0.0),
                "rain": current.get("rain", 0.0),
                "city": city_name, "lat": lat, "lon": lon,
                "forecast_6h": forecast_6h,
                "timestamp": datetime.now().strftime("%H:%M:%S")
            }
        return {"temp": 25, "humidity": 45, "wind_speed": 15, "wind_dir": 240, "precipitation": 0.0, "city": city_name, "forecast_6h": []}
        
    return jsonify(get_cached_data(cache_key, 60, fetch_w))

@app.route("/api/trace/<identifier>")
def get_trace(identifier):
    if not identifier or identifier == "N/A":
        return jsonify({"coords": []})
    
    clean_id = identifier.strip().lower()
    cache_key = f"trace_full_{clean_id}"
    
    def fetch_t():
        urls = [
            f"https://api.adsb.lol/v2/trace/{clean_id}",
            f"https://adsb.fi/api/v0/trace/{clean_id}",
            f"https://opensky-network.org/api/tracks/all?icao24={clean_id}&time=0"
        ]
        results = list(THREAD_POOL.map(lambda u: fetch_url_safe(u, timeout=4.0), urls))
        extracted_coords = []
        
        for res in results[:2]:
            if res:
                try:
                    data = res.json()
                    trace_data = data.get("trace", [])
                    if trace_data and len(trace_data) > 0:
                        ref_lat, ref_lon = None, None
                        for pt in trace_data:
                            if isinstance(pt, list) and len(pt) >= 3:
                                if isinstance(pt[1], (int, float)) and isinstance(pt[2], (int, float)):
                                    if abs(pt[1]) > 1.0 and abs(pt[2]) > 1.0:
                                        ref_lat, ref_lon = pt[1], pt[2]
                                        extracted_coords.append([round(ref_lat, 5), round(ref_lon, 5)])
                                    elif ref_lat is not None and ref_lon is not None:
                                        ref_lat += pt[1]
                                        ref_lon += pt[2]
                                        extracted_coords.append([round(ref_lat, 5), round(ref_lon, 5)])
                        if len(extracted_coords) > 5: return extracted_coords
                except Exception: pass
                
        if not extracted_coords and results[2]:
            try:
                data = results[2].json()
                for pt in data.get("path", []):
                    if pt[1] and pt[2]:
                        extracted_coords.append([round(pt[1], 5), round(pt[2], 5)])
            except Exception: pass
            
        return extracted_coords
    
    return jsonify({"coords": get_cached_data(cache_key, 180.0, fetch_t)})

@app.route("/api/aircraft")
def get_aircraft():
    def fetch_all_aircraft():
        aircraft_map = {}
        urls = [
            f"https://adsb.fi/api/v0/lat/{BORDEAUX_COORDS['lat']}/lon/{BORDEAUX_COORDS['lon']}/dist/200",
            f"https://api.adsb.lol/v2/lat/{BORDEAUX_COORDS['lat']}/lon/{BORDEAUX_COORDS['lon']}/dist/200",
            "https://opensky-network.org/api/states/all?lamin=43.0&lomin=-2.0&lamax=46.5&lomax=2.0"
        ]
        results = list(THREAD_POOL.map(lambda u: fetch_url_safe(u, timeout=2.5), urls))
        
        for res in results[:2]:
            if res:
                try:
                    data = res.json()
                    for ac in (data.get("aircraft", []) or data.get("ac", [])):
                        callsign = (ac.get("flight", "") or ac.get("r", "") or "INCONNU").strip().upper()
                        lat, lon = ac.get("lat"), ac.get("lon")
                        if lat and lon and (43.0 <= lat <= 46.5 and -2.0 <= lon <= 2.0):
                            alt_m = int(ac.get("alt_baro", 0) * 0.3048) if isinstance(ac.get("alt_baro"), (int, float)) else 0
                            speed_kmh = int(ac.get("gs", 0) * 1.852) if isinstance(ac.get("gs"), (int, float)) else 0
                            heading = ac.get("track", 0) or 0
                            vspeed = int(ac.get("baro_rate", 0) or ac.get("geom_rate", 0))
                            aircraft_map[callsign] = {
                                "callsign": callsign, "lat": lat, "lon": lon, "alt": alt_m, 
                                "speed": speed_kmh, "heading": heading, "type": ac.get("t", "Aéronef"),
                                "hex": ac.get("hex", "N/A"), "reg": ac.get("r") or ac.get("reg", "N/A"),
                                "squawk": ac.get("squawk", "N/A"), "vspeed": vspeed
                            }
                except Exception: pass
                
        if results[2]:
            try:
                for ac in results[2].json().get("states", []) or []:
                    callsign = (ac[1] or "INCONNU").strip().upper()
                    lon, lat = ac[5], ac[6]
                    if lat and lon and callsign not in aircraft_map:
                        alt_m = int(ac[7] or 0)
                        speed_kmh = int((ac[9] or 0) * 3.6)
                        heading = ac[10] or 0
                        vspeed = int((ac[11] or 0) * 196.85)
                        aircraft_map[callsign] = {
                            "callsign": callsign, "lat": lat, "lon": lon, "alt": alt_m, 
                            "speed": speed_kmh, "heading": heading, "type": "Avion / Hélico",
                            "hex": ac[0] or "N/A", "reg": "N/A", "squawk": ac[14] or "N/A", "vspeed": vspeed
                        }
            except Exception: pass

        aircraft_list = []
        tactical_count = 0
        for callsign, ac in aircraft_map.items():
            ac_type = (ac["type"] or "").strip().upper()
            reg_code = (ac["reg"] or "").strip().upper()
            
            # 👉 VÉRIFICATION MILITAIRE & TACTIQUE (CALLSIGN, TYPE OACI OU IMMAT)
            is_tactical = (
                any(callsign.startswith(p) or p in callsign for p in TACTICAL_CALLSIGNS) or 
                any(ac_type == t or t in ac_type for t in TACTICAL_TYPES) or
                reg_code.startswith("F-RB") or reg_code.startswith("F-RA")
            )
            
            role = "Trafic Civil / Surveillance"
            
            if is_tactical:
                tactical_count += 1
                role = "Aéronef Sécurité Civile / Militaire"
                if "MILAN" in callsign or "DH8D" in ac_type: role = "Bombardier Dash 8 (Q400 MR)"
                elif "PELIC" in callsign or "CANADAIR" in callsign or "CL2T" in ac_type or "CL41" in ac_type or "CL21" in ac_type: role = "Bombardier Canadair CL-415"
                elif "DRAG" in callsign or "DRAGON" in callsign or "EC45" in ac_type or "BK17" in ac_type or "H145" in ac_type: role = "Hélicoptère Secours Dragon (Sécurité Civile)"
                elif "PUMA" in callsign or "OMBH" in callsign or "EC25" in ac_type or "AS33" in ac_type or "H225" in ac_type: role = "Hélicoptère Super Puma / Bombardier d'eau"
                elif "TRACT" in callsign or "TRACK" in callsign or "AT8T" in ac_type: role = "Air Tractor AT-802 (Bombardier léger / Tracker)"
                elif "BLADE" in callsign or "A400" in ac_type: role = "Avion de Transport Tactique A400M Atlas (Armée de l'Air)"
                elif "BENG" in callsign or "ICAR" in callsign: role = "Guet Aérien / Coordination"
                elif "SAMU" in callsign or "RESCU" in callsign or "S365" in ac_type or "EC55" in ac_type: role = "Hélicoptère de Secours / SAMU"
                
                trail_history = update_aircraft_trail(callsign, ac["lat"], ac["lon"])
                aircraft_list.append({
                    "callsign": callsign, "type": ac["type"], "role": role, "lat": round(ac["lat"], 5), "lon": round(ac["lon"], 5),
                    "altitude": ac["alt"], "speed": ac["speed"], "heading": round(ac["heading"], 1), "is_tactical": True,
                    "hex": ac["hex"], "reg": ac["reg"], "squawk": ac["squawk"], "vspeed": ac["vspeed"], "trail": trail_history
                })
            elif SHOW_CIVIL_TRAFFIC:
                trail_history = update_aircraft_trail(callsign, ac["lat"], ac["lon"])
                aircraft_list.append({
                    "callsign": callsign, "type": ac["type"], "role": role, "lat": round(ac["lat"], 5), "lon": round(ac["lon"], 5),
                    "altitude": ac["alt"], "speed": ac["speed"], "heading": round(ac["heading"], 1), "is_tactical": False,
                    "hex": ac["hex"], "reg": ac["reg"], "squawk": ac["squawk"], "vspeed": ac["vspeed"], "trail": trail_history
                })

        aircraft_list.sort(key=lambda x: x["is_tactical"], reverse=True)
        return {"aircraft": aircraft_list, "total_count": len(aircraft_list), "tactical_count": tactical_count, "timestamp": datetime.now().strftime("%H:%M:%S")}

    return jsonify(get_cached_data("aircraft_live", 3.0, fetch_all_aircraft))

@app.route("/api/fires")
def get_fires():
    def fetch_all_fires():
        w_data = get_cached_data(f"weather_{BORDEAUX_COORDS['lat']}_{BORDEAUX_COORDS['lon']}", 60, lambda: {"wind_speed": 15, "wind_dir": 240})
        w_speed = w_data.get("wind_speed", 15)
        w_dir = w_data.get("wind_dir", 240)
        
        nasa_feeds = [
            "https://firms.modaps.eosdis.nasa.gov/data/active_fire/suomi-npp-viirs-c2/csv/SUOMI_NPP_VIIRS_C2_Europe_24h.csv",
            "https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-20-viirs-c2/csv/J1_VIIRS_C2_Europe_24h.csv",
            "https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-21-viirs-c2/csv/J2_VIIRS_C2_Europe_24h.csv",
            "https://firms.modaps.eosdis.nasa.gov/data/active_fire/modis-c6.1/csv/MODIS_C6_1_Europe_24h.csv"
        ]
        nasa_results = list(THREAD_POOL.map(lambda u: fetch_url_safe(u, timeout=3.5), nasa_feeds))
        
        features = []
        plumes = []
        seen_coords = set()
        latest_utc_iso = None
        
        for res in nasa_results:
            if res:
                try:
                    csv_data = csv.DictReader(io.StringIO(res.text))
                    for row in csv_data:
                        lat = float(row["latitude"])
                        lon = float(row["longitude"])
                        coord_key = f"{lat:.2f}_{lon:.2f}"
                        if (GIRONDE_BBOX["lat_min"] <= lat <= GIRONDE_BBOX["lat_max"] and GIRONDE_BBOX["lon_min"] <= lon <= GIRONDE_BBOX["lon_max"] and coord_key not in seen_coords):
                            seen_coords.add(coord_key)
                            frp = float(row.get("frp", row.get("brightness", 15.0)))
                            if frp > 500: frp = frp / 15.0
                            acq_time = str(row.get("acq_time", "1200")).zfill(4)
                            acq_date = str(row.get("acq_date", datetime.now().strftime("%Y-%m-%d")))
                            iso_utc = f"{acq_date}T{acq_time[:2]}:{acq_time[2:]}:00Z"
                            if not latest_utc_iso or iso_utc > latest_utc_iso: latest_utc_iso = iso_utc
                            
                            intensity_label = "Critique / Sévère" if frp > 40 else "Foyer Actif" if frp > 15 else "Début de feu / Modéré"
                            features.append({"type": "Feature", "properties": {"id": f"NASA-{coord_key}", "name": f"Détection Satellite ({lat:.2f}, {lon:.2f})", "status": f"FRP: {frp:.1f} MW", "intensity": intensity_label, "frp": round(frp, 1), "time_utc": iso_utc, "source": "NASA FIRMS Satellite"}, "geometry": {"type": "Point", "coordinates": [lon, lat]}})
                            plumes.append(calculate_smoke_plume(lat, lon, w_dir, w_speed, frp))
                except Exception: pass

        try:
            aircraft_data = get_cached_data("aircraft_live", 3.0, lambda: {"aircraft": []})
            for ac in aircraft_data.get("aircraft", []):
                if ac.get("is_tactical") and ac.get("altitude", 0) < 1100 and ac.get("speed", 0) < 320:
                    dist_merignac = math.sqrt((ac["lat"] - BORDEAUX_COORDS["lat"])**2 + (ac["lon"] - -0.70)**2)
                    if dist_merignac > 0.12:
                        lat, lon = ac["lat"], ac["lon"]
                        coord_key = f"{lat:.2f}_{lon:.2f}"
                        if coord_key not in seen_coords:
                            seen_coords.add(coord_key)
                            now_utc = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%00Z")
                            features.append({"type": "Feature", "properties": {"id": f"TACTICAL-{coord_key}", "name": f"⚠️ Zone d'Intervention ({ac['callsign']})", "status": "Largage / Surveillance active", "intensity": "Détecté par rotation aérienne", "frp": 25.0, "time_utc": now_utc, "source": f"Radar Tactique ({ac['callsign']})"}, "geometry": {"type": "Point", "coordinates": [lon, lat]}})
                            plumes.append(calculate_smoke_plume(lat, lon, w_dir, w_speed, frp=25.0))
        except Exception: pass

        return {"fires": {"type": "FeatureCollection", "features": features}, "plumes": {"type": "FeatureCollection", "features": plumes}, "count": len(features), "latest_satellite_utc": latest_utc_iso or datetime.utcnow().strftime("%Y-%m-%dT%H:%M:00Z"), "timestamp": datetime.now().strftime("%H:%M:%S")}

    return jsonify(get_cached_data("fires_live_nasa", 180.0, fetch_all_fires))

if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=5000)