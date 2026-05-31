/* Shared НавиПМГ26 components: Hero, Footer, small primitives. */

function Tag({ children, file }) {
  return <span className={"tag" + (file ? " file" : "")}>{children}</span>;
}

function Label({ children, ocr }) {
  return <span className={"label" + (ocr ? " ocr" : "")}>{children}</span>;
}

// highlight query matches in a string
function Highlight({ text, query }) {
  if (!query) return <>{text}</>;
  const i = text.toLowerCase().indexOf(query.toLowerCase());
  if (i === -1) return <>{text}</>;
  return (
    <>{text.slice(0, i)}<mark>{text.slice(i, i + query.length)}</mark>{text.slice(i + query.length)}</>
  );
}

const SECTIONS = [
  { id: "explanations", label: "Роз'яснення" },
  { id: "packages", label: "Пакети 2026" },
  { id: "resolution", label: "Постанова 1808" },
  { id: "search", label: "Машина пошуку", cta: true },
  { id: "algorithms", label: "Алгоритми та правила" },
];

function SectionSwitch({ active, onChange }) {
  return (
    <nav className="section-switch" aria-label="Розділи сайту">
      {SECTIONS.map((s) => (
        <button
          key={s.id}
          className={(s.id === active ? "active" : "") + (s.cta ? " cta" : "")}
          aria-current={s.id === active ? "page" : undefined}
          onClick={() => onChange(s.id)}
        >
          {s.label}
        </button>
      ))}
      {window.AuthNavButton ? <AuthNavButton /> : null}
    </nav>
  );
}

function Hero({ overline, title, lead, stats, active, onSection }) {
  return (
    <header className="hero">
      <div className="hero-copy">
        <div className="overline">{overline}</div>
        <div className="brand-lockup" aria-label="Загальна назва сервісу">
          <img className="brand-shield" src="assets/nszu-shield.svg" alt="" aria-hidden="true" />
          <span className="brand-text">
            <span className="brand-name">Портал експертної інформації</span>
            <span className="brand-subtitle">Програма медичних гарантій 2026</span>
          </span>
        </div>
        <SectionSwitch active={active} onChange={onSection} />
        <h1>{title}</h1>
        <p>{lead}</p>
      </div>
      <div className="stats" aria-label="Статистика реєстру">
        {(stats || window.KIT_STATS).map((s, i) => (
          <div className="stat" key={i}><strong>{s.n}</strong><span>{s.l}</span></div>
        ))}
      </div>
    </header>
  );
}

function Footer({ note }) {
  return (
    <footer className="site-footer">
      <div className="footer-inner">
        <img className="footer-marks" src="assets/nszu-shield.svg" alt="Знак НСЗУ" />
        <div className="footer-copy">
          <div className="footer-agency">НСЗУ</div>
          <div className="footer-department">Департамент стратегії універсального охоплення населення медичними послугами</div>
          <p>{note || "Реєстр розроблено силами Департаменту без зовнішнього сприяння та проєктів."}</p>
        </div>
      </div>
    </footer>
  );
}

Object.assign(window, { Tag, Label, Highlight, SectionSwitch, Hero, Footer, SECTIONS });
