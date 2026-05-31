/* Роз'яснення — search + result list + detail reader. */

function DocumentCard({ doc, active, query, onSelect }) {
  return (
    <button className={"document-card" + (active ? " active" : "")} onClick={() => onSelect(doc.id)}>
      <span className="card-tags">
        <Tag>{doc.date || doc.year}</Tag>
        <Tag file>{doc.format}</Tag>
      </span>
      <strong><Highlight text={doc.title} query={query} /></strong>
      <span className="card-subtitle">
        {doc.direction.replaceAll("-", " ")} | {doc.package.replaceAll("-", " ")}
      </span>
    </button>
  );
}

function DetailPanel({ doc, onSelect }) {
  if (!doc) {
    return (
      <aside className="detail empty">
        <div className="empty-state">
          <div className="empty-icon">i</div>
          <h2>Оберіть документ</h2>
          <p>Тут з'явиться коротка інформація, кнопки відкриття та пов'язані матеріали.</p>
        </div>
      </aside>
    );
  }
  const related = (doc.related || [])
    .map((id) => window.KIT_DOCUMENTS.find((d) => d.id === id))
    .filter(Boolean);
  return (
    <aside className="detail">
      <div className="detail-header">
        <Label>{doc.direction.replaceAll("-", " ")}</Label>
        <Label>{doc.package.replaceAll("-", " ")}</Label>
        {doc.ocr && <Label ocr>OCR зі скану</Label>}
        <h2>{doc.title}</h2>
      </div>
      <div className="meta">
        <div className="meta-item"><span>Дата документа</span><strong>{doc.date || "Не визначено"}</strong></div>
        <div className="meta-item"><span>Номер документа</span><strong>{doc.number ? "№ " + doc.number : "Не визначено"}</strong></div>
        <div className="meta-item"><span>Рік документа</span><strong>{doc.year}</strong></div>
        <div className="meta-item"><span>Формат</span><strong>{doc.format}</strong></div>
        <div className="meta-item"><span>Тема</span><strong>{doc.topic}</strong></div>
        <div className="meta-item"><span>Запис в архіві</span><strong>№ {doc.record}</strong></div>
      </div>
      <div className="actions">
        <a className="action primary">Відкрити файл</a>
        <a className="action">Джерело НСЗУ</a>
      </div>
      <div className="section-title">Назва у бібліотеці</div>
      <div className="excerpt">{doc.name}</div>
      <div className="section-title">Оригінальна технічна назва</div>
      <div className="excerpt">{doc.original}</div>
      <div className="section-title">Фрагмент змісту</div>
      <div className="excerpt">{doc.excerpt}</div>
      <div className="section-title">Пов'язані документи</div>
      <div className="related">
        {related.length ? related.map((r) => (
          <button key={r.id} onClick={() => onSelect(r.id)}>
            <strong>{r.title}</strong>
            <span>той самий напрям · пов'язане роз'яснення</span>
          </button>
        )) : <p>Пов'язані документи не визначено.</p>}
      </div>
    </aside>
  );
}

function ExplanationsView() {
  const [query, setQuery] = React.useState("");
  const [direction, setDirection] = React.useState("");
  const [format, setFormat] = React.useState("");
  const [selected, setSelected] = React.useState(window.KIT_DOCUMENTS[0].id);

  const visible = window.KIT_DOCUMENTS.filter((d) => {
    if (query && !(d.title + " " + d.excerpt + " " + d.direction).toLowerCase().includes(query.toLowerCase())) return false;
    if (direction && d.direction !== direction) return false;
    if (format && d.format !== format) return false;
    return true;
  });

  React.useEffect(() => {
    if (visible.length && !visible.some((d) => d.id === selected)) setSelected(visible[0].id);
  }, [query, direction, format]);

  const doc = window.KIT_DOCUMENTS.find((d) => d.id === selected);
  const reset = () => { setQuery(""); setDirection(""); setFormat(""); };

  return (
    <>
      <Hero
        overline="Локальна бібліотека документів"
        title="Роз'яснення НСЗУ"
        lead="Знайдіть документ за темою, пакетом, номером, датою або словом з тексту. Перегляньте зміст, джерело і пов'язані матеріали в одному місці."
        active="explanations"
        onSection={window.__setSection}
      />
      <main className="layout">
        <section aria-label="Пошук документів">
          <div className="search-panel">
            <label className="search">
              <span>Пошук</span>
              <input type="search" value={query} placeholder="Наприклад: паліативна допомога, ЕМЗ, інсульт..."
                onChange={(e) => setQuery(e.target.value)} autoComplete="off" />
            </label>
            <div className="filters">
              <label>Напрям
                <select value={direction} onChange={(e) => setDirection(e.target.value)}>
                  {window.KIT_FILTERS.direction.map((o, i) => <option key={i} value={i === 0 ? "" : o}>{o}</option>)}
                </select>
              </label>
              <label>Формат
                <select value={format} onChange={(e) => setFormat(e.target.value)}>
                  {window.KIT_FILTERS.format.map((o, i) => <option key={i} value={i === 0 ? "" : o}>{o}</option>)}
                </select>
              </label>
            </div>
            <div className="results-summary">
              <span>{visible.length ? `Знайдено: ${visible.length} з 171` : "Нічого не знайдено"}</span>
              <button className="reset" onClick={reset}>Очистити фільтри</button>
            </div>
          </div>
          <div className="cards">
            {visible.length ? visible.map((d) => (
              <DocumentCard key={d.id} doc={d} active={d.id === selected} query={query} onSelect={setSelected} />
            )) : (
              <div className="no-results">За цими умовами документів не знайдено. Спробуйте коротше слово або очистіть фільтри.</div>
            )}
          </div>
        </section>
        <DetailPanel doc={visible.length ? doc : null} onSelect={setSelected} />
      </main>
      <Footer />
    </>
  );
}

Object.assign(window, { DocumentCard, DetailPanel, ExplanationsView });
