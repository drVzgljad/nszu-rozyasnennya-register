import os
import json
import time
import urllib.request
import urllib.parse
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

# Paths
BASE_DIR = Path(__file__).resolve().parent
CONTRACTS_JSON = BASE_DIR.parent / "data" / "contracts.json"
CACHE_JSON = BASE_DIR / "settlement_coords.json"

# Pre-seeded coordinates
PRE_SEEDED = {
    ("КИЇВ", "М.КИЇВ"): [50.4501, 30.5234],
    ("ХАРКІВСЬКА", "ХАРКІВСЬКА"): [49.9935, 36.2304],
    ("ОДЕСЬКА", "ОДЕСЬКА"): [46.4825, 30.7233],
    ("ДНІПРОВСЬКА", "ДНІПРОПЕТРОВСЬКА"): [48.4647, 35.0462],
    ("ЛЬВІВСЬКА", "ЛЬВІВСЬКА"): [49.8397, 24.0297],
    ("ЗАПОРІЗЬКА", "ЗАПОРІЗЬКА"): [47.8388, 35.1396],
    ("ХМЕЛЬНИЦЬКА", "ХМЕЛЬНИЦЬКА"): [48.9796, 26.9871],
    ("КРИВОРІЗЬКА", "ДНІПРОПЕТРОВСЬКА"): [47.9105, 33.3918],
    ("ВІННИЦЬКА", "ВІННИЦЬКА"): [49.2331, 28.4682],
    ("ІВАНО-ФРАНКІВСЬКА", "ІВАНО-ФРАНКІВСЬКА"): [48.9215, 24.7097],
    ("ЧЕРНІВЕЦЬКА", "ЧЕРНІВЕЦЬКА"): [48.2908, 25.9345],
    ("МИКОЛАЇВСЬКА", "МИКОЛАЇВСЬКА"): [46.9750, 31.9946],
    ("СУМСЬКА", "СУМСЬКА"): [50.9077, 34.7981],
    ("ПОЛТАВСЬКА", "ПОЛТАВСЬКА"): [49.5883, 34.5514],
    ("ТЕРНОПІЛЬСЬКА", "ТЕРНОПІЛЬСЬКА"): [49.5535, 25.5948],
    ("ЧЕРКАСЬКА", "ЧЕРКАСЬКА"): [49.4444, 32.0598],
    ("КРОПИВНИЦЬКА", "КІРОВОГРАДСЬКА"): [48.5079, 32.2623],
    ("РІВНЕНСЬКА", "РІВНЕНСЬКА"): [50.6199, 26.2516],
    ("УЖГОРОДСЬКА", "ЗАКАРПАТСЬКА"): [48.6208, 22.2879],
    ("ЖИТОМИРСЬКА", "ЖИТОМИРСЬКА"): [50.2547, 28.6587],
    ("ЛУЦЬКА", "ВОЛИНСЬКА"): [50.7472, 25.3254],
    ("ЧЕРНІГІВСЬКА", "ЧЕРНІГІВСЬКА"): [51.4981, 31.2893],
    ("ХЕРСОНСЬКА", "ХЕРСОНСЬКА"): [46.6354, 32.6169],
    ("КРАМАТОРСЬКА", "ДОНЕЦЬКА"): [48.7390, 37.5838],
    ("СЄВЄРОДОНЕЦЬКА", "ЛУГАНСЬКА"): [48.9482, 38.4965],
}

OBLAST_CENTERS = {
    "М.КИЇВ": [50.4501, 30.5234],
    "КИЇВСЬКА": [50.4501, 30.5234],
    "ХАРКІВСЬКА": [49.9935, 36.2304],
    "ОДЕСЬКА": [46.4825, 30.7233],
    "ДНІПРОПЕТРОВСЬКА": [48.4647, 35.0462],
    "ЛЬВІВСЬКА": [49.8397, 24.0297],
    "ЗАПОРІЗЬКА": [47.8388, 35.1396],
    "ХМЕЛЬНИЦЬКА": [48.9796, 26.9871],
    "ВІННИЦЬКА": [49.2331, 28.4682],
    "ІВАНО-ФРАНКІВСЬКА": [48.9215, 24.7097],
    "ЧЕРНІВЕЦЬКА": [48.2908, 25.9345],
    "МИКОЛАЇВСЬКА": [46.9750, 31.9946],
    "СУМСЬКА": [50.9077, 34.7981],
    "ПОЛТАВСЬКА": [49.5883, 34.5514],
    "ТЕРНОПІЛЬСЬКА": [49.5535, 25.5948],
    "ЧЕРКАСЬКА": [49.4444, 32.0598],
    "КІРОВОГРАДСЬКА": [48.5079, 32.2623],
    "РІВНЕНСЬКА": [50.6199, 26.2516],
    "ЗАКАРПАТСЬКА": [48.6208, 22.2879],
    "ЖИТОМИРСЬКА": [50.2547, 28.6587],
    "ВОЛИНСЬКА": [50.7472, 25.3254],
    "ЧЕРНІГІВСЬКА": [51.4981, 31.2893],
    "ХЕРСОНСЬКА": [46.6354, 32.6169],
    "ДОНЕЦЬКА": [48.7390, 37.5838],
    "ЛУГАНСЬКА": [48.9482, 38.4965]
}

def query_photon(q):
    url = f"https://photon.komoot.io/api/?q={urllib.parse.quote(q)}&limit=1"
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    try:
        with urllib.request.urlopen(req, timeout=1.5) as response:
            data = json.loads(response.read().decode('utf-8'))
            if data and data.get("features"):
                geom = data["features"][0]["geometry"]["coordinates"]
                return [geom[1], geom[0]] # [lat, lon]
    except Exception as e:
        pass
    return None

def geocode_settlement(settlement, oblast):
    # Try 1: "Settlement hromada, Oblast oblast, Ukraine"
    hromada_query = f"{settlement} громада, {oblast} область, Україна"
    coords = query_photon(hromada_query)
    
    if not coords:
        # Try 2: "Settlement, Oblast oblast, Ukraine"
        clean_settlement = settlement.replace(" громада", "").replace(" ГРОМАДА", "")
        direct_query = f"{clean_settlement}, {oblast} область, Україна"
        coords = query_photon(direct_query)
        
    if not coords:
        # Try 3: "Settlement, Ukraine"
        coords = query_photon(f"{clean_settlement}, Україна")
        
    if not coords:
        coords = OBLAST_CENTERS.get(oblast.upper(), [50.4501, 30.5234])
        
    return coords

def main():
    print("Starting concurrent geocoding process...")
    if not CONTRACTS_JSON.exists():
        print(f"Error: {CONTRACTS_JSON} does not exist.")
        return
        
    with open(CONTRACTS_JSON, "r", encoding="utf-8") as f:
        contracts_data = json.load(f)
        
    unique_settlements = set()
    for c in contracts_data.get("contracts", []):
        settlement = c.get("settlement")
        oblast = c.get("oblast")
        if settlement and oblast:
            unique_settlements.add((settlement, oblast))
            
    print(f"Total unique settlements: {len(unique_settlements)}")
    
    # Load existing cache
    cache = {}
    if CACHE_JSON.exists():
        try:
            with open(CACHE_JSON, "r", encoding="utf-8") as f:
                raw_cache = json.load(f)
                for k, coords in raw_cache.items():
                    parts = k.split("||")
                    if len(parts) == 2:
                        cache[(parts[0], parts[1])] = coords
            print(f"Loaded {len(cache)} coordinates from cache.")
        except Exception as e:
            print(f"Failed to load cache: {e}")
            
    # Apply pre-seeded values to cache
    for k, coords in PRE_SEEDED.items():
        if k not in cache:
            cache[k] = coords
            
    # Collect items that need geocoding
    to_geocode = [s for s in unique_settlements if s not in cache]
    print(f"Settlements remaining to geocode: {len(to_geocode)}")
    
    if to_geocode:
        print("Geocoding in parallel using 30 threads...", flush=True)
        completed = 0
        with ThreadPoolExecutor(max_workers=30) as executor:
            future_to_settlement = {
                executor.submit(geocode_settlement, s[0], s[1]): s for s in to_geocode
            }
            
            for future in as_completed(future_to_settlement):
                settlement, oblast = future_to_settlement[future]
                try:
                    coords = future.result()
                    cache[(settlement, oblast)] = coords
                except Exception as exc:
                    print(f"Geocoding generated an exception for {settlement}: {exc}", flush=True)
                    cache[(settlement, oblast)] = OBLAST_CENTERS.get(oblast.upper(), [50.4501, 30.5234])
                
                completed += 1
                if completed % 10 == 0:
                    print(f"Progress: {completed}/{len(to_geocode)} geocoded.", flush=True)
                    save_cache(cache)
                    
    save_cache(cache)
    print("Geocoding completed successfully!", flush=True)

def save_cache(cache):
    json_cache = {}
    for (settlement, oblast), coords in cache.items():
        json_cache[f"{settlement}||{oblast}"] = coords
    with open(CACHE_JSON, "w", encoding="utf-8") as f:
        json.dump(json_cache, f, ensure_ascii=False, indent=2)

if __name__ == "__main__":
    main()
