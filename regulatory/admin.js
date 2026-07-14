/* ============================================================
   Управління нормативною базою — адмін-панель v2
   Сховище: Supabase (таблиця regulatory_documents)
   Синхронізація: /api/save-data → data/regulatory_documents.json
   ============================================================ */

let sbClient = null;
let allDocuments = [];
let selectedDocId = null; // null = режим створення

const el = (id) => document.getElementById(id);

const escapeHtml = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[c]));

function showAlert(message, type = "success") {
  const box = el("alert-message");
  box.textContent = message;
  box.className = `alert-box ${type}`;
  box.scrollIntoView({ behavior: "smooth", block: "nearest" });
  if (type === "success") {
    setTimeout(() => { box.style.display = "none"; }, 5000);
  }
}

function fmtDate(iso) {
  if (!iso) return "—";
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : iso;
}

function typePillClass(type) {
  const t = (type || "").toLowerCase();
  if (t === "закон") return "t-zakon";
  if (t.includes("постанова")) return "t-postanova";
  if (t.includes("наказ моз")) return "t-nakaz-moz";
  if (t.includes("наказ нсзу")) return "t-nakaz-nszu";
  return "t-other";
}

function statusPill(status) {
  const s = (status || "").toLowerCase();
  if (s === "чинний") return `<span class="pill s-active">чинний</span>`;
  if (s === "проєкт") return `<span class="pill s-draft">проєкт</span>`;
  if (s.includes("втрат")) return `<span class="pill s-expired">втратив чинність</span>`;
  if (s.includes("змін")) return `<span class="pill s-amended">зі змінами</span>`;
  return `<span class="pill t-other">${escapeHtml(status || "—")}</span>`;
}

/* ---------------- Список документів ---------------- */

function renderList() {
  const q = el("admSearch").value.trim().toLowerCase();
  const typeF = el("admTypeFilter").value;

  let docs = [...allDocuments].sort((a, b) => (b.adoption_date || "").localeCompare(a.adoption_date || ""));
  if (typeF) docs = docs.filter((d) => d.document_type === typeF);
  if (q) {
    docs = docs.filter((d) =>
      [d.title, d.document_number, d.category, d.content].join(" ").toLowerCase().includes(q)
    );
  }

  el("admList").innerHTML = docs.length ? docs.map((d) => `
    <button class="adm-row ${d.id === selectedDocId ? "selected" : ""}" type="button" data-id="${d.id}">
      <span class="r-title">${escapeHtml(d.title)}</span>
      <span class="r-meta">
        <span class="pill ${typePillClass(d.document_type)}">${escapeHtml(d.document_type)}</span>
        ${statusPill(d.status)}
        <span>№ ${escapeHtml(d.document_number || "б/н")}</span>
        <span>від ${fmtDate(d.adoption_date)}</span>
        ${d.category ? `<span>· ${escapeHtml(d.category)}</span>` : ""}
      </span>
    </button>`).join("")
    : `<p style="color:var(--muted); font-size:13px; padding:20px; text-align:center;">Документів не знайдено.</p>`;

  el("admList").querySelectorAll(".adm-row").forEach((row) => {
    row.addEventListener("click", () => selectDocument(row.dataset.id));
  });
}

function renderStats() {
  const total = allDocuments.length;
  const active = allDocuments.filter((d) => d.status === "чинний").length;
  const drafts = allDocuments.filter((d) => d.status === "проєкт").length;
  el("admStats").innerHTML = `
    <div class="stat"><strong>${total}</strong><span>документів</span></div>
    <div class="stat"><strong>${active}</strong><span>чинних</span></div>
    <div class="stat"><strong>${drafts}</strong><span>проєктів</span></div>`;
}

function populateFilters() {
  const types = [...new Set(allDocuments.map((d) => d.document_type).filter(Boolean))].sort();
  const sel = el("admTypeFilter");
  const cur = sel.value;
  sel.innerHTML = `<option value="">Усі види</option>` + types.map((t) => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join("");
  sel.value = cur;

  const cats = [...new Set(allDocuments.map((d) => d.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, "uk"));
  el("categories-list").innerHTML = cats.map((c) => `<option value="${escapeHtml(c)}">`).join("");
}

/* ---------------- Форма ---------------- */

function selectDocument(id) {
  const doc = allDocuments.find((d) => d.id === id);
  if (!doc) return;
  selectedDocId = id;

  el("formMode").textContent = "📝 Редагування документа";
  el("doc-title").value = doc.title || "";
  el("doc-type").value = doc.document_type || "Закон";
  el("doc-status").value = doc.status || "чинний";
  el("doc-number").value = doc.document_number || "";
  el("doc-date").value = doc.adoption_date || "";
  el("doc-category").value = doc.category || "";
  el("doc-url").value = doc.document_url || "";
  el("doc-file-url").value = doc.file_url || "";
  el("doc-content").value = doc.content || "";
  el("btn-delete").style.display = "";

  const meta = el("docMeta");
  meta.style.display = "";
  meta.textContent = `Останнє оновлення: ${fmtDate(doc.updated_at)}${doc.updated_by_name ? " · " + doc.updated_by_name : ""}`;

  renderList();
  el("doc-title").scrollIntoView({ behavior: "smooth", block: "center" });
}

function resetForm() {
  selectedDocId = null;
  el("formMode").textContent = "➕ Новий документ";
  el("document-form").reset();
  el("doc-type").value = "Закон";
  el("doc-status").value = "чинний";
  el("btn-delete").style.display = "none";
  el("docMeta").style.display = "none";
  renderList();
}

/* ---------------- Supabase CRUD ---------------- */

async function getUpdaterName(fallback = "Співробітник") {
  try {
    const { data: { session } } = await sbClient.auth.getSession();
    if (session?.user) {
      return session.user.user_metadata?.full_name || session.user.user_metadata?.name || session.user.email.split("@")[0];
    }
  } catch (e) { /* ignore */ }
  return fallback;
}

async function fetchAllDocuments() {
  if (!sbClient) return;
  try {
    const { data, error } = await sbClient.from("regulatory_documents").select("*");
    if (error) throw error;
    allDocuments = data || [];
    populateFilters();
    renderStats();
    renderList();
  } catch (err) {
    console.error("Error fetching documents:", err);
    showAlert("Помилка при завантаженні списку документів: " + err.message, "error");
  }
}

async function handleFormSubmit(e) {
  e.preventDefault();
  if (!sbClient) {
    showAlert("Помилка: не вдалося ініціалізувати клієнт бази даних.", "error");
    return;
  }

  const btnSave = el("btn-save");
  btnSave.disabled = true;
  btnSave.textContent = "Збереження…";

  const payload = {
    title: el("doc-title").value.trim(),
    document_type: el("doc-type").value,
    status: el("doc-status").value,
    document_number: el("doc-number").value.trim() || null,
    adoption_date: el("doc-date").value || null,
    category: el("doc-category").value.trim() || null,
    document_url: el("doc-url").value.trim() || null,
    file_url: el("doc-file-url").value.trim() || null,
    content: el("doc-content").value.trim() || null,
    updated_at: new Date().toISOString(),
    updated_by_name: await getUpdaterName()
  };

  try {
    if (!selectedDocId) {
      const { error } = await sbClient.from("regulatory_documents").insert([payload]);
      if (error) throw error;
      showAlert("Документ успішно додано!", "success");
      resetForm();
    } else {
      const { error } = await sbClient.from("regulatory_documents").update(payload).eq("id", selectedDocId);
      if (error) throw error;
      showAlert("Документ успішно оновлено!", "success");
    }
    await fetchAllDocuments();
  } catch (err) {
    console.error("Save error:", err);
    showAlert("Помилка збереження: " + err.message, "error");
  } finally {
    btnSave.disabled = false;
    btnSave.textContent = "💾 Зберегти";
  }
}

async function handleDelete() {
  if (!selectedDocId) return;
  const doc = allDocuments.find((d) => d.id === selectedDocId);
  if (!doc) return;

  const ok = confirm(`Видалити документ назавжди?\n\n${doc.document_type} № ${doc.document_number || "б/н"}\n«${doc.title}»\n\nЦю дію не можна скасувати.`);
  if (!ok) return;

  const btn = el("btn-delete");
  btn.disabled = true;
  btn.textContent = "Видалення…";
  try {
    const { error } = await sbClient.from("regulatory_documents").delete().eq("id", selectedDocId);
    if (error) throw error;
    showAlert("Документ видалено з бази.", "success");
    resetForm();
    await fetchAllDocuments();
  } catch (err) {
    console.error("Delete error:", err);
    showAlert("Помилка видалення: " + err.message, "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "🗑 Видалити документ";
  }
}

/* ---------------- Синхронізація ---------------- */

async function handleLocalSync() {
  const btnSync = el("btn-sync-local");
  btnSync.disabled = true;
  btnSync.textContent = "Синхронізація…";

  try {
    const { data: dbData, error } = await sbClient.from("regulatory_documents").select("*");
    if (error) throw error;
    if (!dbData || dbData.length === 0) {
      throw new Error("Немає записів у Supabase для синхронізації!");
    }

    const sortedList = (set, desc = false) => [...set].sort((a, b) => desc ? b.localeCompare(a) : a.localeCompare(b, "uk"));
    const documents = dbData.map((doc) => ({ ...doc, year: doc.adoption_date ? doc.adoption_date.split("-")[0] : "" }));

    const localPayload = {
      total_documents: documents.length,
      categories: sortedList(new Set(documents.map((d) => d.category).filter(Boolean))),
      types: sortedList(new Set(documents.map((d) => d.document_type))),
      statuses: sortedList(new Set(documents.map((d) => d.status))),
      years: sortedList(new Set(documents.map((d) => d.year).filter(Boolean)), true),
      documents: dbData
    };

    const response = await fetch("/api/save-data", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: "regulatory_documents.json", data: localPayload })
    });

    if (!response.ok) {
      throw new Error(`Помилка сервера: ${await response.text()}`);
    }
    const resData = await response.json();
    if (resData.status === "success") {
      showAlert(`Локальну копію бази (${documents.length} документів) успішно оновлено!`, "success");
    } else {
      throw new Error("Невідома відповідь сервера.");
    }
  } catch (err) {
    console.error("Local sync error:", err);
    showAlert("Помилка локальної синхронізації: " + err.message, "error");
  } finally {
    btnSync.disabled = false;
    btnSync.textContent = "⚙️ Перезаписати локальний JSON-файл";
  }
}

async function handleSeedSupabase() {
  const btnSeed = el("btn-seed-supabase");
  btnSeed.disabled = true;
  btnSeed.textContent = "Завантаження…";

  try {
    const response = await fetch("data/regulatory_documents.json");
    if (!response.ok) throw new Error(`Не вдалося завантажити локальний файл: ${response.statusText}`);
    const localData = await response.json();
    const docs = localData.documents || [];
    if (!docs.length) throw new Error("У локальному JSON-файлі немає документів для завантаження.");

    const { count, error: countErr } = await sbClient
      .from("regulatory_documents")
      .select("*", { count: "exact", head: true });
    if (countErr) throw countErr;
    if (count && count > 0) {
      if (!confirm(`У Supabase вже є ${count} документів. Додати початкові документи (можливі дублікати)?`)) {
        return;
      }
    }

    const updaterName = await getUpdaterName("Адміністратор");
    const payload = docs.map((doc) => ({
      title: doc.title,
      document_type: doc.document_type,
      document_number: doc.document_number,
      adoption_date: doc.adoption_date,
      status: doc.status,
      category: doc.category,
      document_url: doc.document_url,
      file_url: doc.file_url,
      content: doc.content,
      updated_by_name: updaterName
    }));

    const { error: insertErr } = await sbClient.from("regulatory_documents").insert(payload);
    if (insertErr) throw insertErr;

    showAlert(`Успішно завантажено ${payload.length} документів у Supabase!`, "success");
    await fetchAllDocuments();
  } catch (err) {
    console.error("Seeding error:", err);
    showAlert("Помилка завантаження початкових даних: " + err.message, "error");
  } finally {
    btnSeed.disabled = false;
    btnSeed.textContent = "📥 Завантажити початкові дані у Supabase";
  }
}

/* ---------------- Ініціалізація ---------------- */

async function init() {
  try {
    const { createClient } = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm");
    const SUPABASE_URL = "https://qdqtkvyvhtjgxpxnvblk.supabase.co";
    const SUPABASE_KEY = "sb_publishable_YXDm02hDBzLQmsUuVnZ_Og_IxQ60VCz";
    sbClient = createClient(SUPABASE_URL, SUPABASE_KEY);

    await fetchAllDocuments();

    el("admSearch").addEventListener("input", renderList);
    el("admTypeFilter").addEventListener("change", renderList);
    el("btnNew").addEventListener("click", resetForm);
    el("btn-cancel").addEventListener("click", resetForm);
    el("btn-delete").addEventListener("click", handleDelete);
    el("document-form").addEventListener("submit", handleFormSubmit);
    el("btn-sync-local").addEventListener("click", handleLocalSync);
    el("btn-seed-supabase").addEventListener("click", handleSeedSupabase);
  } catch (err) {
    console.error("Initialization error:", err);
    showAlert("Не вдалося ініціалізувати сторінку: " + err.message, "error");
  }
}

document.addEventListener("DOMContentLoaded", init);
