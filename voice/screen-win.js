/**
 * Екран спікера в окремому вікні (25.11.2026). Користувач: «зроби, щоб екран спікера відкривався в
 * новому вікні з можливістю розширення на весь екран та мінімізації».
 *
 * Хто тримає голос (голосове вікно або вкладка на запасному шляху), той і відкриває вікно
 * ./screen.html: відео приходить у з'єднання саме тут, тож потік передаємо сторінці вікна напряму
 * (те саме походження — MediaStream можна віддати іншому вікну). Вікно саме нічого не з'єднує.
 *
 * - Хтось почав показ — вікно відкривається саме. Браузер заблокував (спливні вікна заборонені) —
 *   на «сцені» лишається кнопка «⧉ Окреме вікно», вона відкриває його кліком.
 * - Людина закрила вікно посеред показу — само вже не відкривається, до наступного показу.
 * - Показ закінчився — вікно пише «Показ завершено» і закривається. Пішли з голосу — теж.
 * - Своє вікно для себе не відкриваємо: свій екран не дзеркалимо.
 */

const NAME = 'pmg-voice-screen';

export function createScreenWin() {
  let w = null;
  let cur = null;          // { key, name, stream } або null
  let autoFor = '';        // для чийого показу вже пробували відкрити вікно саме
  let blocked = false;

  const alive = () => !!(w && !w.closed);

  function push() {
    if (!alive()) return;
    try { w.pmgShow?.(cur ? { name: cur.name, stream: cur.stream } : null); } catch (_) { /* вікно ще вантажиться */ }
  }

  // Сторінка вікна, завантажившись, просить потік сама (до того pmgShow у ній ще немає)
  window.__pmgScreen = { ready(cw) { if (cw === w) push(); } };

  /** Відкрити (або показати поверх) вікно екрана. З кліку — завжди; без кліку — якщо браузер дасть. */
  function open() {
    if (!cur) return false;
    if (alive()) { try { w.focus(); } catch (_) { /* браузер не дав */ } push(); return true; }
    const sw = screen.availWidth || 1280;
    const sh = screen.availHeight || 800;
    const width = Math.round(Math.min(1280, sw * 0.72));
    const height = Math.round(Math.min(860, sh * 0.78));
    const left = Math.round((screen.availLeft || 0) + (sw - width) / 2);
    const top = Math.round((screen.availTop || 0) + (sh - height) / 2);
    let nw = null;
    try { nw = window.open('/voice/screen.html', NAME, `popup,width=${width},height=${height},left=${left},top=${top}`); } catch (_) { nw = null; }
    if (!nw) { blocked = true; return false; }
    w = nw;
    blocked = false;
    return true;
  }

  /** З onChange рушія: presenter — { key, name, me, stream } або null. */
  function update(pr) {
    const next = pr && !pr.me && pr.stream ? { key: pr.key, name: pr.name, stream: pr.stream } : null;
    const changed = next?.key !== cur?.key || next?.stream !== cur?.stream || next?.name !== cur?.name;
    cur = next;
    if (!next) { autoFor = ''; blocked = false; }
    if (next && autoFor !== next.key) { autoFor = next.key; open(); }
    if (changed) push();
  }

  function close() {
    cur = null;
    push();
    if (alive()) { try { w.close(); } catch (_) { /* уже закрито */ } }
  }

  window.addEventListener('pagehide', close);

  return {
    update,
    open,
    close,
    get blocked() { return blocked && !alive(); },
    get isOpen() { return alive(); }
  };
}
