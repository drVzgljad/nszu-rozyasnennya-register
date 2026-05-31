/* App shell: section state + routing between the kit's views. */

const SECTION_STUBS = {
  resolution: {
    overline: "Програма медичних гарантій 2026",
    title: "Постанова і Порядок № 1808",
    lead: "Окремо проіндексовані пункти постанови та затвердженого нею Порядку: тарифи, коефіцієнти, правила оплати, строки і зв'язки з пакетами ПМГ 2026.",
    note: "У повному застосунку цей розділ відкриває проіндексовані пункти постанови, таблиці коефіцієнтів і формули тарифів. У цьому UI-кіті він поданий як заглушка.",
  },
  search: {
    overline: "Машина пошуку",
    title: "Збірка вимог у єдиний текст",
    lead: "Зберіть знайдені вимоги пакетів в одне поле та скопіюйте готовий текст для відповіді або службової записки.",
    note: "У повному застосунку цей розділ збирає відмічені вимоги у редаговане текстове поле для копіювання. У цьому UI-кіті він поданий як заглушка.",
  },
  algorithms: {
    overline: "Наказ НСЗУ № 377",
    title: "Алгоритми та правила",
    lead: "Пошук за кодами НК 025, назвами діагнозів, амбулаторно-асоційованими станами та правилами наказу № 377.",
    note: "У повному застосунку цей розділ шукає за кодами НК 025 і правилами наказу № 377, із джерелом, сторінкою PDF і текстом для копіювання. У цьому UI-кіті він поданий як заглушка.",
  },
};

function StubView({ id, locked }) {
  const s = SECTION_STUBS[id];
  return (
    <>
      <Hero overline={s.overline} title={s.title} lead={s.lead} active={id} onSection={window.__setSection} />
      <main className="layout" style={{ gridTemplateColumns: "1fr" }}>
        {locked ? (
          <AccessDenied required="registered" />
        ) : (
          <aside className="detail empty" style={{ minHeight: 280 }}>
            <div className="empty-state" style={{ maxWidth: 440 }}>
              <div className="empty-icon">i</div>
              <h2>{s.title}</h2>
              <p>{s.note}</p>
            </div>
          </aside>
        )}
      </main>
      <Footer />
    </>
  );
}

// Sections that require sign-in (mirrors the register's role gating)
const SECTION_ROLE = { search: "registered" };

function App() {
  const [section, setSection] = React.useState("explanations");
  const [user, authActions] = useMockAuth();
  const [authModal, setAuthModal] = React.useState({ open: false, tab: "login" });

  window.__setSection = setSection;
  window.__auth = {
    user,
    open: (tab = "login") => setAuthModal({ open: true, tab }),
    signOut: authActions.signOut,
  };

  const required = SECTION_ROLE[section];
  const locked = required && !hasAccess(user && user.role, required);

  let view;
  if (section === "explanations") view = <ExplanationsView />;
  else if (section === "packages") view = <PackagesView />;
  else if (section === "resolution") view = <ResolutionView />;
  else if (section === "algorithms") view = <AlgorithmsView />;
  else view = <StubView id={section} locked={locked} />;

  return (
    <>
      {view}
      <AuthModal state={authModal} setState={setAuthModal} actions={authActions} />
    </>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
