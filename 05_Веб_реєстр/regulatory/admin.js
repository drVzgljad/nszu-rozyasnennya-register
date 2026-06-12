let sbClient = null;
let allDocuments = [];
let selectedDocId = null;

const el = (id) => document.getElementById(id);

// Alert display helper
function showAlert(message, type = 'success') {
  const alertBox = el('alert-message');
  alertBox.textContent = message;
  alertBox.className = `alert-box ${type}`;
  alertBox.scrollIntoView({ behavior: 'smooth', block: 'end' });
  
  // Auto-hide success alert after 5 seconds
  if (type === 'success') {
    setTimeout(() => {
      alertBox.style.display = 'none';
    }, 5000);
  }
}

// Populate Category datalist for suggestions
function populateCategorySuggestions() {
  const datalist = el('categories-list');
  const categories = new Set(allDocuments.map(doc => doc.category).filter(Boolean));
  datalist.innerHTML = "";
  categories.forEach(cat => {
    const opt = document.createElement('option');
    opt.value = cat;
    datalist.appendChild(opt);
  });
}

// Load documents list for Editing mode dropdown
function populateDocumentSelector() {
  const select = el('edit-document-select');
  select.innerHTML = '<option value="">-- Оберіть документ зі списку --</option>';
  
  // Sort documents by title
  const sortedDocs = [...allDocuments].sort((a, b) => a.title.localeCompare(b.title, 'uk'));
  
  sortedDocs.forEach(doc => {
    const opt = document.createElement('option');
    opt.value = doc.id;
    const dateStr = doc.adoption_date ? ` (${doc.adoption_date.split('-')[0]})` : '';
    const numStr = doc.document_number ? ` № ${doc.document_number}` : '';
    opt.textContent = `${doc.document_type}${numStr}${dateStr}: ${doc.title.substring(0, 70)}...`;
    select.appendChild(opt);
  });
}

// Fill form fields with selected document details
function fillFormWithSelectedDocument(id) {
  const doc = allDocuments.find(d => d.id === id);
  if (!doc) {
    clearForm();
    return;
  }
  
  el('doc-title').value = doc.title || '';
  el('doc-type').value = doc.document_type || 'Закон';
  el('doc-status').value = doc.status || 'чинний';
  el('doc-number').value = doc.document_number || '';
  el('doc-date').value = doc.adoption_date || '';
  el('doc-category').value = doc.category || '';
  el('doc-url').value = doc.document_url || '';
  el('doc-file-url').value = doc.file_url || '';
  el('doc-content').value = doc.content || '';
  
  selectedDocId = doc.id;
}

// Clear all form fields
function clearForm() {
  el('doc-title').value = '';
  el('doc-type').value = 'Закон';
  el('doc-status').value = 'чинний';
  el('doc-number').value = '';
  el('doc-date').value = '';
  el('doc-category').value = '';
  el('doc-url').value = '';
  el('doc-file-url').value = '';
  el('doc-content').value = '';
  selectedDocId = null;
}

// Fetch all documents from Supabase
async function fetchAllDocuments() {
  if (!sbClient) return;
  try {
    const { data, error } = await sbClient.from('regulatory_documents').select('*');
    if (error) throw error;
    allDocuments = data || [];
    populateCategorySuggestions();
    if (el('editor-mode').value === 'edit') {
      populateDocumentSelector();
    }
  } catch (err) {
    console.error("Error fetching documents:", err);
    showAlert("Помилка при завантаженні списку документів: " + err.message, "error");
  }
}

// Setup Mode Changes
function handleModeChange() {
  const mode = el('editor-mode').value;
  const selectorGroup = el('document-selector-group');
  
  clearForm();
  
  if (mode === 'edit') {
    selectorGroup.style.display = 'block';
    populateDocumentSelector();
  } else {
    selectorGroup.style.display = 'none';
  }
}

// Handle Form Submission
async function handleFormSubmit(e) {
  e.preventDefault();
  
  if (!sbClient) {
    showAlert("Помилка: Не вдалося ініціалізувати клієнт бази даних.", "error");
    return;
  }
  
  // Get active session user info
  let updaterName = "Співробітник";
  try {
    const { data: { session } } = await sbClient.auth.getSession();
    if (session && session.user) {
      updaterName = session.user.user_metadata?.full_name || session.user.user_metadata?.name || session.user.email.split('@')[0];
    }
  } catch(e) {}
  
  const mode = el('editor-mode').value;
  const btnSave = el('btn-save');
  btnSave.disabled = true;
  btnSave.textContent = "Збереження...";
  
  const payload = {
    title: el('doc-title').value.trim(),
    document_type: el('doc-type').value,
    status: el('doc-status').value,
    document_number: el('doc-number').value.trim() || null,
    adoption_date: el('doc-date').value || null,
    category: el('doc-category').value.trim() || null,
    document_url: el('doc-url').value.trim() || null,
    file_url: el('doc-file-url').value.trim() || null,
    content: el('doc-content').value.trim() || null,
    updated_at: new Date().toISOString(),
    updated_by_name: updaterName
  };
  
  try {
    if (mode === 'create') {
      // Insert new
      const { error } = await sbClient.from('regulatory_documents').insert([payload]);
      if (error) throw error;
      showAlert("Документ успішно додано у Supabase!", "success");
      clearForm();
    } else {
      // Update existing
      if (!selectedDocId) {
        showAlert("Будь ласка, оберіть документ для редагування!", "error");
        btnSave.disabled = false;
        btnSave.textContent = "💾 Зберегти зміни";
        return;
      }
      const { error } = await sbClient.from('regulatory_documents').update(payload).eq('id', selectedDocId);
      if (error) throw error;
      showAlert("Документ успішно оновлено у Supabase!", "success");
    }
    
    // Refresh local memory and controls
    await fetchAllDocuments();
  } catch (err) {
    console.error("Save error:", err);
    showAlert("Помилка збереження: " + err.message, "error");
  } finally {
    btnSave.disabled = false;
    btnSave.textContent = "💾 Зберегти зміни";
  }
}

// Local Sync Process (writes to data/regulatory_documents.json via local node server API)
async function handleLocalSync() {
  const btnSync = el('btn-sync-local');
  btnSync.disabled = true;
  btnSync.textContent = "Синхронізація...";
  
  try {
    // 1. Fetch freshest data from Supabase
    const { data: dbData, error } = await sbClient.from('regulatory_documents').select('*');
    if (error) throw error;
    
    if (!dbData || dbData.length === 0) {
      throw new Error("Немає записів у Supabase для синхронізації!");
    }
    
    // 2. Build local JSON structure
    const sortedList = (set, desc = false) => [...set].sort((a,b) => desc ? b.localeCompare(a) : a.localeCompare(b, "uk"));
    const documents = dbData.map(doc => {
      const year = doc.adoption_date ? doc.adoption_date.split("-")[0] : "";
      return { ...doc, year };
    });
    
    const categories = new Set(documents.map(d => d.category).filter(Boolean));
    const types = new Set(documents.map(d => d.document_type));
    const statuses = new Set(documents.map(d => d.status));
    const years = new Set(documents.map(d => d.year).filter(Boolean));
    
    const localPayload = {
      total_documents: documents.length,
      categories: sortedList(categories),
      types: sortedList(types),
      statuses: sortedList(statuses),
      years: sortedList(years, true),
      documents: dbData // Keep raw dbData (without calculated year, since app.js calculates it)
    };
    
    // 3. Post to local API
    const response = await fetch("/api/save-data", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        filename: "regulatory_documents.json",
        data: localPayload
      })
    });
    
    if (!response.ok) {
      const errMsg = await response.text();
      throw new Error(`Помилка сервера: ${errMsg}`);
    }
    
    const resData = await response.json();
    if (resData.status === "success") {
      showAlert(`Локальну копію нормативної бази (всього: ${documents.length} документів) успішно оновлено!`, "success");
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

// Seed Supabase with local JSON documents
async function handleSeedSupabase() {
  const btnSeed = el('btn-seed-supabase');
  btnSeed.disabled = true;
  btnSeed.textContent = "Завантаження...";

  try {
    // 1. Fetch from local JSON file
    const response = await fetch("data/regulatory_documents.json");
    if (!response.ok) {
      throw new Error(`Не вдалося завантажити локальний файл: ${response.statusText}`);
    }
    const localData = await response.json();
    const docs = localData.documents || [];

    if (docs.length === 0) {
      throw new Error("У локальному JSON-файлі немає документів для завантаження.");
    }

    // 2. Check if Supabase already has documents
    const { count, error: countErr } = await sbClient
      .from('regulatory_documents')
      .select('*', { count: 'exact', head: true });
    
    if (countErr) throw countErr;
    if (count && count > 0) {
      if (!confirm(`У Supabase вже є ${count} документів. Ви дійсно бажаєте додати початкові документи (це може створити дублікати)?`)) {
        btnSeed.disabled = false;
        btnSeed.textContent = "📥 Завантажити початкові дані у Supabase";
        return;
      }
    }

    // 3. Prepare payload
    let updaterName = "Адміністратор";
    try {
      const { data: { session } } = await sbClient.auth.getSession();
      if (session && session.user) {
        updaterName = session.user.user_metadata?.full_name || session.user.user_metadata?.name || session.user.email.split('@')[0];
      }
    } catch(e) {}

    const payload = docs.map(doc => ({
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

    // 4. Insert into Supabase
    const { error: insertErr } = await sbClient.from('regulatory_documents').insert(payload);
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

// Check auth role and init
async function init() {
  try {
    const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
    const SUPABASE_URL = 'https://qdqtkvyvhtjgxpxnvblk.supabase.co';
    const SUPABASE_KEY = 'sb_publishable_YXDm02hDBzLQmsUuVnZ_Og_IxQ60VCz';
    sbClient = createClient(SUPABASE_URL, SUPABASE_KEY);
    
    // Fetch initial documents list
    await fetchAllDocuments();
    
    // Event listeners
    el('editor-mode').addEventListener('change', handleModeChange);
    el('edit-document-select').addEventListener('change', (e) => {
      fillFormWithSelectedDocument(e.target.value);
    });
    el('document-form').addEventListener('submit', handleFormSubmit);
    el('btn-sync-local').addEventListener('click', handleLocalSync);
    
    const btnSeedSupabase = el('btn-seed-supabase');
    if (btnSeedSupabase) {
      btnSeedSupabase.addEventListener('click', handleSeedSupabase);
    }
    
  } catch (err) {
    console.error("Initialization error:", err);
    showAlert("Не вдалося ініціалізувати сторінку: " + err.message, "error");
  }
}

// Run on load
document.addEventListener("DOMContentLoaded", init);
