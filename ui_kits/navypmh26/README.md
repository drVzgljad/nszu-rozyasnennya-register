# НавиПМГ26 — UI kit

A high-fidelity, click-through recreation of the **НавиПМГ26** register
(*НСЗУ — National Health Service of Ukraine*). Visuals are lifted directly from the
product's own stylesheets; component logic is cosmetic/illustrative, not production code.

Open **`index.html`** — it boots into the **Роз'яснення** (Clarifications) screen.

## What's interactive
- **Section switcher** (top nav) flips between views. Роз'яснення, Пакети 2026,
  **Постанова 1808** and **Алгоритми 377** are fully built; only Машина пошуку remains a
  stub (and is role-gated — see below).
- **Постанова 1808:** search + norm-type chips (Тариф / Коефіцієнт / Правило оплати /
  Строк / Визначення) → pick a norm → its outline (numbered points or appendix-table
  rows, each with a copy button) loads in the middle → the reader shows the full text with
  query highlighting, a norm summary, source actions and related packages.
- **Алгоритми 377:** search by НК-025 code or diagnosis, filter by source/package → result
  cards (code chip + source + "ЗМІНА" badge) → reader with code pills, status, a comparison
  hint and a copy-ready summary textarea.
- **Авторизація (рівневий доступ):** the **Увійти** button in the nav opens a login /
  register modal (matching the register's Supabase auth — login: email+password;
  register: email, password, name, organisation → confirmation-email message). Sign-in is
  **mocked** client-side and persisted to localStorage; the nav button then shows your
  username (click to sign out). **Машина пошуку** is role-gated — guests see a "Доступ
  обмежено" screen; signed-in users get through. Roles mirror the original:
  guest → registered → full.
- **Роз'яснення:** type in the search box or pick a Напрям/Формат filter → the result
  list narrows and the right-hand reader updates; click any card to open its detail
  (metadata grid, action buttons, library/technical names, content excerpt, related docs).
- **Пакети 2026:** toggle condition chips, search, pick a package → its outline (units)
  loads in the middle column; click a unit to read its numbered requirements with
  query highlighting and linked clarifications.

## Files
| File | Role |
|---|---|
| `index.html` | Entry point — loads React + Babel and all parts |
| `kit.css` | All component styles (imports `../../colors_and_type.css`) |
| `data.js` | Abridged sample corpus (documents + packages), plain globals |
| `Shell.jsx` | `Hero`, `Footer`, `SectionSwitch`, `Tag`, `Label`, `Highlight` |
| `Auth.jsx` | `useMockAuth`, `AuthNavButton`, `AuthModal`, `AccessDenied` (рівневий доступ) |
| `Explanations.jsx` | `ExplanationsView`, `DocumentCard`, `DetailPanel` |
| `Packages.jsx` | `PackagesView` (3-column package navigator) |
| `Resolution.jsx` | `ResolutionView` (Постанова 1808 — norm browser → outline → reader) |
| `Algorithms.jsx` | `AlgorithmsView` (Алгоритми 377 — code search → results → reader) |
| `data-sections.js` | Sample data for Постанова + Алгоритми |
| `App.jsx` | Section state + routing + section stubs |
| `assets/footer-marks.svg` | The footer emblem pair |

## Component inventory
Hero with brand lockup · stat tiles · segmented section switch · search field ·
filter selects · filter chips (pills) · result list cards · detail reader (labels,
metadata grid, action buttons, excerpt panels, related list) · package cards with
numbered tokens · outline links · numbered requirement list · related-explanation links ·
dark footer with agency mark.

## Notes & fidelity
- The real product has **no webfont** (OS Segoe UI). This kit loads **Source Sans 3** as a
  cross-platform Cyrillic stand-in — see the root README "Typography substitution".
- Content is representative sample data, not the full 171-document / 46-package corpus.
- Build from the GitHub repo (https://github.com/drVzgljad/nszu-rozyasnennya-register)
  for exact data structures and the remaining section logic.
