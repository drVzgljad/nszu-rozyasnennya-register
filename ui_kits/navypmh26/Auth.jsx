/* Авторизація (рівневий доступ) — recreation of the register's Supabase auth.
   Roles: guest | registered | full. Mocked client-side (no real backend);
   login signs you in, register shows the confirmation-email message. */

function useMockAuth() {
  const [user, setUser] = React.useState(() => {
    try { return JSON.parse(localStorage.getItem("navypmh-user")) || null; } catch (e) { return null; }
  });
  React.useEffect(() => {
    try {
      if (user) localStorage.setItem("navypmh-user", JSON.stringify(user));
      else localStorage.removeItem("navypmh-user");
    } catch (e) {}
  }, [user]);
  const signIn = (email, role = "full") => setUser({ email, role });
  const signOut = () => setUser(null);
  return [user, { signIn, signOut }];
}

function hasAccess(role, required) {
  if (!required) return true;
  if (required === "registered") return role === "registered" || role === "full";
  if (required === "full") return role === "full";
  return false;
}

// Button that lives inside the section nav
function AuthNavButton() {
  const a = window.__auth || {};
  const user = a.user;
  return (
    <button
      className={"auth-nav-btn" + (user ? " is-signed-in" : "")}
      title={user ? "Натисніть для виходу" : ""}
      onClick={() => { user ? a.signOut() : a.open("login"); }}
    >
      {user ? user.email.split("@")[0] : "Увійти"}
    </button>
  );
}

function AuthModal({ state, setState, actions }) {
  const [regMsg, setRegMsg] = React.useState(null); // {ok, text}
  const [loginErr, setLoginErr] = React.useState("");
  if (!state.open) return null;

  const close = () => { setState({ open: false, tab: state.tab }); setRegMsg(null); setLoginErr(""); };
  const setTab = (tab) => { setState({ open: true, tab }); setRegMsg(null); setLoginErr(""); };

  const onLogin = (e) => {
    e.preventDefault();
    const email = e.target.elements["login-email"].value.trim();
    const pass = e.target.elements["login-pass"].value;
    if (!email || pass.length < 1) { setLoginErr("Введіть email і пароль"); return; }
    actions.signIn(email, "full");
    close();
  };
  const onRegister = (e) => {
    e.preventDefault();
    e.target.reset();
    setRegMsg({ ok: true, text: "Лист підтвердження надіслано на вашу пошту." });
  };

  return (
    <div className="auth-overlay" role="dialog" aria-modal="true" aria-label="Вхід"
      onClick={(e) => { if (e.target.classList.contains("auth-overlay")) close(); }}>
      <div className="auth-modal">
        <button className="auth-modal-close" aria-label="Закрити" onClick={close}>&times;</button>
        <div className="auth-brand">
          <img className="auth-brand-shield" src="assets/nszu-shield.svg" alt="" aria-hidden="true" />
          <span>Портал експертної інформації</span>
        </div>
        <div className="auth-tabs" role="tablist">
          <button className={"auth-tab" + (state.tab === "login" ? " active" : "")} role="tab"
            onClick={() => setTab("login")}>Увійти</button>
          <button className={"auth-tab" + (state.tab === "register" ? " active" : "")} role="tab"
            onClick={() => setTab("register")}>Реєстрація</button>
        </div>

        {state.tab === "login" ? (
          <form onSubmit={onLogin} noValidate>
            <div className="auth-field">
              <label htmlFor="login-email">Email</label>
              <input id="login-email" name="login-email" type="email" autoComplete="email" required />
            </div>
            <div className="auth-field">
              <label htmlFor="login-pass">Пароль</label>
              <input id="login-pass" name="login-pass" type="password" autoComplete="current-password" required />
            </div>
            <div className="auth-error">{loginErr}</div>
            <button type="submit" className="auth-submit">Увійти</button>
          </form>
        ) : (
          <form onSubmit={onRegister} noValidate>
            <div className="auth-field">
              <label htmlFor="reg-email">Email</label>
              <input id="reg-email" type="email" autoComplete="email" required />
            </div>
            <div className="auth-field">
              <label htmlFor="reg-pass">Пароль <span className="auth-hint">(мін. 6 символів)</span></label>
              <input id="reg-pass" type="password" autoComplete="new-password" minLength="6" required />
            </div>
            <div className="auth-field">
              <label htmlFor="reg-name">Ім'я та прізвище</label>
              <input id="reg-name" type="text" autoComplete="name" />
            </div>
            <div className="auth-field">
              <label htmlFor="reg-org">Заклад / організація</label>
              <input id="reg-org" type="text" />
            </div>
            <div className="auth-error" style={regMsg && regMsg.ok ? { color: "var(--teal-text)" } : null}>
              {regMsg ? regMsg.text : ""}
            </div>
            <button type="submit" className="auth-submit">Зареєструватись</button>
          </form>
        )}
      </div>
    </div>
  );
}

// Full-page gate shown when a section requires a role the guest lacks
function AccessDenied({ required }) {
  return (
    <div className="access-denied-overlay-inline">
      <div className="access-denied-box">
        <div className="empty-icon" style={{ margin: "0 auto 16px" }}>!</div>
        <h2>Доступ обмежено</h2>
        <p>{required === "full"
          ? "Цей розділ доступний лише для користувачів з повним доступом."
          : "Цей розділ доступний лише для зареєстрованих користувачів."}</p>
        <button className="auth-submit" onClick={() => window.__auth && window.__auth.open("login")}>
          Увійти / Зареєструватись
        </button>
      </div>
    </div>
  );
}

Object.assign(window, { useMockAuth, hasAccess, AuthNavButton, AuthModal, AccessDenied });
