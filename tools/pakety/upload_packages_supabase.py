import os
import json
import urllib.request
import urllib.error
import getpass
from pathlib import Path

SUPABASE_URL = 'https://qdqtkvyvhtjgxpxnvblk.supabase.co'
SUPABASE_KEY = 'sb_publishable_YXDm02hDBzLQmsUuVnZ_Og_IxQ60VCz'

# Resolve paths
SCRIPT_DIR = Path(__file__).resolve().parent
# Джерела даних перенесено з OneDrive у D:\pmg-data (15.07.2026); репо сайту — D:\rpe-pmg
PROJECT_ROOT = Path(r"D:\pmg-data")
PORTAL_ROOT = SCRIPT_DIR.parent # 05_Веб_реєстр
OUTPUT_JSON_PATH = SCRIPT_DIR / "data" / "packages_list.json"

def scan_packages(current_dir):
    packages = []
    
    # 1. Scan 14_архив_пакети
    archive_root = current_dir / "14_архив_пакети"
    if archive_root.exists():
        for year_dir in os.listdir(archive_root):
            year_path = archive_root / year_dir
            if year_path.is_dir() and year_dir.isdigit():
                year = int(year_dir)
                for file in os.listdir(year_path):
                    if file.startswith('.') or file.startswith('~$'):
                        continue
                    ext = os.path.splitext(file)[1].lower()
                    if ext not in ['.docx', '.doc', '.pdf']:
                        continue
                    file_path = year_path / file
                    if file_path.is_file():
                        rel_path = file_path.relative_to(PROJECT_ROOT).as_posix()
                        packages.append({
                            "name": file,
                            "year": year,
                            "size": file_path.stat().st_size,
                            "path": rel_path
                        })
                        
    # 2. Scan paket_26
    paket26_root = current_dir / "paket_26"
    if paket26_root.exists():
        for file in os.listdir(paket26_root):
            if file.startswith('.') or file.startswith('~$'):
                continue
            ext = os.path.splitext(file)[1].lower()
            if ext not in ['.docx', '.doc', '.pdf']:
                continue
            file_path = paket26_root / file
            if file_path.is_file():
                rel_path = file_path.relative_to(PROJECT_ROOT).as_posix()
                packages.append({
                    "name": file,
                    "year": 2026,
                    "size": file_path.stat().st_size,
                    "path": rel_path
                })
                
    packages.sort(key=lambda x: (-x['year'], x['name']))
    return packages

def main():
    print("=======================================================")
    print("   Завантаження Архіву Пакетів ПМГ у Supabase   ")
    print("=======================================================")
    print()

    # 1. Scan files
    print(f"Сканування папок пакетів у {PROJECT_ROOT.name}...")
    packages = scan_packages(PROJECT_ROOT)
    print(f"Знайдено {len(packages)} файлів пакетів.")

    if not packages:
        print("[ПОМИЛКА] Не знайдено файлів пакетів у папках '14_архив_пакети' або 'paket_26'.")
        input("\nНатисніть Enter для виходу...")
        return

    # 2. Save static fallback JSON
    print(f"Збереження локальної копії реєстру у {OUTPUT_JSON_PATH.name}...")
    OUTPUT_JSON_PATH.parent.mkdir(parents=True, exist_ok=True)
    try:
        with open(OUTPUT_JSON_PATH, "w", encoding="utf-8") as f:
            json.dump(packages, f, ensure_ascii=False, indent=2)
        print("[УСПІШНО] Локальну копію збережено.")
    except Exception as e:
        print(f"[ПОПЕРЕДЖЕННЯ] Не вдалося зберегти локальний JSON: {e}")

    # 3. Get credentials
    print("\nВведіть ваші облікові дані на порталі (акаунт з роллю Admin/Director/Manager):")
    email = input("Email: ").strip()
    password = input("Пароль: ")

    # 4. Authenticate
    print("\nАвторизація в системі Supabase...")
    auth_url = f"{SUPABASE_URL}/auth/v1/token?grant_type=password"
    auth_payload = {
        "email": email,
        "password": password
    }
    headers = {
        "apikey": SUPABASE_KEY,
        "Content-Type": "application/json"
    }

    req = urllib.request.Request(
        auth_url,
        data=json.dumps(auth_payload).encode('utf-8'),
        headers=headers
    )
    
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            res_data = json.loads(r.read().decode('utf-8'))
            access_token = res_data["access_token"]
            user_data = res_data["user"]
            print(f"[УСПІШНО] Авторизовано як: {user_data.get('email')}")
    except urllib.error.HTTPError as e:
        body = e.read().decode('utf-8')
        print(f"[ПОМИЛКА] Не вдалося увійти в систему ({e.code}): {body}")
        input("\nНатисніть Enter для виходу...")
        return
    except Exception as e:
        print(f"[ПОМИЛКА] Помилка підключення: {e}")
        input("\nНатисніть Enter для виходу...")
        return

    auth_headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json"
    }

    # 5. Clear table in Supabase
    print("\nОчищення старої таблиці 'pmg_packages' у хмарі...")
    delete_url = f"{SUPABASE_URL}/rest/v1/pmg_packages?year=gt.0" # Delete all years > 0
    del_req = urllib.request.Request(delete_url, method="DELETE", headers=auth_headers)
    
    try:
        with urllib.request.urlopen(del_req, timeout=15) as r:
            print("[УСПІШНО] Старі записи видалено з бази.")
    except urllib.error.HTTPError as e:
        body = e.read().decode('utf-8')
        print(f"[ПОМИЛКА] Не вдалося очистити таблицю ({e.code}): {body}")
        print("\nБудь ласка, переконайтеся, що ви виконали SQL-запит для створення таблиці в кабінеті Supabase.")
        input("\nНатисніть Enter для виходу...")
        return
    except Exception as e:
        print(f"[ПОМИЛКА] Не вдалося очистити таблицю: {e}")
        input("\nНатисніть Enter для виходу...")
        return

    # 6. Upload packages to Supabase in chunks of 100
    chunk_size = 100
    total_packages = len(packages)
    print(f"\nЗавантаження {total_packages} пакетів пачками по {chunk_size}...")

    for i in range(0, total_packages, chunk_size):
        chunk = packages[i:i + chunk_size]
        end_idx = min(i + chunk_size, total_packages)
        
        payload = []
        for p in chunk:
            payload.append({
                "name": p["name"],
                "year": int(p["year"]),
                "size": int(p["size"]),
                "path": p["path"]
            })

        print(f"Надсилання файлів {i + 1} - {end_idx}...")
        
        upload_url = f"{SUPABASE_URL}/rest/v1/pmg_packages"
        upload_req = urllib.request.Request(
            upload_url,
            data=json.dumps(payload).encode('utf-8'),
            headers=auth_headers
        )
        
        try:
            with urllib.request.urlopen(upload_req, timeout=15) as r:
                pass
        except urllib.error.HTTPError as e:
            body = e.read().decode('utf-8')
            print(f"[ПОМИЛКА] Не вдалося завантажити пакет {i+1}-{end_idx} ({e.code}): {body}")
            input("\nНатисніть Enter для виходу...")
            return
        except Exception as e:
            print(f"[ПОМИЛКА] Помилка завантаження пакета: {e}")
            input("\nНатисніть Enter для виходу...")
            return

    print("\n=======================================================")
    print("   Синхронізація з базою Supabase успішно завершена!   ")
    print("=======================================================")
    input("\nНатисніть Enter для виходу...")

if __name__ == '__main__':
    main()
