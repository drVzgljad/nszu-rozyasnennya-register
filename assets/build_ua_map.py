# -*- coding: utf-8 -*-
"""Готує SVG-контури областей України для карти покриття на порталі.

Джерело: Natural Earth, ne_10m_admin_1_states_provinces (public domain).
Одиниці відбираються за кодом ISO 3166-2 «UA-*», тому Крим і Севастополь
потрапляють у карту як частина України незалежно від того, як їх підписує
сам Natural Earth.

Проєкція — рівнокутна конічна Ламберта зі стандартними паралелями 46° і 51°
та осьовим меридіаном 31° (те, як Україну малюють на офіційних картах).

Запуск:  python build_ua_map.py <шлях до ne_10m_admin_1_states_provinces.geojson>
Вихід:   assets/ua-oblasts.json
"""
import json, math, os, sys

sys.stdout.reconfigure(encoding='utf-8')

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'ua-oblasts.json')

# ISO 3166-2 -> назва області так, як вона написана у вивантажці договорів
ISO2NAME = {
    'UA-05': 'ВІННИЦЬКА', 'UA-07': 'ВОЛИНСЬКА', 'UA-09': 'ЛУГАНСЬКА',
    'UA-12': 'ДНІПРОПЕТРОВСЬКА', 'UA-14': 'ДОНЕЦЬКА', 'UA-18': 'ЖИТОМИРСЬКА',
    'UA-21': 'ЗАКАРПАТСЬКА', 'UA-23': 'ЗАПОРІЗЬКА', 'UA-26': 'ІВАНО-ФРАНКІВСЬКА',
    'UA-30': 'М.КИЇВ', 'UA-32': 'КИЇВСЬКА', 'UA-35': 'КІРОВОГРАДСЬКА',
    'UA-40': 'М.СЕВАСТОПОЛЬ', 'UA-43': 'АР КРИМ', 'UA-46': 'ЛЬВІВСЬКА',
    'UA-48': 'МИКОЛАЇВСЬКА', 'UA-51': 'ОДЕСЬКА', 'UA-53': 'ПОЛТАВСЬКА',
    'UA-56': 'РІВНЕНСЬКА', 'UA-59': 'СУМСЬКА', 'UA-61': 'ТЕРНОПІЛЬСЬКА',
    'UA-63': 'ХАРКІВСЬКА', 'UA-65': 'ХЕРСОНСЬКА', 'UA-68': 'ХМЕЛЬНИЦЬКА',
    'UA-71': 'ЧЕРКАСЬКА', 'UA-74': 'ЧЕРНІГІВСЬКА', 'UA-77': 'ЧЕРНІВЕЦЬКА',
}
# Короткий підпис на самій карті
SHORT = {
    'ВІННИЦЬКА': 'Вінницька', 'ВОЛИНСЬКА': 'Волинська', 'ЛУГАНСЬКА': 'Луганська',
    'ДНІПРОПЕТРОВСЬКА': 'Дніпропетровська', 'ДОНЕЦЬКА': 'Донецька',
    'ЖИТОМИРСЬКА': 'Житомирська', 'ЗАКАРПАТСЬКА': 'Закарпатська',
    'ЗАПОРІЗЬКА': 'Запорізька', 'ІВАНО-ФРАНКІВСЬКА': 'Івано-Франківська',
    'М.КИЇВ': 'м. Київ', 'КИЇВСЬКА': 'Київська', 'КІРОВОГРАДСЬКА': 'Кіровоградська',
    'М.СЕВАСТОПОЛЬ': 'м. Севастополь', 'АР КРИМ': 'АР Крим', 'ЛЬВІВСЬКА': 'Львівська',
    'МИКОЛАЇВСЬКА': 'Миколаївська', 'ОДЕСЬКА': 'Одеська', 'ПОЛТАВСЬКА': 'Полтавська',
    'РІВНЕНСЬКА': 'Рівненська', 'СУМСЬКА': 'Сумська', 'ТЕРНОПІЛЬСЬКА': 'Тернопільська',
    'ХАРКІВСЬКА': 'Харківська', 'ХЕРСОНСЬКА': 'Херсонська', 'ХМЕЛЬНИЦЬКА': 'Хмельницька',
    'ЧЕРКАСЬКА': 'Черкаська', 'ЧЕРНІГІВСЬКА': 'Чернігівська', 'ЧЕРНІВЕЦЬКА': 'Чернівецька',
}

# ── Проєкція: Lambert Conformal Conic ─────────────────────────────────────────
LAT1, LAT2, LAT0, LON0 = 46.0, 51.0, 48.5, 31.0
R = math.radians


def lcc(lon, lat):
    n = (math.log(math.cos(R(LAT1)) / math.cos(R(LAT2))) /
         math.log(math.tan(math.pi / 4 + R(LAT2) / 2) / math.tan(math.pi / 4 + R(LAT1) / 2)))
    F = (math.cos(R(LAT1)) * math.tan(math.pi / 4 + R(LAT1) / 2) ** n) / n
    rho = F / math.tan(math.pi / 4 + R(lat) / 2) ** n
    rho0 = F / math.tan(math.pi / 4 + R(LAT0) / 2) ** n
    theta = n * R(lon - LON0)
    return rho * math.sin(theta), rho0 - rho * math.cos(theta)


# ── Спрощення контуру (Дуглас — Пекер) ────────────────────────────────────────
def _seg_dist(p, a, b):
    """Відстань від точки p до відрізка a-b."""
    (px, py), (ax, ay), (bx, by) = p, a, b
    dx, dy = bx - ax, by - ay
    if dx == 0 and dy == 0:
        return math.hypot(px - ax, py - ay)
    t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)
    t = max(0.0, min(1.0, t))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def simplify(pts, tol):
    """Дуглас — Пекер. Кільце замкнене (перша точка = остання), тому спершу
    закріплюємо найдальшу від старту точку: інакше відрізок «старт — фініш»
    вироджується в нуль і від контуру нічого не лишається."""
    if len(pts) < 4:
        return pts
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    closed = abs(pts[0][0] - pts[-1][0]) < 1e-9 and abs(pts[0][1] - pts[-1][1]) < 1e-9
    if closed:
        far = max(range(1, len(pts) - 1),
                  key=lambda i: math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]))
        keep[far] = True
        stack = [(0, far), (far, len(pts) - 1)]
    else:
        stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        if b - a < 2:
            continue
        best, bi = -1.0, a
        for i in range(a + 1, b):
            d = _seg_dist(pts[i], pts[a], pts[b])
            if d > best:
                best, bi = d, i
        if best > tol:
            keep[bi] = True
            stack.append((a, bi))
            stack.append((bi, b))
    return [p for p, k in zip(pts, keep) if k]


def rings(geom):
    polys = geom['coordinates'] if geom['type'] == 'MultiPolygon' else [geom['coordinates']]
    for poly in polys:
        for ring in poly:
            yield ring


def main(src):
    data = json.load(open(src, encoding='utf-8'))
    feats = [f for f in data['features']
             if str(f['properties'].get('iso_3166_2', '')) in ISO2NAME]
    if len(feats) != len(ISO2NAME):
        print('! очікували %d одиниць, знайшли %d' % (len(ISO2NAME), len(feats)))

    # 1. Проєктуємо все, щоб знайти спільні межі полотна
    projected = {}
    for f in feats:
        name = ISO2NAME[f['properties']['iso_3166_2']]
        projected[name] = [[lcc(x, y) for x, y in ring] for ring in rings(f['geometry'])]

    xs = [p[0] for rs in projected.values() for r in rs for p in r]
    ys = [p[1] for rs in projected.values() for r in rs for p in r]
    minx, maxx, miny, maxy = min(xs), max(xs), min(ys), max(ys)

    W = 1000.0
    scale = W / (maxx - minx)
    H = round((maxy - miny) * scale, 1)

    def to_svg(p):
        # y у проєкції росте на північ, у SVG — донизу, тому перевертаємо
        return ((p[0] - minx) * scale, (maxy - p[1]) * scale)

    # 2. Спрощуємо вже в екранних координатах: допуск має сенс саме в пікселях.
    #    0,45 px — межі сусідів розходяться менш ніж на пів пікселя, на око не видно.
    TOL = 0.45
    out = {}
    total_pts = 0
    for name, rs in projected.items():
        parts = []
        for ring in rs:
            pts = [to_svg(p) for p in ring]
            pts = simplify(pts, TOL)
            if len(pts) < 4:
                continue
            total_pts += len(pts)
            d = 'M' + 'L'.join('%.1f %.1f' % (x, y) for x, y in pts) + 'Z'
            parts.append(d)
        if not parts:
            continue
        # Точка для підпису — з Natural Earth (спеціально розрахований label point)
        src_f = next(f for f in feats if ISO2NAME[f['properties']['iso_3166_2']] == name)
        lx, ly = to_svg(lcc(float(src_f['properties']['longitude']),
                            float(src_f['properties']['latitude'])))
        out[name] = {'d': ''.join(parts), 'cx': round(lx, 1), 'cy': round(ly, 1),
                     'label': SHORT.get(name, name)}

    # Київ-місто крихітний: підпис виносимо збоку, щоб не наліз на область
    if 'М.КИЇВ' in out:
        out['М.КИЇВ']['tiny'] = True

    doc = {
        'meta': {
            'source': 'Natural Earth, ne_10m_admin_1_states_provinces (public domain)',
            'projection': 'Lambert Conformal Conic, паралелі 46°/51°, меридіан 31°',
            'note': 'Одиниці відібрані за ISO 3166-2 UA-*, тому Крим і Севастополь — у складі України.',
            'viewBox': '0 0 %g %g' % (W, H),
        },
        'oblasts': out,
    }
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(doc, f, ensure_ascii=False, separators=(',', ':'))
    print('записано %s: %.0f КБ, одиниць %d, точок %d, viewBox %s'
          % (OUT, os.path.getsize(OUT) / 1024, len(out), total_pts, doc['meta']['viewBox']))


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'ne_10m_admin_1_states_provinces.geojson')
