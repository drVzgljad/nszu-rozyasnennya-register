/* Постанова і Порядок № 1808 — norm browser → outline → reader. */

function ResolutionView() {
  const D = window.KIT_RES;
  const [query, setQuery] = React.useState("");
  const [type, setType] = React.useState("");
  const [selId, setSelId] = React.useState(D.nodes[0].id);
  const [paraId, setParaId] = React.useState("");
  const [copiedId, setCopiedId] = React.useState(null);

  const kindLabel = (n) => n.kind === "chapter" ? "Тарифна глава" : n.kind === "appendix" ? "Додаток" : "Розділ";
  const sourceLabel = (n) => n.legal_document || "Порядок";
  const typeLabels = (n) => n.types.map((t) => D.type_labels[t] || t);
  const nodeText = (n) => [n.title, ...(n.items || []).map((i) => i.text), ...(n.rows || []).map((r) => r.code + " " + r.title)].join(" ").toLowerCase();

  const allTypes = [...new Set(D.nodes.flatMap((n) => n.types))];

  const visible = D.nodes.filter((n) => {
    if (query && !nodeText(n).includes(query.toLowerCase())) return false;
    if (type && !n.types.includes(type)) return false;
    return true;
  });

  React.useEffect(() => {
    if (visible.length && !visible.some((n) => n.id === selId)) { setSelId(visible[0].id); setParaId(""); }
  }, [query, type]);

  const node = D.nodes.find((n) => n.id === selId) || visible[0];

  const shortTitle = (item) => {
    const t = item.text.replace(new RegExp("^\\s*" + (item.marker || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*"), "").trim();
    return t.length > 86 ? t.slice(0, 86).trim() + "..." : t;
  };
  const copyFrag = (id) => { setCopiedId(id); setTimeout(() => setCopiedId(null), 1200); };

  const pages = node.page_start === node.page_end ? `стор. ${node.page_start}` : `стор. ${node.page_start}-${node.page_end}`;

  return (
    <>
      <Hero
        overline="Програма медичних гарантій 2026"
        title="Постанова і Порядок № 1808"
        lead="Окремо проіндексовані пункти постанови та затвердженого нею Порядку: тарифи, коефіцієнти, правила оплати, строки і зв'язки з пакетами ПМГ 2026."
        stats={[{ n: D.counts.chapters, l: "глави" }, { n: D.counts.appendices, l: "додатки" }, { n: D.counts.resolution_items, l: "пункти постанови" }]}
        active="resolution"
        onSection={window.__setSection}
      />
      <main className="packages-layout">
        <section aria-label="Пошук норм постанови та Порядку">
          <div className="search-panel">
            <label className="search">
              <span>Пошук у постанові та Порядку</span>
              <input type="search" value={query} placeholder="Наприклад: коефіцієнт, паліативна, до 1 липня..."
                onChange={(e) => setQuery(e.target.value)} autoComplete="off" />
            </label>
            <div className="tag-filters">
              {allTypes.map((t) => (
                <button key={t} className={"filter-chip" + (type === t ? " active" : "")}
                  onClick={() => setType(type === t ? "" : t)}>{D.type_labels[t]}</button>
              ))}
            </div>
            <div className="results-summary">
              <span>{`Знайдено: ${visible.length} з ${D.nodes.length}`}</span>
              <button className="reset" onClick={() => { setQuery(""); setType(""); }}>Очистити</button>
            </div>
          </div>
          <div className="package-cards">
            {visible.length ? visible.map((n) => (
              <button key={n.id} className={"resolution-card" + (n.id === selId ? " active" : "")}
                onClick={() => { setSelId(n.id); setParaId(""); }}>
                <span className="card-kind">{sourceLabel(n)} · {kindLabel(n)}</span>
                <strong>{n.title}</strong>
                <small>{n.package_numbers.length ? `Пакети: ${n.package_numbers.join(", ")}` : `Стор. ${n.page_start}`}</small>
              </button>
            )) : <div className="no-results">За цим запитом норм не знайдено.</div>}
          </div>
        </section>

        <aside className="package-outline">
          <div className="outline-number">{sourceLabel(node)} · {kindLabel(node)}</div>
          <h2>{node.title}</h2>
          <p className="reader-context" style={{ margin: "0 0 12px" }}>{pages}</p>
          <div className="tag-row">{typeLabels(node).map((l) => <span key={l} className="package-tag">{l}</span>)}</div>
          {node.kind === "appendix" ? (
            (node.rows || []).map((r, i) => {
              const id = node.id + "-row-" + i;
              return (
                <div key={id} className={"paragraph-row" + (id === paraId ? " active" : "")}>
                  <button className="outline-link" onClick={() => setParaId(id)}>
                    <strong className="t-mono-code">{r.code}</strong> {r.title}
                    <span>{r.coeffs.join(" · ")}</span>
                  </button>
                  <button className={"copy-fragment" + (copiedId === id ? " copied" : "")} title="Копіювати рядок"
                    onClick={() => copyFrag(id)}>{copiedId === id ? "✓" : "⧉"}</button>
                </div>
              );
            })
          ) : (
            (node.items || []).map((item) => (
              <div key={item.id} className={"paragraph-row" + (item.id === paraId ? " active" : "")}>
                <button className="outline-link" onClick={() => setParaId(item.id)}>
                  <strong className="t-mono-code">{item.marker}</strong> {shortTitle(item)}
                  <span>стор. {item.page}</span>
                </button>
                <button className={"copy-fragment" + (copiedId === item.id ? " copied" : "")} title="Копіювати пункт"
                  onClick={() => copyFrag(item.id)}>{copiedId === item.id ? "✓" : "⧉"}</button>
              </div>
            ))
          )}
        </aside>

        <article className="package-reader">
          <h2>{node.title}</h2>
          <p className="reader-context">{sourceLabel(node)} · редакція від {D.document.edition_date} · постанова КМУ № {D.document.number}</p>
          <div className="norm-summary">
            <div><span>Тип норми</span><strong>{typeLabels(node).join(", ")}</strong></div>
            <div><span>Сторінки джерела</span><strong>{node.page_start === node.page_end ? node.page_start : `${node.page_start}-${node.page_end}`}</strong></div>
          </div>
          {node.kind === "appendix" ? (
            <div className="appendix-table-wrap">
              <table className="appendix-table">
                <thead><tr><th>Код</th><th>Назва медичної послуги</th><th>Ваговий к-т</th><th>Діти</th><th>Травми</th></tr></thead>
                <tbody>
                  {(node.rows || []).map((r, i) => (
                    <tr key={i} className={(node.id + "-row-" + i) === paraId ? "selected" : ""}>
                      <td><strong>{r.code}</strong></td>
                      <td><Highlight text={r.title} query={query} /></td>
                      {[0, 1, 2].map((c) => <td key={c} className="coef-cell">{r.coeffs[c] && r.coeffs[c] !== "—" ? <span className="coef-value">{r.coeffs[c]}</span> : <span className="coef-empty">—</span>}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="law-items">
              {(node.items || []).map((item) => (
                <div key={item.id} className={"law-item" + (item.id === paraId ? " selected" : "")}>
                  <Highlight text={item.text} query={query} />
                </div>
              ))}
            </div>
          )}
          <div className="actions">
            <a className="action primary">Відкрити PDF, стор. {node.page_start}</a>
            <a className="action">Відкрити офіційний HTM</a>
          </div>
          {node.related_packages.length > 0 && (
            <div className="related-explanations">
              <h3>Пов'язані пакети</h3>
              {node.related_packages.map((p) => (
                <a key={p.number} className="law-related-link" onClick={() => window.__setSection("packages")}>
                  <strong>Пакет {p.number}</strong>
                  <span>{p.title}</span>
                </a>
              ))}
            </div>
          )}
        </article>
      </main>
      <Footer note="Навігатор створено для доступу до пунктів постанови та Порядку реалізації Програми медичних гарантій 2026." />
    </>
  );
}

Object.assign(window, { ResolutionView });
