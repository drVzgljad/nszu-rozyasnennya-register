/* Портал експертної інформації ПМГ 2026 — landing "face".
   Tweak-driven palette; pastel blue + green НСЗУ identity. */

const PALETTES = {
  "Небо й мʼята": {
    "--b-50": "#eef6fc", "--b-200": "#bcdaf0", "--b-400": "#6aa9d6", "--b-500": "#4a8fc7", "--b-700": "#2f6b9e",
    "--g-50": "#eef8f1", "--g-200": "#bbe2c9", "--g-400": "#74c2a0", "--g-500": "#54ad84", "--g-700": "#3a8462",
  },
  "Морська глибина": {
    "--b-50": "#eaf3fa", "--b-200": "#abd0ea", "--b-400": "#5e9ccb", "--b-500": "#3a7fb5", "--b-700": "#255b86",
    "--g-50": "#eaf6ef", "--g-200": "#aaddc1", "--g-400": "#69bd95", "--g-500": "#3f9f76", "--g-700": "#2e7355",
  },
  "Аква-зелень": {
    "--b-50": "#e8f6f8", "--b-200": "#a9e0e6", "--b-400": "#66c0cd", "--b-500": "#3a9fb0", "--b-700": "#2a7886",
    "--g-50": "#edf9f1", "--g-200": "#b8e6cd", "--g-400": "#82cda6", "--g-500": "#5bb889", "--g-700": "#3f8c64",
  },
};

const SECTIONS = [
  {
    key: "explanations", title: "Роз'яснення", feature: true, span: "span-3",
    desc: "Офіційні роз'яснення НСЗУ за темою, пакетом, номером, датою або словом з тексту — зі змістом, джерелом і пов'язаними матеріалами.",
    cta: "171 документ", badge: "emblem",
  },
  {
    key: "packages", title: "Пакети 2026", span: "span-3", num: "46",
    desc: "Навігатор по 46 пакетах Програми медичних гарантій: специфікації, умови закупівлі, вимоги до спеціалістів та обладнання.",
    cta: "46 пакетів", green: true,
  },
  {
    key: "resolution", title: "Постанова 1808", span: "span-2", num: "1808",
    desc: "Проіндексовані пункти постанови та Порядку: тарифи, коефіцієнти, правила оплати й строки.",
    cta: "Тарифи й коефіцієнти",
  },
  {
    key: "algorithms", title: "Алгоритми та правила", span: "span-2", num: "377",
    desc: "Пошук за наказом № 377: коди НК 025, діагнози, амбулаторно-асоційовані стани.",
    cta: "Наказ № 377", green: true,
  },
  {
    key: "search", title: "Машина пошуку", span: "span-2", badge: "emblem",
    desc: "Зберіть знайдені вимоги пакетів в один готовий до копіювання текст.",
    cta: "Збірка відповіді", feature: false,
  },
];

const STATS = [
  { num: "171", cap: "документ у бібліотеці" },
  { num: "46", cap: "пакетів ПМГ-2026" },
  { num: "29", cap: "напрямів медичної допомоги" },
  { num: "2026", cap: "редакція програми" },
];

function Emblem({ size = 44, className = "" }) {
  return (
    <img className={`shield ${className}`} src="assets/nszu-shield.svg"
      alt="" aria-hidden="true" style={{ width: size, height: "auto" }} />
  );
}

function SearchIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.2" strokeLinecap="round">
      <circle cx="11" cy="11" r="7"></circle><path d="M21 21l-4.3-4.3"></path>
    </svg>
  );
}

function HubCard({ s }) {
  const cls = "hub-card " + s.span + (s.feature ? " feature" : "");
  const getSectionUrl = (key) => {
    if (key === "explanations") return "../05_Веб_реєстр/index.html";
    if (key === "packages") return "../05_Веб_реєстр/pakety/index.html";
    if (key === "resolution") return "../05_Веб_реєстр/postanova/index.html";
    if (key === "algorithms") return "../05_Веб_реєстр/algorithms/index.html";
    if (key === "search") return "../05_Веб_реєстр/pakety/report.html";
    return "../05_Веб_реєстр/index.html";
  };
  return (
    <a className={cls} href={getSectionUrl(s.key)}>
      {s.badge === "emblem"
        ? <span className="badge-tile"><img className="shield" src="assets/nszu-shield.svg" alt="" aria-hidden="true" /></span>
        : <span className={"num-badge" + (s.green ? " g" : "")}>{s.num}</span>}
      <h3>{s.title}</h3>
      <p>{s.desc}</p>
      <div className="meta">Відкрити <span className="count">{s.cta}</span></div>
    </a>
  );
}

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "palette": "Небо й мʼята",
  "lead": "Синій",
  "heroBg": "Патерн",
  "radius": "Мʼяке"
}/*EDITMODE-END*/;

function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);

  const vars = { ...PALETTES[t.palette] };
  if (t.lead === "Зелений") {
    vars["--accent"] = "var(--g-500)"; vars["--accent-2"] = "var(--b-500)";
    vars["--accent-deep"] = "var(--g-700)"; vars["--accent-2-deep"] = "var(--b-700)";
    vars["--accent-soft"] = "var(--g-50)"; vars["--accent-2-soft"] = "var(--b-50)";
    vars["--emblem-grad"] = "linear-gradient(135deg, var(--g-500), var(--b-500))";
  }
  if (t.radius === "Помірне") {
    vars["--pr-card"] = "14px"; vars["--pr-tile"] = "16px"; vars["--pr-panel"] = "18px"; vars["--pr-chip"] = "9px";
  }
  const heroBgClass = t.heroBg === "Чистий" ? "no-pattern" : "";

  return (
    <div className="portal" style={vars}>
      {/* Header */}
      <header className="top">
        <div className="wrap top-inner">
          <a className="lockup" href="#top">
            <Emblem size={44} />
            <span className="wm">
              <span className="wm-1">Портал експертної інформації</span>
              <span className="wm-2">Програма медичних гарантій 2026</span>
            </span>
          </a>
          <div className="top-spacer"></div>
          <nav className="top-nav">
            <a href="#hub">Розділи</a>
            <a href="#dept">Про портал</a>
            <a href="../05_Веб_реєстр/index.html">Реєстр</a>
          </nav>
          <span className="agency-chip"><img src="assets/nszu-shield.svg" alt="" />НСЗУ</span>
        </div>
      </header>

      {/* Hero */}
      <section className="hero" id="top">
        {t.heroBg !== "Чистий" && <div className="plus-field"></div>}
        <div className="wrap hero-inner">
          <span className="eyebrow"><span className="dot"></span>Експертна інформація для надавачів послуг</span>
          <h1>Усі правила <span className="accent">ПМГ&nbsp;2026</span> —<br />в одному <span className="accent-2">довідковому</span> порталі</h1>
          <p className="hero-lead">Роз'яснення, пакети, постанова та алгоритми Програми медичних гарантій — зібрані, проіндексовані й готові до цитування. Знайдіть відповідь за хвилину, а не за годину.</p>
          <div className="hero-search">
            <SearchIcon />
            <input type="search" placeholder="Наприклад: паліативна допомога, ШВЛ, наказ 377, тариф…" aria-label="Пошук по порталу" />
            <button className="btn btn-primary" onClick={() => {
              const query = document.querySelector('.hero-search input').value.trim();
              window.location.href = "../05_Веб_реєстр/index.html" + (query ? "?q=" + encodeURIComponent(query) : "");
            }}>Шукати</button>
          </div>
          <div className="hero-tags">
            <a href="../05_Веб_реєстр/index.html">Роз'яснення НСЗУ</a>
            <a href="../05_Веб_реєстр/pakety/index.html">Пакети 2026</a>
            <a href="../05_Веб_реєстр/postanova/index.html">Постанова 1808</a>
            <a href="../05_Веб_реєстр/algorithms/index.html">Наказ 377</a>
            <a href="../05_Веб_реєстр/pakety/report.html">Машина пошуку</a>
          </div>

          <div className="stat-strip">
            {STATS.map((x, i) => (
              <div className="cell" key={i}><div className="num">{x.num}</div><div className="cap">{x.cap}</div></div>
            ))}
          </div>
        </div>
      </section>

      {/* Hub */}
      <section className="hub" id="hub">
        <div className="wrap">
          <div className="section-head">
            <div>
              <h2>Розділи порталу</h2>
              <p>П'ять інструментів, що працюють разом над одним документним архівом.</p>
            </div>
          </div>
          <div className="hub-grid">
            {SECTIONS.map((s) => <HubCard key={s.key} s={s} />)}
          </div>
        </div>
      </section>

      {/* Department */}
      <section className="dept" id="dept">
        <div className="wrap dept-inner">
          <div>
            <h2>Зроблено в Департаменті — для тих, хто працює з програмою</h2>
            <p>Портал експертної інформації розроблено силами Департаменту стратегії універсального охоплення населення медичними послугами, щоб контрактні спеціалісти, лікарі та керівники закладів знаходили норму, вимогу чи тариф за секунди.</p>
            <p>Уся інформація походить з офіційного архіву документів НСЗУ та оновлюється разом із програмою.</p>
            <div className="pills">
              <span>Без зовнішнього сприяння</span><span>Офіційні джерела</span><span>Готові до цитування</span>
            </div>
          </div>
          <div className="dept-card">
            <div className="lab">Належність порталу</div>
            <h3>Департамент стратегії універсального охоплення населення медичними послугами</h3>
            <div className="org">
              <img src="assets/nszu-shield.svg" alt="Знак НСЗУ" />
              <div><strong>НСЗУ</strong><span>Національна служба здоров'я України</span></div>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="p-footer">
        <div className="wrap">
          <div className="p-foot-grid">
            <div>
              <div className="f-lockup">
                <Emblem size={44} />
                <span className="wm">
                  <span className="wm-1">Портал експертної інформації</span>
                  <span className="wm-2">Програма медичних гарантій 2026</span>
                </span>
              </div>
              <p>Довідковий портал експертної інформації за Програмою медичних гарантій 2026 року.</p>
            </div>
            <div className="f-col">
              <h4>Розділи</h4>
              <a href="../05_Веб_реєстр/index.html">Роз'яснення</a>
              <a href="../05_Веб_реєстр/pakety/index.html">Пакети 2026</a>
              <a href="../05_Веб_реєстр/postanova/index.html">Постанова 1808</a>
              <a href="../05_Веб_реєстр/algorithms/index.html">Алгоритми та правила</a>
            </div>
            <div className="f-col">
              <h4>Належність</h4>
              <a href="#dept">Департамент стратегії</a>
              <a href="#dept">НСЗУ</a>
              <a href="#top">Про портал</a>
            </div>
          </div>
          <div className="p-foot-base">
            <span>© 2026 НСЗУ · Департамент стратегії універсального охоплення населення медичними послугами</span>
            <span>Розроблено силами Департаменту</span>
          </div>
        </div>
      </footer>

      {/* Tweaks */}
      <TweaksPanel>
        <TweakSection label="Фірмові кольори" />
        <TweakSelect label="Палітра" value={t.palette}
          options={Object.keys(PALETTES)} onChange={(v) => setTweak("palette", v)} />
        <TweakRadio label="Провідний колір" value={t.lead}
          options={["Синій", "Зелений"]} onChange={(v) => setTweak("lead", v)} />
        <TweakSection label="Стиль" />
        <TweakRadio label="Фон героя" value={t.heroBg}
          options={["Патерн", "Чистий"]} onChange={(v) => setTweak("heroBg", v)} />
        <TweakRadio label="Заокруглення" value={t.radius}
          options={["Мʼяке", "Помірне"]} onChange={(v) => setTweak("radius", v)} />
      </TweaksPanel>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
