import csv
import io
import math
import subprocess
import time
from datetime import datetime, timedelta
from concurrent.futures import ThreadPoolExecutor
from flask import Flask, jsonify, render_template, request, Response
import requests

app = Flask(__name__)

FRANCE_BBOX = {"lat_min": 41.00, "lat_max": 51.50, "lon_min": -5.50, "lon_max": 10.00}
FRANCE_CENTER = {"lat": 46.6033, "lon": 1.8883}

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Accept": "application/json, text/csv, */*"
}

SHOW_CIVIL_TRAFFIC = True 

TACTICAL_CALLSIGNS = [
    "OMBHG", "OMBH", "PUMA", "PUMAB", "DRAG", "DRAGON", "RESCU", "SAMU", "SECUR", "CIVIL", 
    "HELIC", "HELI", "GIFF", "F-Z", "F-O", "F-PUMA", "MILAN", "PELIC", "TRACT", "TRACK", 
    "BENG", "ICAR", "ATLAS", "ABEL", "HORNET", "VANGUARD", "FIRE", "WATER", "SCOUT", 
    "BEAVER", "DASH", "CANADAIR", "BOMBER", "SUPERPUMA", "SDIS", "GIES",
    "BLADE", "CTM", "RRR", "FAF", "FRB", "COTE", "F-RBAX"
]

TACTICAL_TYPES = [
    "EC25", "AS33", "H225", "EC45", "BK17", "H145", "EC55", "S365", "AS36", 
    "AT8T", "CL2T", "CL41", "CL21", "DH8D", "A400", "C130", "C30J", "CN35", "C295"
]

FRENCH_AIRPORTS = [
    {"icao": "LFTW", "name": "Nîmes-Garons", "type": "Base Nationale Sécurité Civile (Hub Principal)", "lat": 43.7572, "lon": 4.4164, "rwy": "2440m"},
    {"icao": "LFML", "name": "Marseille-Provence", "type": "Base Hélicoptères & Pélicandrome Sud-Est", "lat": 43.4367, "lon": 5.2150, "rwy": "3500m"},
    {"icao": "LFKJ", "name": "Ajaccio - Napoléon Bonaparte", "type": "Pélicandrome & Secours Corse-du-Sud", "lat": 41.9236, "lon": 8.8028, "rwy": "2400m"},
    {"icao": "LFKB", "name": "Bastia - Poretta", "type": "Pélicandrome & Secours Haute-Corse", "lat": 42.5528, "lon": 9.4836, "rwy": "2520m"},
    {"icao": "LFBD", "name": "Bordeaux-Mérignac", "type": "Hub Principal & Pélicandrome Sud-Ouest", "lat": 44.8283, "lon": -0.7155, "rwy": "3100m"},
    {"icao": "LFMI", "name": "Base Aérienne 125 Istres", "type": "Base Militaire Stratégique & Ravitaillement", "lat": 43.5225, "lon": 4.9239, "rwy": "5000m"},
    {"icao": "LFMK", "name": "Carcassonne - Salvaza", "type": "Pélicandrome Zone Sud / Pyrénées", "lat": 43.2158, "lon": 2.3064, "rwy": "2050m"},
    {"icao": "LFMD", "name": "Cannes - Mandelieu", "type": "Pélicandrome & Surveillance Côte d'Azur", "lat": 43.5511, "lon": 6.9531, "rwy": "1610m"},
    {"icao": "LFBC", "name": "Base Aérienne 120 Cazaux", "type": "Base Militaire & Escadron Incendie", "lat": 44.5333, "lon": -1.1333, "rwy": "2400m"},
    {"icao": "LFBM", "name": "Base Aérienne 118 Mont-de-Marsan", "type": "Base Aérienne Militaire", "lat": 43.9130, "lon": -0.5064, "rwy": "3600m"},
    {"icao": "LFOE", "name": "Base Aérienne 105 Évreux", "type": "Base Militaire / Transport Tactique Nord", "lat": 49.0286, "lon": 1.2197, "rwy": "3050m"},
    {"icao": "LFTH", "name": "Toulon - Hyères", "type": "Base Aéronavale & Secours Maritime/Forêt", "lat": 43.0972, "lon": 6.1461, "rwy": "2820m"},
    {"icao": "LFBZ", "name": "Biarritz - Pays Basque", "type": "Aéroport Régional & Pélicandrome", "lat": 43.4683, "lon": -1.5233, "rwy": "2250m"}
]

CACHE_MEMORY = {}
THREAD_POOL = ThreadPoolExecutor(max_workers=8)
AIRCRAFT_TRAILS = {}

def get_git_version():
    try:
        sha = subprocess.check_output(["git", "rev-parse", "--short", "HEAD"]).decode("ascii").strip()
        return f"v1.0.{sha}"
    except Exception:
        return "v1.0.dev"

def update_aircraft_trail(callsign, lat, lon):
    if callsign not in AIRCRAFT_TRAILS:
        AIRCRAFT_TRAILS[callsign] = []
    trail = AIRCRAFT_TRAILS[callsign]
    if not trail or (abs(trail[-1][0] - lat) > 0.0001 or abs(trail[-1][1] - lon) > 0.0001):
        trail.append([round(lat, 4), round(lon, 4)])
    if len(trail) > 250:
        AIRCRAFT_TRAILS[callsign] = trail[-250:]
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
    points = [[round(lon, 4), round(lat, 4)]]
    steps = 4
    for i in range(steps + 1):
        angle_deg = plume_dir - (spread_angle / 2.0) + (spread_angle * (i / float(steps)))
        angle_rad = math.radians(angle_deg)
        p_lat = lat + (length_km * math.cos(angle_rad) * lat_deg_per_km)
        p_lon = lon + (length_km * math.sin(angle_rad) * lon_deg_per_km)
        points.append([round(p_lon, 4), round(p_lat, 4)])
    points.append([round(lon, 4), round(lat, 4)])
    return {"type": "Feature", "properties": {"frp": frp}, "geometry": {"type": "Polygon", "coordinates": [points]}}

def convex_hull(points):
    if len(points) <= 3:
        return points
    sorted_pts = sorted(points, key=lambda p: (p[0], p[1]))
    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lower = []
    for p in sorted_pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    upper = []
    for p in reversed(sorted_pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    return lower[:-1] + upper[:-1]

def calculate_polygon_area_ha(polygon_coords):
    if not polygon_coords or len(polygon_coords) < 3:
        return 0.0
    lat_center = sum(p[1] for p in polygon_coords) / len(polygon_coords)
    lat_m = 111000.0
    lon_m = 111000.0 * math.cos(math.radians(lat_center))
    area = 0.0
    n = len(polygon_coords)
    for i in range(n):
        j = (i + 1) % n
        xi, yi = polygon_coords[i][0] * lon_m, polygon_coords[i][1] * lat_m
        xj, yj = polygon_coords[j][0] * lon_m, polygon_coords[j][1] * lat_m
        area += (xi * yj) - (xj * yi)
    return abs(area) / 20000.0

def calculate_clustered_burned_perimeters(fire_points):
    if not fire_points:
        return [], 0.0
    
    clusters = []
    unvisited = set(range(len(fire_points)))
    
    while unvisited:
        start_idx = unvisited.pop()
        cluster = [fire_points[start_idx]]
        queue = [start_idx]
        while queue:
            curr = queue.pop(0)
            curr_pt = fire_points[curr]
            for other in list(unvisited):
                other_pt = fire_points[other]
                dist = math.sqrt((curr_pt[0] - other_pt[0])**2 + (curr_pt[1] - other_pt[1])**2)
                if dist < 0.22:
                    unvisited.remove(other)
                    cluster.append(other_pt)
                    queue.append(other)
        clusters.append(cluster)
        
    burned_features = []
    total_hectares = 0.0
    
    for idx, cl in enumerate(clusters):
        if len(cl) == 1:
            lon, lat = cl[0]
            radius_km = 3.0
            lat_deg_per_km = 1.0 / 111.0
            lon_deg_per_km = 1.0 / (111.0 * math.cos(math.radians(lat)))
            circle_pts = []
            for i in range(8):
                angle = 2 * math.pi * (i / 8.0)
                circle_pts.append([round(lon + radius_km * math.sin(angle) * lon_deg_per_km, 4), round(lat + radius_km * math.cos(angle) * lat_deg_per_km, 4)])
            circle_pts.append(circle_pts[0])
            # 👉 RENOMMAGE EN PÉRIMÈTRE DE SÉCURITÉ
            burned_features.append({"type": "Feature", "properties": {"name": f"Zone de sécurité #{idx+1}", "status": "Périmètre de sécurité"}, "geometry": {"type": "Polygon", "coordinates": [circle_pts]}})
            total_hectares += calculate_polygon_area_ha(circle_pts)
        else:
            c_lon = sum(p[0] for p in cl) / len(cl)
            c_lat = sum(p[1] for p in cl) / len(cl)
            hull = convex_hull(cl)
            if len(hull) < 3:
                lon, lat = cl[0]
                radius_km = 4.0
                lat_deg_per_km = 1.0 / 111.0
                lon_deg_per_km = 1.0 / (111.0 * math.cos(math.radians(lat)))
                circle_pts = []
                for i in range(8):
                    angle = 2 * math.pi * (i / 8.0)
                    circle_pts.append([round(lon + radius_km * math.sin(angle) * lon_deg_per_km, 4), round(lat + radius_km * math.cos(angle) * lat_deg_per_km, 4)])
                circle_pts.append(circle_pts[0])
                burned_features.append({"type": "Feature", "properties": {"name": f"Zone de sécurité #{idx+1}", "status": "Périmètre de sécurité"}, "geometry": {"type": "Polygon", "coordinates": [circle_pts]}})
                total_hectares += calculate_polygon_area_ha(circle_pts)
            else:
                buffered = []
                for pt in hull:
                    dx = pt[0] - c_lon
                    dy = pt[1] - c_lat
                    dist = math.sqrt(dx*dx + dy*dy)
                    if dist > 0:
                        new_lon = c_lon + dx * 1.3
                        new_lat = c_lat + dy * 1.3
                    else:
                        new_lon, new_lat = pt[0], pt[1]
                    buffered.append([round(new_lon, 4), round(new_lat, 4)])
                buffered.append(buffered[0])
                burned_features.append({"type": "Feature", "properties": {"name": f"Zone de sécurité #{idx+1}", "status": "Périmètre de sécurité"}, "geometry": {"type": "Polygon", "coordinates": [buffered]}})
                total_hectares += calculate_polygon_area_ha(buffered)
                
    return burned_features, round(total_hectares, 1)

def get_next_satellite_pass():
    now_utc = datetime.utcnow()
    pass_hours_utc = [1.75, 13.5] 
    current_hour_decimal = now_utc.hour + now_utc.minute / 60.0
    next_pass_dt = None
    for ph in pass_hours_utc:
        if ph > current_hour_decimal:
            next_pass_dt = datetime(now_utc.year, now_utc.month, now_utc.day, int(ph), int((ph % 1) * 60))
            break
    if not next_pass_dt:
        next_pass_dt = datetime(now_utc.year, now_utc.month, now_utc.day, 1, 45) + timedelta(days=1)
    local_pass = next_pass_dt + timedelta(hours=2)
    return local_pass.strftime("%d/%m/%Y à %H:%M")

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/api/version")
def api_version():
    return jsonify({"version": get_git_version()})

@app.route("/api/airports")
def get_airports():
    return jsonify({"airports": FRENCH_AIRPORTS, "count": len(FRENCH_AIRPORTS)})

@app.route("/api/weather")
def get_weather():
    lat = request.args.get("lat", default=FRANCE_CENTER['lat'], type=float)
    lon = request.args.get("lon", default=FRANCE_CENTER['lon'], type=float)
    cache_key = f"weather_{round(lat, 2)}_{round(lon, 2)}"
    
    def fetch_w():
        url_w = (f"https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}"
                 f"&current=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,precipitation,rain"
                 f"&hourly=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,precipitation"
                 f"&forecast_days=1&timezone=Europe%2FParis")
        url_geo = f"https://nominatim.openstreetmap.org/reverse?format=json&lat={lat}&lon={lon}&zoom=10&accept-language=fr"
        results = list(THREAD_POOL.map(lambda u: fetch_url_safe(u, timeout=2.5), [url_w, url_geo]))
        
        city_name = "Secteur France"
        if results[1]:
            try:
                g_data = results[1].json()
                addr = g_data.get("address", {})
                city_name = (
                    addr.get("county") or 
                    addr.get("city") or 
                    addr.get("town") or 
                    addr.get("municipality") or 
                    addr.get("village") or 
                    addr.get("state") or 
                    "Secteur France"
                )
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
                "temp": current.get("temperature_2m", "--"), "humidity": current.get("relative_humidity_2m", "--"),
                "wind_speed": current.get("wind_speed_10m", 15), "wind_dir": current.get("wind_direction_10m", 240),
                "precipitation": current.get("precipitation", 0.0), "rain": current.get("rain", 0.0),
                "city": city_name, "lat": lat, "lon": lon, "forecast_6h": forecast_6h
            }
        return {"temp": 25, "humidity": 45, "wind_speed": 15, "wind_dir": 240, "precipitation": 0.0, "city": city_name, "forecast_6h": []}
    return jsonify(get_cached_data(cache_key, 60, fetch_w))

@app.route("/api/trace/<identifier>")
def get_trace(identifier):
    if not identifier or identifier == "N/A": return jsonify({"coords": []})
    clean_id = identifier.strip().lower()
    cache_key = f"trace_full_{clean_id}"
    
    def fetch_t():
        urls = [
            f"https://api.adsb.lol/v2/trace/{clean_id}",
            f"https://adsb.fi/api/v0/trace/{clean_id}",
            f"https://opensky-network.org/api/tracks/all?icao24={clean_id}&time=0"
        ]
        results = list(THREAD_POOL.map(lambda u: fetch_url_safe(u, timeout=3.5), urls))
        extracted_coords = []
        for res in results[:2]:
            if res:
                try:
                    data = res.json()
                    trace_data = data.get("trace", [])
                    if trace_data and len(trace_data) > 0:
                        ref_lat, ref_lon = None, None
                        for pt in trace_data:
                            if isinstance(pt, list) and len(pt) >= 3 and isinstance(pt[1], (int, float)) and isinstance(pt[2], (int, float)):
                                if abs(pt[1]) > 1.0 and abs(pt[2]) > 1.0:
                                    ref_lat, ref_lon = pt[1], pt[2]
                                    extracted_coords.append([round(ref_lat, 4), round(ref_lon, 4)])
                                elif ref_lat is not None and ref_lon is not None:
                                    ref_lat += pt[1]; ref_lon += pt[2]
                                    extracted_coords.append([round(ref_lat, 4), round(ref_lon, 4)])
                        if len(extracted_coords) > 5: return extracted_coords
                except Exception: pass
        if not extracted_coords and results[2]:
            try:
                for pt in results[2].json().get("path", []):
                    if pt[1] and pt[2]: extracted_coords.append([round(pt[1], 4), round(pt[2], 4)])
            except Exception: pass
        return extracted_coords
    return jsonify({"coords": get_cached_data(cache_key, 180.0, fetch_t)})

@app.route("/api/aircraft")
def get_aircraft():
    def fetch_all_aircraft():
        aircraft_map = {}
        urls = [
            f"https://adsb.fi/api/v0/lat/{FRANCE_CENTER['lat']}/lon/{FRANCE_CENTER['lon']}/dist/600",
            f"https://api.adsb.lol/v2/lat/{FRANCE_CENTER['lat']}/lon/{FRANCE_CENTER['lon']}/dist/600",
            "https://opensky-network.org/api/states/all?lamin=41.0&lomin=-5.5&lamax=51.5&lomax=10.0"
        ]
        results = list(THREAD_POOL.map(lambda u: fetch_url_safe(u, timeout=2.5), urls))
        
        for res in results[:2]:
            if res:
                try:
                    data = res.json()
                    for ac in (data.get("aircraft", []) or data.get("ac", [])):
                        callsign = (ac.get("flight", "") or ac.get("r", "") or "INCONNU").strip().upper()
                        lat, lon = ac.get("lat"), ac.get("lon")
                        if lat and lon and (41.0 <= lat <= 51.5 and -5.5 <= lon <= 10.0):
                            alt_m = int(ac.get("alt_baro", 0) * 0.3048) if isinstance(ac.get("alt_baro"), (int, float)) else 0
                            speed_kmh = int(ac.get("gs", 0) * 1.852) if isinstance(ac.get("gs"), (int, float)) else 0
                            aircraft_map[callsign] = {
                                "callsign": callsign, "lat": lat, "lon": lon, "alt": alt_m, 
                                "speed": speed_kmh, "heading": ac.get("track", 0) or 0, "type": ac.get("t", "Aéronef"),
                                "hex": ac.get("hex", "N/A"), "reg": ac.get("r") or ac.get("reg", "N/A"),
                                "squawk": ac.get("squawk", "N/A"), "vspeed": int(ac.get("baro_rate", 0) or ac.get("geom_rate", 0))
                            }
                except Exception: pass
                
        if results[2]:
            try:
                for ac in results[2].json().get("states", []) or []:
                    callsign = (ac[1] or "INCONNU").strip().upper()
                    lon, lat = ac[5], ac[6]
                    if lat and lon and callsign not in aircraft_map:
                        aircraft_map[callsign] = {
                            "callsign": callsign, "lat": lat, "lon": lon, "alt": int(ac[7] or 0), 
                            "speed": int((ac[9] or 0) * 3.6), "heading": ac[10] or 0, "type": "Avion / Hélico",
                            "hex": ac[0] or "N/A", "reg": "N/A", "squawk": ac[14] or "N/A", "vspeed": int((ac[11] or 0) * 196.85)
                        }
            except Exception: pass

        aircraft_list = []
        tactical_count = 0
        for callsign, ac in aircraft_map.items():
            ac_type = (ac["type"] or "").strip().upper()
            reg_code = (ac["reg"] or "").strip().upper()
            is_tactical = (any(callsign.startswith(p) or p in callsign for p in TACTICAL_CALLSIGNS) or any(ac_type == t or t in ac_type for t in TACTICAL_TYPES) or reg_code.startswith("F-RB") or reg_code.startswith("F-RA"))
            role = "Trafic Civil / Surveillance"
            
            if is_tactical:
                tactical_count += 1
                role = "Aéronef Sécurité Civile / Militaire"
                if "MILAN" in callsign or "DH8D" in ac_type: role = "Bombardier Dash 8 (Q400 MR)"
                elif "PELIC" in callsign or "CANADAIR" in callsign or "CL2T" in ac_type or "CL41" in ac_type or "CL21" in ac_type: role = "Bombardier Canadair CL-415"
                elif "DRAG" in callsign or "DRAGON" in callsign or "EC45" in ac_type or "BK17" in ac_type or "H145" in ac_type: role = "Hélicoptère Secours Dragon"
                elif "PUMA" in callsign or "OMBH" in callsign or "EC25" in ac_type or "AS33" in ac_type or "H225" in ac_type: role = "Hélicoptère Super Puma"
                elif "TRACT" in callsign or "TRACK" in callsign or "AT8T" in ac_type: role = "Air Tractor AT-802"
                elif "BLADE" in callsign or "A400" in ac_type: role = "Avion A400M Atlas"
                elif "BENG" in callsign or "ICAR" in callsign: role = "Guet Aérien / Coordination"
                elif "SAMU" in callsign or "RESCU" in callsign or "S365" in ac_type or "EC55" in ac_type: role = "Hélicoptère de Secours / SAMU"
                
                trail_history = update_aircraft_trail(callsign, ac["lat"], ac["lon"])
                aircraft_list.append({"callsign": callsign, "type": ac["type"], "role": role, "lat": round(ac["lat"], 4), "lon": round(ac["lon"], 4), "altitude": ac["alt"], "speed": ac["speed"], "heading": round(ac["heading"], 1), "is_tactical": True, "hex": ac["hex"], "reg": ac["reg"], "squawk": ac["squawk"], "vspeed": ac["vspeed"], "trail": trail_history})
            elif SHOW_CIVIL_TRAFFIC:
                trail_history = update_aircraft_trail(callsign, ac["lat"], ac["lon"])
                aircraft_list.append({"callsign": callsign, "type": ac["type"], "role": role, "lat": round(ac["lat"], 4), "lon": round(ac["lon"], 4), "altitude": ac["alt"], "speed": ac["speed"], "heading": round(ac["heading"], 1), "is_tactical": False, "hex": ac["hex"], "reg": ac["reg"], "squawk": ac["squawk"], "vspeed": ac["vspeed"], "trail": trail_history})

        aircraft_list.sort(key=lambda x: x["is_tactical"], reverse=True)
        return {"aircraft": aircraft_list, "total_count": len(aircraft_list), "tactical_count": tactical_count}
    return jsonify(get_cached_data("aircraft_live", 3.0, fetch_all_aircraft))

@app.route("/api/fires")
def get_fires():
    def fetch_all_fires():
        w_data = get_cached_data(f"weather_{FRANCE_CENTER['lat']}_{FRANCE_CENTER['lon']}", 60, lambda: {"wind_speed": 15, "wind_dir": 240})
        w_speed = w_data.get("wind_speed", 15)
        w_dir = w_data.get("wind_dir", 240)
        
        nasa_feeds = [
            "https://firms.modaps.eosdis.nasa.gov/data/active_fire/suomi-npp-viirs-c2/csv/SUOMI_NPP_VIIRS_C2_Europe_24h.csv",
            "https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-20-viirs-c2/csv/J1_VIIRS_C2_Europe_24h.csv",
            "https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-21-viirs-c2/csv/J2_VIIRS_C2_Europe_24h.csv",
            "https://firms.modaps.eosdis.nasa.gov/data/active_fire/modis-c6.1/csv/MODIS_C6_1_Europe_24h.csv"
        ]
        nasa_results = list(THREAD_POOL.map(lambda u: fetch_url_safe(u, timeout=3.5), nasa_feeds))
        
        features = []; plumes = []; fire_points = []; seen_coords = set(); latest_utc_iso = None
        for res in nasa_results:
            if res:
                try:
                    for row in csv.DictReader(io.StringIO(res.text)):
                        lat = float(row["latitude"]); lon = float(row["longitude"])
                        coord_key = f"{lat:.2f}_{lon:.2f}"
                        if (FRANCE_BBOX["lat_min"] <= lat <= FRANCE_BBOX["lat_max"] and FRANCE_BBOX["lon_min"] <= lon <= FRANCE_BBOX["lon_max"] and coord_key not in seen_coords):
                            seen_coords.add(coord_key)
                            frp = float(row.get("frp", row.get("brightness", 15.0)))
                            if frp > 500: frp = frp / 15.0
                            acq_time = str(row.get("acq_time", "1200")).zfill(4)
                            iso_utc = f"{str(row.get('acq_date', datetime.now().strftime('%Y-%m-%d')))}T{acq_time[:2]}:{acq_time[2:]}:00Z"
                            if not latest_utc_iso or iso_utc > latest_utc_iso: latest_utc_iso = iso_utc
                            
                            intensity_label = "Critique / Sévère" if frp > 40 else "Foyer Actif" if frp > 15 else "Début de feu / Modéré"
                            features.append({"type": "Feature", "properties": {"id": f"NASA-{coord_key}", "name": f"Détection Satellite ({lat:.2f}, {lon:.2f})", "status": f"FRP: {frp:.1f} MW", "intensity": intensity_label, "frp": round(frp, 1), "time_utc": iso_utc, "source": "NASA FIRMS"}, "geometry": {"type": "Point", "coordinates": [round(lon, 4), round(lat, 4)]}})
                            plumes.append(calculate_smoke_plume(lat, lon, w_dir, w_speed, frp))
                            fire_points.append([lon, lat])
                except Exception: pass

        try:
            for ac in get_cached_data("aircraft_live", 3.0, lambda: {"aircraft": []}).get("aircraft", []):
                if ac.get("is_tactical") and ac.get("altitude", 0) < 1100 and ac.get("speed", 0) < 320:
                    lat, lon = ac["lat"], ac["lon"]; coord_key = f"{lat:.2f}_{lon:.2f}"
                    if coord_key not in seen_coords:
                        seen_coords.add(coord_key)
                        now_utc = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%00Z")
                        features.append({"type": "Feature", "properties": {"id": f"TACTICAL-{coord_key}", "name": f"⚠️ Intervention ({ac['callsign']})", "status": "Largage / Surveillance", "intensity": "Détecté par vol", "frp": 25.0, "time_utc": now_utc, "source": f"Radar ({ac['callsign']})"}, "geometry": {"type": "Point", "coordinates": [round(lon, 4), round(lat, 4)]}})
                        plumes.append(calculate_smoke_plume(lat, lon, w_dir, w_speed, frp=25.0))
                        fire_points.append([lon, lat])
        except Exception: pass

        clustered_burned_areas, calculated_ha = calculate_clustered_burned_perimeters(fire_points)
        official_stats = {"hectares": f"{calculated_ha:,} ha (Calculé)", "houses": 198, "evacuations": "220 000 personnes évacuées"}

        return {
            "fires": {"type": "FeatureCollection", "features": features}, 
            "plumes": {"type": "FeatureCollection", "features": plumes}, 
            "burned_areas": {"type": "FeatureCollection", "features": clustered_burned_areas},
            "count": len(features), 
            "latest_satellite_utc": latest_utc_iso or datetime.utcnow().strftime("%Y-%m-%dT%H:%M:00Z"), 
            "next_satellite_pass": get_next_satellite_pass(), "stats": official_stats
        }
    return jsonify(get_cached_data("fires_live_nasa", 180.0, fetch_all_fires))

@app.route('/robots.txt')
def robots_txt():
    content = "User-agent: *\nAllow: /\n\nSitemap: https://francefiretracker.me/sitemap.xml\n"
    return Response(content, mimetype="text/plain")

@app.route('/sitemap.xml')
def sitemap_xml():
    now_str = datetime.utcnow().strftime("%Y-%m-%d")
    content = f"""<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
    <url>
        <loc>https://francefiretracker.me/</loc>
        <lastmod>{now_str}</lastmod>
        <changefreq>hourly</changefreq>
        <priority>1.0</priority>
    </url>
</urlset>"""
    return Response(content, mimetype="application/xml")

@app.route('/sw.js')
def service_worker(): return app.send_static_file('sw.js')

@app.route('/manifest.json')
def manifest(): return app.send_static_file('manifest.json')

if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=5000)