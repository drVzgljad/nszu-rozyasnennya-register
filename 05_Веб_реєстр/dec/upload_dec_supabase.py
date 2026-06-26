import json
import os
import urllib.request
import urllib.error
import getpass
from pathlib import Path

SUPABASE_URL = 'https://qdqtkvyvhtjgxpxnvblk.supabase.co'
SUPABASE_KEY = 'sb_publishable_YXDm02hDBzLQmsUuVnZ_Og_IxQ60VCz'

# Resolve paths relative to script location
SCRIPT_DIR = Path(__file__).resolve().parent
LOCAL_JSON_PATH = SCRIPT_DIR.parent / "data" / "dec_documents.json"

def main():
    print("=======================================================")
    print("   Завантаження бази документів ДЕЦ МОЗ у Supabase   ")
    print("=======================================================")
    print()
    
    if not LOCAL_JSON_PATH.exists():
        print(f"[ПОМИЛКА] Локальний файл з даними не знайдено: {LOCAL_JSON_PATH}")
        print("Будь ласка, запустіть спочатку оновлення локальної бази.")
        input("\nНатисніть Enter для виходу...")
        return

    print(f"Зчитування даних з {LOCAL_JSON_PATH.name}...")
    try:
        with open(LOCAL_JSON_PATH, "r", encoding="utf-8") as f:
            local_data = json.load(f)
        docs = local_data.get("documents", [])
        print(f"Знайдено {len(docs)} документів для завантаження.")
    except Exception as e:
        print(f"[ПОМИЛКА] Не вдалося прочитати JSON файл: {e}")
        input("\nНатисніть Enter для виходу...")
        return

    if not docs:
        print("[ПОМИЛКА] У файлі немає документів для імпорту.")
        input("\nНатисніть Enter для виходу...")
        return

    print("\nВведіть ваші облікові дані на порталі (акаунт з роллю Admin/Director/Manager):")
    email = input("Email: ").strip()
    password = getpass.getpass("Пароль: ")

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

    # 4. Clear the table
    print("\nОчищення старої бази даних 'dec_documents' у хмарі...")
    delete_url = f"{SUPABASE_URL}/rest/v1/dec_documents?id=gt.-1"
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

    # 5. Seed new records in chunks of 100
    chunk_size = 100
    total_docs = len(docs)
    print(f"\nЗавантаження {total_docs} документів пачками по {chunk_size}...")

    for i in range(0, total_docs, chunk_size):
        chunk = docs[i:i + chunk_size]
        end_idx = min(i + chunk_size, total_docs)
        
        # Prepare payload: map keys properly (omit search_text)
        payload = []
        for d in chunk:
            payload.append({
                "id": int(d["id"]),
                "category": d["category"],
                "title": d["title"],
                "status": d.get("status"),
                "type": d.get("type"),
                "number": d.get("number"),
                "published": d.get("published"),
                "year": d.get("year"),
                "document_url": d.get("document_url"),
                "category_url": d.get("category_url")
            })

        print(f"Надсилання документів {i + 1} - {end_idx}...")
        
        upload_url = f"{SUPABASE_URL}/rest/v1/dec_documents"
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
