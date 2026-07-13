(function () {
  "use strict";

  const YEAR = 2026;
  const STORAGE_KEY = "hz2026-sign";
  const signs = [
    { n: "Овен", s: "♈", e: "Вогонь", tone: "ініціатива", gift: "сміливість", shadow: "поспіх" },
    { n: "Телець", s: "♉", e: "Земля", tone: "стабільність", gift: "витримку", shadow: "упертість" },
    { n: "Близнюки", s: "♊", e: "Повітря", tone: "спілкування", gift: "гнучкість", shadow: "розпорошення" },
    { n: "Рак", s: "♋", e: "Вода", tone: "внутрішня опора", gift: "чуйність", shadow: "надмірну вразливість" },
    { n: "Лев", s: "♌", e: "Вогонь", tone: "самовираження", gift: "харизму", shadow: "драматизацію" },
    { n: "Діва", s: "♍", e: "Земля", tone: "порядок", gift: "точність", shadow: "перфекціонізм" },
    { n: "Терези", s: "♎", e: "Повітря", tone: "баланс", gift: "дипломатію", shadow: "вагання" },
    { n: "Скорпіон", s: "♏", e: "Вода", tone: "глибина", gift: "проникливість", shadow: "підозріливість" },
    { n: "Стрілець", s: "♐", e: "Вогонь", tone: "розширення горизонтів", gift: "оптимізм", shadow: "необачність" },
    { n: "Козоріг", s: "♑", e: "Земля", tone: "результат", gift: "дисципліну", shadow: "надмірний контроль" },
    { n: "Водолій", s: "♒", e: "Повітря", tone: "оновлення", gift: "оригінальність", shadow: "відстороненість" },
    { n: "Риби", s: "♓", e: "Вода", tone: "інтуїція", gift: "уяву", shadow: "ілюзії" }
  ];

  const focuses = ["Рішення", "Фінанси", "Стосунки", "Творчість", "Відновлення", "Навчання", "Дім", "Кар’єра", "Комунікація", "Здорові межі", "Новий старт", "Завершення справ"];
  const colors = ["смарагдовий", "графітовий", "бурштиновий", "небесно-блакитний", "бордовий", "лавандовий", "сріблястий", "теракотовий", "індиго", "оливковий", "кораловий", "білий"];
  const openings = [
    "День м’яко підштовхує до змін", "Події складатимуться швидше, ніж очікувалося",
    "Невелика деталь сьогодні змінить загальну картину", "Ритм дня сприяє точним крокам",
    "З’явиться шанс повернути собі ініціативу", "Інтуїція помітить те, що логіка ще не оформила",
    "Сьогодні краще діяти послідовно", "День відкриває простір для чесної розмови",
    "Звична справа може дати несподіваний результат", "Настрій дня — менше шуму, більше сенсу",
    "Вдалий момент, щоб спростити складне", "Енергія дня винагороджує уважність"
  ];
  const middles = [
    "залиште запас часу на корекцію планів", "не плутайте терміновість із важливістю",
    "перевіряйте факти до остаточного рішення", "одна завершена справа цінніша за п’ять розпочатих",
    "просіть конкретики й самі говоріть конкретно", "корисна пауза вбереже від зайвого конфлікту",
    "підтримка прийде через знайоме коло людей", "не відмовляйтеся від нестандартного варіанта",
    "бережіть увагу від чужої метушні", "довіртеся досвіду, але залиште місце новому",
    "маленький порядок навколо дасть порядок у думках", "не обіцяйте більше, ніж справді хочете виконати"
  ];
  const workTexts = [
    "Почніть із завдання, яке давно відкладаєте: перші 20 хвилин знімуть половину напруги.",
    "У переговорах виграє не найгучніший аргумент, а найточніша цифра.",
    "Фінансові рішення краще приймати після повторної перевірки умов і дрібного шрифту.",
    "День добрий для структурування плану, бюджету або списку відповідальних.",
    "Не поспішайте погоджуватися на додаткове навантаження без чітких меж.",
    "Може з’явитися корисний контакт; коротко сформулюйте, що саме вам потрібно.",
    "Смілива ідея має шанс, якщо одразу додати до неї реалістичний план.",
    "Завершіть одну видиму справу — це підсилить вашу позицію більше за довгі пояснення.",
    "Уникайте імпульсивних покупок: сьогодні бажання легко маскується під необхідність.",
    "Робоча суперечка вирішиться швидше, якщо відокремити факти від статусів і амбіцій.",
    "Перегляньте старий спосіб роботи: автоматизація або шаблон зекономлять час.",
    "Є сенс нагадати про себе людині, від якої залежить наступний крок."
  ];
  const loveTexts = [
    "Тепла увага до дрібниць сьогодні промовистіша за великі обіцянки.",
    "Не вгадуйте чужі думки — одне пряме запитання прибере зайву напругу.",
    "Добрий день для примирення, якщо говорити про потреби, а не про провину.",
    "Спільна маленька пригода освіжить стосунки краще за серйозний «розбір польотів».",
    "Особисті межі важливі: близькість не вимагає відмови від власних планів.",
    "Можлива несподівана симпатія до людини, яку ви раніше сприймали суто по-діловому.",
    "Не відкладайте вдячність — скажіть уголос, що саме цінуєте в близькій людині.",
    "Сьогодні варто слухати не лише слова, а й інтонації; там буде головна підказка.",
    "Романтичний настрій з’явиться там, де ви дозволите собі бути трохи менш серйозними.",
    "Не повертайте стару суперечку тільки для того, щоб цього разу перемогти.",
    "Самотнім знакам корисно прийняти запрошення, яке спочатку здається буденним.",
    "Спокійна присутність поруч сьогодні важливіша за ідеально підібрані слова."
  ];
  const healthTexts = [
    "Тілу потрібні вода, звичайна їжа й коротка прогулянка — космос іноді напрочуд приземлений.",
    "Розвантажте очі та шию: кілька коротких пауз дадуть більше, ніж вечірнє героїчне відновлення.",
    "Не змагайтеся з утомою; ранній сон сьогодні буде найвигіднішою інвестицією.",
    "Енергія нерівна, тому чергуйте інтенсивні справи зі спокійними.",
    "Добре підійде помірне фізичне навантаження без рекордів і самопокарання.",
    "Зменште інформаційний шум хоча б на годину — нервова система це оцінить.",
    "Слідкуйте за регулярністю харчування: поспіх може непомітно зіпсувати самопочуття.",
    "Дихальна пауза перед складною розмовою допоможе зберегти концентрацію.",
    "Не ігноруйте сигнали перевтоми; сьогодні профілактика дешевша за героїзм.",
    "Корисний день для повернення до простого режиму, який уже колись добре працював.",
    "Відновлення прискорить зміна обстановки: хоча б інший маршрут або 15 хвилин надворі.",
    "Спрямуйте надлишок енергії в рух, але залиште вечір без перевантаження."
  ];
  const adviceTexts = [
    "Не доводьте очевидне тим, хто прийшов не слухати.", "Зробіть перший крок до того, що давно називаєте важливим.",
    "Сьогодні ваше «ні» може бути формою турботи про майбутнє.", "Запишіть сильну думку — пам’ять любить красти геніальні ідеї.",
    "Попросіть конкретної допомоги замість мовчазного очікування.", "Залиште в розкладі місце для приємної випадковості.",
    "Перевірте, чи ваша мета ще ваша, а не просто звичка.", "Закінчіть день одним маленьким приводом пишатися собою.",
    "Не відповідайте одразу, якщо відповідь має наслідки.", "Обирайте ясність, навіть коли туман виглядає романтичніше.",
    "Складне рішення розбийте на один безпечний наступний крок.", "Гумор сьогодні — мастило для іржавих соціальних механізмів."
  ];

  function hash(y, m, d, s) {
    let x = (y * 372 + m * 31 + d) * 37 + (s + 1) * 101;
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    return Math.abs(x | 0);
  }

  function iso(date) {
    return date.toISOString().slice(0, 10);
  }

  function parseDate(value) {
    return new Date(value + "T00:00:00Z");
  }

  function dayIndex(date) {
    return Math.round((date.getTime() - Date.UTC(YEAR, 0, 1)) / 86400000);
  }

  function safeDate(value) {
    const date = parseDate(value);
    return Number.isFinite(date.getTime()) && date.getUTCFullYear() === YEAR ? date : new Date(Date.UTC(YEAR, 0, 1));
  }

  function currentYearDate() {
    const now = new Date();
    if (now.getFullYear() === YEAR) return new Date(Date.UTC(YEAR, now.getMonth(), now.getDate()));
    return new Date(Date.UTC(YEAR, 0, 1));
  }

  function forecast(date, signIndex) {
    const z = signs[signIndex];
    const day = dayIndex(date);
    const h = hash(YEAR, date.getUTCMonth() + 1, date.getUTCDate(), signIndex);
    return {
      energy: 45 + (h % 51),
      focus: focuses[(h + day + signIndex * 3) % focuses.length],
      general: `${openings[(h + signIndex) % openings.length]}. Для знака ${z.n} ключовою стане тема «${z.tone}»: використайте ${z.gift}, але не підживлюйте ${z.shadow}; ${middles[(h + day) % middles.length]}.`,
      work: workTexts[(h + day * 2 + signIndex) % workTexts.length],
      love: loveTexts[(h + day * 3 + signIndex * 2) % loveTexts.length],
      health: healthTexts[(h + day * 5 + signIndex) % healthTexts.length],
      color: colors[(h + day + signIndex) % colors.length],
      number: 1 + ((h + day * 7) % 99),
      advice: adviceTexts[(h + day * 7 + signIndex * 5) % adviceTexts.length]
    };
  }

  function storedSign() {
    try { return localStorage.getItem(STORAGE_KEY); } catch (_) { return null; }
  }

  function saveSign(value) {
    try { localStorage.setItem(STORAGE_KEY, value); } catch (_) { /* storage may be disabled */ }
  }

  function renderShell(root) {
    root.classList.add("hz2026");
    root.innerHTML = `
      <header class="hz2026__hero">
        <p class="hz2026__eyebrow">✦ Ваш космічний навігатор</p>
        <h2 class="hz2026__title">Гороскоп на кожен день 2026</h2>
        <p class="hz2026__lead">Оберіть знак і дату — решту Всесвіт уже оформив у зручні картки.</p>
      </header>
      <div class="hz2026__body">
        <aside class="hz2026__sidebar">
          <section class="hz2026__panel hz2026__panel--pad">
            <h3 class="hz2026__section-title">Ваш знак</h3>
            <div class="hz2026__signs" role="group" aria-label="Оберіть знак зодіаку">
              ${signs.map((z, i) => `<button class="hz2026__sign" type="button" data-sign-index="${i}" aria-pressed="false" aria-label="${z.n}"><span class="hz2026__sign-symbol" aria-hidden="true">${z.s}</span><span class="hz2026__sign-name">${z.n}</span></button>`).join("")}
            </div>
          </section>
          <section class="hz2026__panel hz2026__panel--pad">
            <h3 class="hz2026__section-title">Дата прогнозу</h3>
            <div class="hz2026__date-row">
              <button class="hz2026__icon-btn" type="button" data-action="prev" aria-label="Попередній день">←</button>
              <input class="hz2026__date" type="date" min="2026-01-01" max="2026-12-31" aria-label="Дата прогнозу">
              <button class="hz2026__icon-btn" type="button" data-action="next" aria-label="Наступний день">→</button>
            </div>
            <button class="hz2026__today" type="button" data-action="today">Сьогодні</button>
          </section>
        </aside>
        <section class="hz2026__content" aria-live="polite">
          <div class="hz2026__panel hz2026__forecast-head">
            <div class="hz2026__glyph" data-field="glyph" aria-hidden="true"></div>
            <div>
              <h3 class="hz2026__forecast-title" data-field="title"></h3>
              <p class="hz2026__date-label" data-field="date-label"></p>
            </div>
            <div class="hz2026__energy" data-field="energy-ring" aria-label="Енергія дня">
              <div class="hz2026__energy-inner"><div><strong data-field="energy"></strong><span>енергія</span></div></div>
            </div>
          </div>
          <article class="hz2026__panel hz2026__main"><p data-field="general"></p></article>
          <div class="hz2026__cards">
            <article class="hz2026__panel hz2026__card"><span class="hz2026__card-icon" aria-hidden="true">◈</span><h3>Робота й гроші</h3><p data-field="work"></p></article>
            <article class="hz2026__panel hz2026__card"><span class="hz2026__card-icon" aria-hidden="true">♡</span><h3>Стосунки</h3><p data-field="love"></p></article>
            <article class="hz2026__panel hz2026__card"><span class="hz2026__card-icon" aria-hidden="true">◎</span><h3>Самопочуття</h3><p data-field="health"></p></article>
          </div>
          <div class="hz2026__lucky">
            <div class="hz2026__panel hz2026__lucky-item hz2026__advice"><small>Порада дня</small><strong data-field="advice"></strong></div>
            <div class="hz2026__panel hz2026__lucky-item"><small>Фокус</small><strong data-field="focus"></strong></div>
            <div class="hz2026__panel hz2026__lucky-item"><small>Колір</small><strong data-field="color"></strong></div>
            <div class="hz2026__panel hz2026__lucky-item"><small>Число</small><strong data-field="number"></strong></div>
          </div>
        </section>
      </div>
      <footer class="hz2026__footer">
        <p class="hz2026__note">Розважальний прогноз. Важливі рішення звіряйте з фактами, а не лише з Меркурієм.</p>
        <button class="hz2026__share" type="button" data-action="share">Поділитися прогнозом</button>
      </footer>
      <div class="hz2026__toast" role="status" data-field="toast">Прогноз скопійовано</div>`;
  }

  function init(root) {
    renderShell(root);
    const params = new URLSearchParams(location.search);
    const defaultSign = params.get("hz-sign") || storedSign() || root.dataset.defaultSign || "Овен";
    let signIndex = Math.max(0, signs.findIndex(z => z.n.toLowerCase() === defaultSign.toLowerCase()));
    let date = safeDate(params.get("hz-date") || iso(currentYearDate()));
    const dateInput = root.querySelector(".hz2026__date");
    const signButtons = Array.from(root.querySelectorAll("[data-sign-index]"));

    const field = name => root.querySelector(`[data-field="${name}"]`);
    const dateFormatter = new Intl.DateTimeFormat("uk-UA", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

    function update() {
      const z = signs[signIndex];
      const f = forecast(date, signIndex);
      dateInput.value = iso(date);
      signButtons.forEach((button, i) => button.setAttribute("aria-pressed", String(i === signIndex)));
      field("glyph").textContent = z.s;
      field("title").textContent = z.n;
      field("date-label").textContent = `${dateFormatter.format(date)} · ${z.e}`;
      field("energy").textContent = `${f.energy}%`;
      field("energy-ring").style.setProperty("--hz-energy", `${f.energy}%`);
      ["general", "work", "love", "health", "advice", "focus", "color", "number"].forEach(key => { field(key).textContent = f[key]; });
      root.querySelector('[data-action="prev"]').disabled = iso(date) === "2026-01-01";
      root.querySelector('[data-action="next"]').disabled = iso(date) === "2026-12-31";
    }

    function shift(days) {
      const next = new Date(date.getTime() + days * 86400000);
      if (next.getUTCFullYear() === YEAR) { date = next; update(); }
    }

    function toast(message) {
      const node = field("toast");
      node.textContent = message;
      node.dataset.show = "true";
      clearTimeout(node._timer);
      node._timer = setTimeout(() => { node.dataset.show = "false"; }, 2200);
    }

    async function share() {
      const z = signs[signIndex];
      const f = forecast(date, signIndex);
      const url = new URL(location.href);
      url.searchParams.set("hz-sign", z.n);
      url.searchParams.set("hz-date", iso(date));
      const text = `${z.s} ${z.n} — ${dateFormatter.format(date)}\n${f.general}\nПорада: ${f.advice}`;
      try {
        if (navigator.share) {
          await navigator.share({ title: `Гороскоп 2026 — ${z.n}`, text, url: url.toString() });
        } else {
          await navigator.clipboard.writeText(`${text}\n${url}`);
          toast("Прогноз скопійовано");
        }
      } catch (error) {
        if (error && error.name === "AbortError") return;
        try { await navigator.clipboard.writeText(text); toast("Прогноз скопійовано"); }
        catch (_) { toast("Не вдалося скопіювати"); }
      }
    }

    signButtons.forEach(button => button.addEventListener("click", () => {
      signIndex = Number(button.dataset.signIndex);
      saveSign(signs[signIndex].n);
      update();
    }));
    dateInput.addEventListener("change", () => { date = safeDate(dateInput.value); update(); });
    root.querySelector('[data-action="prev"]').addEventListener("click", () => shift(-1));
    root.querySelector('[data-action="next"]').addEventListener("click", () => shift(1));
    root.querySelector('[data-action="today"]').addEventListener("click", () => { date = currentYearDate(); update(); });
    root.querySelector('[data-action="share"]').addEventListener("click", share);
    update();
  }

  function boot() {
    document.querySelectorAll("[data-hz2026]").forEach(root => {
      if (!root.dataset.hz2026Ready) { root.dataset.hz2026Ready = "true"; init(root); }
    });
  }

  window.Horoscope2026Widget = {
    refresh: boot,
    getForecast(dateValue, signName) {
      const date = safeDate(dateValue);
      const index = signs.findIndex(z => z.n.toLowerCase() === String(signName || "").toLowerCase());
      const signIndex = index >= 0 ? index : 0;
      return { date: iso(date), sign: signs[signIndex].n, symbol: signs[signIndex].s, element: signs[signIndex].e, ...forecast(date, signIndex) };
    }
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
