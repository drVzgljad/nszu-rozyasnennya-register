import csv
import json
import re
from pathlib import Path


BASE = Path(__file__).resolve().parents[1]
REGISTRY_PATH = BASE / "04_Реєстр" / "реєстр_розяснень_НСЗУ_175.json"
ANALYSIS_PATH = BASE / "04_Реєстр" / "аналіз_текстового_шару.json"
OCR_PATH = BASE / "04_Реєстр" / "ocr_results.json"
OUTPUT_JSON = BASE / "04_Реєстр" / "пропоновані_назви.json"
OUTPUT_CSV = BASE / "04_Реєстр" / "пропоновані_назви.csv"
ORIGINALS = BASE / "00_Оригінали"


def compact(text):
    return re.sub(r"\s+", " ", text or "").strip()


def safe_part(text):
    text = text.replace("’", "'").replace("«", "").replace("»", "")
    text = re.sub(r'[<>:"/\\|?*.,;()]+', " ", text)
    text = re.sub(r"\s+", "-", text.strip())
    return text.strip("-")


def detect_package(text):
    patterns = [
        ("стаціонарна допомога дорослим та дітям без проведення хірургіч", "Стаціонарна-допомога-без-операцій"),
        ("хірургічн", "Хірургія-стаціонар"),
        ("стаціонару одного дня", "Хірургія-одного-дня"),
        ("реабілітаційн", "Реабілітація"),
        ("паліатив", "Паліативна-допомога"),
        ("первинн", "ПМД"),
        ("полог", "Допомога-при-пологах"),
        ("новонароджен", "Допомога-новонародженим"),
        ("медичний огляд осіб", "Медогляд-ТЦК"),
        ("допоміжних репродуктив", "Лікування-безпліддя-ДРТ"),
        ("довготривалого медсестрин", "Довготривалий-медсестринський-догляд"),
        ("гострому мозковому інсульт", "Інсульт"),
        ("інфаркт", "Інфаркт"),
        ("трансплантац", "Трансплантація"),
        ("гемодіаліз", "Гемодіаліз"),
        ("перитонеального діаліз", "Перитонеальний-діаліз"),
        ("радіологічн", "Радіологічне-лікування"),
        ("психіатр", "Психіатрична-допомога"),
        ("туберкульоз", "Туберкульоз-ПМД"),
        ("зубо", "Стоматологічна-допомога"),
        ("медична допомога дітям", "Медична-допомога-дітям"),
        ("профілактика, діагностика", "Амбулаторна-допомога"),
        ("амбулаторн", "Амбулаторна-допомога"),
    ]
    lower = text.lower()
    for marker, value in patterns:
        if marker in lower:
            return value
    return "Без-пакета"


def detect_direction(text, package):
    lower = text.lower()
    package_directions = {
        "Амбулаторна-допомога": "Амбулаторна-допомога",
        "Стаціонарна-допомога-без-операцій": "Стаціонарна-допомога",
        "Хірургія-стаціонар": "Хірургічна-допомога",
        "Хірургія-одного-дня": "Хірургічна-допомога",
        "Медогляд-ТЦК": "Медичні-огляди",
        "Лікування-безпліддя-ДРТ": "Репродуктивні-технології",
        "Довготривалий-медсестринський-догляд": "Довготривалий-догляд",
        "Трансплантація": "Трансплантація",
        "Психіатрична-допомога": "Психіатрична-допомога",
    }
    if package in package_directions:
        return package_directions[package]
    if "реабілітац" in lower:
        return "Реабілітація"
    if "паліатив" in lower:
        return "Паліативна-допомога"
    if package in {"ПМД", "Туберкульоз-ПМД"} or "первинн" in lower:
        return "Первинна-допомога"
    if any(key in lower for key in ("полог", "новонароджен", "медична допомога дітям")):
        return "Материнство-та-дитинство"
    if any(key in lower for key in ("хірургіч", "стаціонару одного дня")):
        return "Хірургічна-допомога"
    if any(key in lower for key in ("інсульт", "інфаркт")):
        return "Гострі-стани"
    if any(key in lower for key in ("онколог", "радіологіч")):
        return "Онкологія"
    if "трансплантац" in lower:
        return "Трансплантація"
    if "допоміжних репродуктив" in lower:
        return "Репродуктивні-технології"
    if "медичний огляд осіб" in lower:
        return "Медичні-огляди"
    if "довготривалого медсестрин" in lower:
        return "Довготривалий-догляд"
    if "діаліз" in lower:
        return "Діаліз"
    if "зубо" in lower:
        return "Стоматологія"
    if "антикорупц" in lower or "можливі порушення" in lower:
        return "Антикорупція"
    if "верифікац" in lower:
        return "Верифікація-даних"
    if "аптеч" in lower or "реімбурсац" in lower:
        return "Реімбурсація"
    if "лікарських засоб" in lower or "тромболітич" in lower:
        return "Лікарські-засоби"
    if "коштів інших джерел" in lower or "фактичної вартості" in lower:
        return "Оплата-та-звітування"
    if "договор" in lower or "smart tender" in lower or "чинності декларацій" in lower:
        return "Договори-та-контрактування"
    if "програми державних гарантій" in lower:
        return "ПМГ"
    if "лабораторій мікробіолог" in lower:
        return "Лабораторна-діагностика"
    if "секційн" in lower:
        return "Секційні-дослідження"
    if "кодування основного" in lower:
        return "Кодування-та-моніторинг"
    if "контрактув" in lower or "укладення договор" in lower:
        return "Контрактування"
    if any(key in lower for key in ("есоз", "емз", "електронн")):
        return "ЕСОЗ-та-ЕМЗ"
    return "Інше"


def detect_content(text):
    lower = text.lower()
    addendum = re.search(r"додат(?:ок|ки)\s*([0-9]+(?:\s*[-–]\s*[0-9]+)?)?", lower)
    if addendum:
        number = re.sub(r"\s+", "", addendum.group(1) or "")
        label = f"Додаток-{number}" if number else "Додаток"
        tail = safe_part(text[addendum.end():]).split("-")
        tail = [word for word in tail if word][:5]
        return f"{label}_{'-'.join(tail)}" if tail else label
    patterns = [
        ("експериментального проекту", "Виконання-вимог-проекту"),
        ("множинн", "Множинні-операції"),
        ("симультан", "Симультанні-та-повторні-операції"),
        ("принцип оплати", "Принцип-оплати-та-облік"),
        ("правил ведення", "Ведення-ЕМЗ"),
        ("ведення електронн", "Ведення-ЕМЗ"),
        ("внесення змін до договор", "Зміни-до-договорів"),
        ("внесення", "Внесення-даних-ЕСОЗ"),
        ("обліку та кодування", "Облік-та-кодування"),
        ("обліку", "Облік-послуг"),
        ("кодування", "Кодування"),
        ("відповідності", "Відповідність-вимогам"),
        ("контрактув", "Контрактування"),
        ("укладення договор", "Укладення-договору"),
        ("коштів інших джерел", "Оплата-з-інших-джерел"),
        ("медичного обладнання", "Реєстрація-обладнання"),
    ]
    for marker, value in patterns:
        if marker in lower:
            return value
    cleaned = re.sub(
        r"^(роз['’]яснення|додаткове роз['’]яснення|інформування|лист надавачам)(\s+щодо)?\s*",
        "",
        text,
        flags=re.IGNORECASE,
    )
    words = safe_part(cleaned).split("-")
    return "-".join(words[:6]) if words else "Зміст-на-перевірку"


def detect_year(title, extracted, url):
    date_match = re.search(r"\b\d{1,2}[./-]\d{1,2}[./-](20(?:1[8-9]|2[0-6]))\b", title)
    if date_match and (date_match.start() < 60 or title.lower().startswith("лист")):
        return date_match.group(1), "title_date"
    topic_match = re.search(
        r"(?:на|у|в|контрактування)\s+(20(?:1[8-9]|2[0-6]))\s*(?:р(?:ік|оці|оку))?",
        title,
        flags=re.IGNORECASE,
    )
    if topic_match:
        return topic_match.group(1), "title_year"
    match = re.search(r"/(\d{2})/\d{2}/\d{2}/", url)
    if match:
        return f"20{match.group(1)}", "publication_year"
    return "Рік-не-визначено", "review"


def main():
    registry = json.loads(REGISTRY_PATH.read_text(encoding="utf-8"))
    analysis = json.loads(ANALYSIS_PATH.read_text(encoding="utf-8"))
    analysis_by_name = {item["original_file_name"]: item for item in analysis["files"]}
    proposals = []
    prior_primary = ""
    occurrence = {}
    overrides = {
        62: ("Стоматологія", "Стоматологічна-допомога", "Зуболікування-та-зубопротезування-військовослужбовців"),
        58: ("Паліативна-допомога", "Паліативна-допомога", "Додатки-1-3"),
        124: ("Доступність-комунікацій", "Без-пакета", "Переклад-жестовою-мовою"),
        134: ("Реабілітація", "Пакети-53-54", "Перелік-інтервенцій"),
        133: ("ЕСОЗ-та-ЕМЗ", "Е-направлення", "Е-направлення"),
        149: ("Договори-та-контрактування", "Без-пакета", "Тендер-змін-реорганізація"),
    }

    for record in registry["documents"]:
        original = record["original_file_name"]
        if original in occurrence:
            existing = occurrence[original]
            proposals.append({**existing, "id": record["id"], "site_title": record["site_title"], "duplicate_of": existing["id"]})
            continue
        item = analysis_by_name[original]
        text_path = BASE / item.get("text_file", "")
        extracted = text_path.read_text(encoding="utf-8") if text_path.exists() else ""
        ocr_path = BASE / "01_Текст_та_OCR" / f"{Path(original).stem}.ocr.txt"
        if ocr_path.exists():
            extracted = ocr_path.read_text(encoding="utf-8")
        title = compact(record["site_title"])
        generic_addendum = bool(re.match(r"^додаток\s*\d*\s*$", title, re.IGNORECASE))
        context_title = prior_primary if generic_addendum and prior_primary else title
        if not generic_addendum:
            prior_primary = title
        primary_context = context_title
        package = detect_package(primary_context)
        if package == "Без-пакета":
            package = detect_package(extracted[:2500])
        direction = detect_direction(primary_context, package)
        if direction == "Інше" and (generic_addendum or title.lower().startswith("інформування")):
            direction = detect_direction(extracted[:2500], package)
        if record["id"] in overrides:
            direction, package, content = overrides[record["id"]]
        else:
            content = detect_content(title if not generic_addendum else f"Додаток {context_title}")
        year, year_basis = detect_year(title, extracted, record["url"])
        ext = Path(original).suffix.lower()
        max_name_length = 80
        suffix = f"_{year}{ext}"
        prefix = f"{direction}_{package}_"
        allowed_content = max_name_length - len(prefix) - len(suffix)
        if len(content) > allowed_content:
            content = content[:allowed_content].rstrip("-_")
        proposed = f"{direction}_{package}_{content}_{year}{ext}"
        proposal = {
            "id": record["id"],
            "site_title": title,
            "original_file_name": original,
            "extension": record["extension"],
            "url": record["url"],
            "direction": direction,
            "package": package,
            "content_short": content,
            "year": year,
            "year_basis": year_basis,
            "text_quality": item["text_quality"],
            "proposed_name": proposed,
            "duplicate_of": "",
            "review_required": "так" if direction == "Інше" else "",
        }
        occurrence[original] = proposal
        proposals.append(proposal)

    used = {}
    for proposal in proposals:
        if proposal["duplicate_of"]:
            continue
        name = proposal["proposed_name"]
        if name in used:
            stem = Path(name).stem
            suffix = Path(name).suffix
            used[name] += 1
            proposal["proposed_name"] = f"{stem}_{used[name]:02d}{suffix}"
        else:
            used[name] = 1

    for proposal in proposals:
        if proposal["duplicate_of"]:
            proposal["proposed_name"] = occurrence[proposal["original_file_name"]]["proposed_name"]

    OUTPUT_JSON.write_text(json.dumps({"records": len(proposals), "proposals": proposals}, ensure_ascii=False, indent=2), encoding="utf-8")
    fields = list(proposals[0].keys())
    with OUTPUT_CSV.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields, delimiter=";")
        writer.writeheader()
        writer.writerows(proposals)
    summary = {}
    for proposal in proposals:
        if not proposal["duplicate_of"]:
            summary[proposal["direction"]] = summary.get(proposal["direction"], 0) + 1
    print(json.dumps({"unique_proposals": len(occurrence), "directions": summary, "review_required": sum(1 for p in occurrence.values() if p["review_required"])}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
