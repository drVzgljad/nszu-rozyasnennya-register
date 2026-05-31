/* Алгоритми та правила (наказ № 377) — code search → results → reader. */

function algStatus(r) {
  const parts = [];
  if (r.children) parts.push("діти");
  if (r.adults) parts.push("дорослі");
  return parts.join(", ");
}

function AlgorithmsView() {
  const D = window.KIT_ALG;
  const [query, setQuery] = React.useState("");
  const [source, setSource] = React.useState("");
  const [pkg, setPkg] = React.useState("");
  const [selId, setSelId] = React.useState(D.records[0].id);
  const [copied, setCopied] = React.useState(false);

  const packages = [...new Set(D.records.flatMap((r) => r.packages || []))].sort((a, b) => +a - +b);

  const visible = D.records.filter((r) => {
    if (query && !((r.code + " " + r.name).toLowerCase().includes(query.toLowerCase()))) return false;
    if (source && r.source_id !== source) return false;
    if (pkg && !(r.packages || []).includes(pkg)) return false;
    return true;
  });

  React.useEffect(() => {
    if (visible.length && !visible.some((r) => r.id === selId)) setSelId(visible[0].id);
  }, [query, source, pkg]);

  const rec = D.records.find((r) => r.id === selId);
  const summary = rec ? [
    `Код ${rec.code}: ${rec.name}.`,
    `Джерело: ${rec.document_title}, стор. ${rec.page}.`,
    (rec.packages || []).length ? `Пакет/правило: ${rec.packages.join(", ")}.` : "",
    algStatus(rec) ? `Застосовується до: ${algStatus(rec)}.` : "",
  ].filter(Boolean).join("\n") : "";

  const doCopy = () => { setCopied(true); setTimeout(() => setCopied(false), 1300); };

  return (
    <>
      <Hero
        overline="Наказ НСЗУ № 377"
        title="Алгоритми та правила"
        lead="Пошук за кодами НК 025, назвами діагнозів, амбулаторно-асоційованими станами та правилами наказу № 377. Знайдіть код, джерело, сторінку PDF і скопіюйте висновок."
        stats={[{ n: D.documents_count, l: "джерела" }, { n: D.records_count, l: "коди" }, { n: "377", l: "наказ НСЗУ" }]}
        active="algorithms"
        onSection={window.__setSection}
      />
      <main className="algorithms-layout">
        <section className="algorithm-browser" aria-label="Пошук алгоритмів та правил">
          <div className="search-panel">
            <label className="search">
              <span>Пошук у кодах і правилах</span>
              <input type="search" value={query} placeholder="Наприклад: A08.0, Z00.1, ротавірус, профілактика..."
                onChange={(e) => setQuery(e.target.value)} autoComplete="off" />
            </label>
            <div className="filters">
              <label>Джерело
                <select value={source} onChange={(e) => setSource(e.target.value)}>
                  <option value="">Усі джерела</option>
                  {D.documents.map((d) => <option key={d.id} value={d.id}>{d.short_title}</option>)}
                </select>
              </label>
              <label>Пакет / правило
                <select value={pkg} onChange={(e) => setPkg(e.target.value)}>
                  <option value="">Усі пакети</option>
                  {packages.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </label>
            </div>
            <div className="results-summary">
              <span>{`Знайдено: ${visible.length} з ${D.records_count}`}</span>
              <button className="reset" onClick={() => { setQuery(""); setSource(""); setPkg(""); }}>Очистити</button>
            </div>
          </div>
          <div className="source-panel">
            <h2 className="source-panel-title">Джерела</h2>
            <div className="source-cards">
              {D.documents.filter((d) => d.id !== "comparison").map((d) => (
                <a key={d.id} className="source-card">
                  <em>{d.short_title}</em>
                  <strong>{d.title}</strong>
                  <span>{d.description}</span>
                  <span className="source-card-date">Набрали чинності: {D.effective}</span>
                </a>
              ))}
            </div>
          </div>
        </section>

        <section className="algorithm-results" aria-label="Знайдені коди">
          <div className="algorithm-cards">
            {visible.length ? visible.map((r) => (
              <button key={r.id} className={"algorithm-card" + (r.id === selId ? " active" : "")} onClick={() => setSelId(r.id)}>
                <span className="algorithm-code">{r.code}</span>
                <span className="algorithm-card-copy">
                  <span className="algorithm-card-header">
                    <em>{r.source_title}</em>
                    {r.comparison_page && <span className="algorithm-badge">ЗМІНА {D.effective}</span>}
                  </span>
                  <strong><Highlight text={r.name} query={query} /></strong>
                  <span className="algorithm-card-meta">{algStatus(r) ? algStatus(r) + " · " : ""}стор. {r.page}</span>
                </span>
              </button>
            )) : <div className="no-results">За цим запитом кодів не знайдено. Спробуйте код, частину назви або очистіть фільтри.</div>}
          </div>
        </section>

        <article className="algorithm-reader">
          {rec ? (
            <>
              <h2>{rec.code}</h2>
              <div className="algorithm-meta">
                <span className="algorithm-pill">{rec.source_title}</span>
                <span className="algorithm-pill">стор. {rec.page}</span>
                <span className="algorithm-pill algorithm-pill--change">Набрали чинності: {D.effective}</span>
                {(rec.packages || []).map((p) => <span key={p} className="algorithm-pill">Пакет {p}</span>)}
              </div>
              <div className="algorithm-text-box">
                <strong>{rec.name}</strong>
                {algStatus(rec) && <p>Застосовується до: {algStatus(rec)}</p>}
              </div>
              {rec.comparison_page && (
                <div className="algorithm-compare-hint">
                  <span>Зміни до цього коду — у порівняльній таблиці, стор. {rec.comparison_page}</span>
                  <a>Переглянути →</a>
                </div>
              )}
              <label className="search">
                <span>Зведення для копіювання</span>
                <textarea className="algorithm-copy" readOnly value={summary} />
              </label>
              <div className="actions">
                <button className={"action primary" + (copied ? " copied" : "")} onClick={doCopy}>{copied ? "Скопійовано ✓" : "Копіювати висновок"}</button>
                <a className="action">Відкрити PDF</a>
                {(rec.packages || []).filter((v) => /^\d+$/.test(v)).slice(0, 1).map((v) => (
                  <a key={v} className="action" onClick={() => window.__setSection("packages")}>До пакета {v}</a>
                ))}
              </div>
            </>
          ) : <p className="reader-empty-text">Оберіть код або правило, щоб побачити деталі й сформувати текст для копіювання.</p>}
        </article>
      </main>
      <Footer note="Розділ створено для швидкої навігації наказом № 377, додатками та порівняльними матеріалами." />
    </>
  );
}

Object.assign(window, { AlgorithmsView });
