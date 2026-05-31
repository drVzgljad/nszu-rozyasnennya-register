/* Пакети 2026 — package list + outline + requirement reader. */

function PackagesView() {
  const pkgs = window.KIT_PACKAGES;
  const [query, setQuery] = React.useState("");
  const [activeTags, setActiveTags] = React.useState([]);
  const [selected, setSelected] = React.useState(pkgs[0].number);
  const [unitIdx, setUnitIdx] = React.useState(0);

  const allTags = [...new Set(pkgs.flatMap((p) => p.tags))];
  const toggleTag = (t) =>
    setActiveTags((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]));

  const visible = pkgs.filter((p) => {
    if (query && !(p.title + " " + p.units.map((u) => u.items.map((i) => i.text).join(" ")).join(" "))
      .toLowerCase().includes(query.toLowerCase())) return false;
    if (activeTags.length && !activeTags.every((t) => p.tags.includes(t))) return false;
    return true;
  });

  React.useEffect(() => {
    if (visible.length && !visible.some((p) => p.number === selected)) {
      setSelected(visible[0].number); setUnitIdx(0);
    }
  }, [query, activeTags]);

  const pkg = pkgs.find((p) => p.number === selected) || visible[0];
  const unit = pkg && pkg.units[unitIdx] ? pkg.units[unitIdx] : (pkg && pkg.units[0]);
  const relatedDocs = (pkg.related || [])
    .map((id) => window.KIT_DOCUMENTS.find((d) => d.id === id)).filter(Boolean);

  return (
    <>
      <Hero
        overline="Програма медичних гарантій 2026"
        title="Пакетний навігатор 26"
        lead="Знайдіть пакет, вимогу, спеціаліста або обладнання. Відкривайте конкретні пункти умов закупівлі й пов'язані роз'яснення."
        stats={[{ n: "46", l: "пакетів" }, { n: "29", l: "напрямів" }, { n: "175", l: "записів архіву" }]}
        active="packages"
        onSection={window.__setSection}
      />
      <main className="packages-layout">
        <section aria-label="Пошук пакетів">
          <div className="search-panel">
            <label className="search">
              <span>Пошук у пакетах</span>
              <input type="search" value={query} placeholder="Наприклад: ШВЛ, паліативна, стаціонарно..."
                onChange={(e) => setQuery(e.target.value)} autoComplete="off" />
            </label>
            <div className="tag-filters">
              {allTags.map((t) => (
                <button key={t} className={"filter-chip" + (activeTags.includes(t) ? " active" : "")}
                  onClick={() => toggleTag(t)}>{t}</button>
              ))}
            </div>
            <div className="results-summary">
              <span>{`Пакетів: ${visible.length} з 46`}</span>
              <button className="reset" onClick={() => { setQuery(""); setActiveTags([]); }}>Очистити</button>
            </div>
          </div>
          <div className="package-cards">
            {visible.map((p) => (
              <button key={p.number} className={"package-card" + (p.number === selected ? " active" : "")}
                onClick={() => { setSelected(p.number); setUnitIdx(0); }}>
                <span className="package-number">{p.number}</span>
                <span>
                  <strong>{p.title}</strong>
                  <span className="match-label">{p.units.length} розділ(и) · {p.tags.length} умов</span>
                </span>
              </button>
            ))}
          </div>
        </section>

        <aside className="package-outline">
          <div className="outline-number">ПАКЕТ {pkg.number}</div>
          <h2>{pkg.title}</h2>
          <div className="tag-row">{pkg.tags.map((t) => <span key={t} className="package-tag">{t}</span>)}</div>
          {pkg.units.map((u, i) => (
            <button key={i} className={"outline-link" + (i === unitIdx ? " active" : "")}
              onClick={() => setUnitIdx(i)}>
              {u.label}<span>{u.range}</span>
            </button>
          ))}
        </aside>

        <article className="package-reader">
          <h2>{unit.label}</h2>
          <p className="reader-context">Пакет {pkg.number} · {pkg.title} · файл-джерело {pkg.file}</p>
          <div className="source-heading">{unit.source}</div>
          <div>
            {unit.items.map((it, i) => (
              <div key={i} className={"requirement-item level-" + it.level}>
                <span className="requirement-marker">{it.marker}</span>
                <span className="requirement-text"><Highlight text={it.text} query={query} /></span>
              </div>
            ))}
          </div>
          <div className="package-actions actions">
            <a className="action primary">Відкрити DOCX</a>
            <a className="action">Скопіювати розділ</a>
          </div>
          {relatedDocs.length > 0 && (
            <div className="related-explanations">
              <h3>Пов'язані роз'яснення</h3>
              {relatedDocs.map((d) => (
                <a key={d.id} className="law-related-link">
                  <strong>{d.title}</strong>
                  <span>{d.date} · № {d.number || "—"} · {d.format}</span>
                </a>
              ))}
            </div>
          )}
        </article>
      </main>
      <Footer note="Навігатор створено для швидкого доступу до вимог пакетів Програми медичних гарантій 2026." />
    </>
  );
}

Object.assign(window, { PackagesView });
