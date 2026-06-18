let embeddingIndex = null;

const el = (id) => document.getElementById(id);

// Modals and settings
const modal = el("settingsModal");
const openBtn = el("openSettingsBtn");
const closeBtn = el("closeSettingsBtn");
const saveBtn = el("saveSettingsBtn");
const keyInput = el("geminiApiKeyInput");

openBtn.onclick = () => {
  keyInput.value = localStorage.getItem("gemini_api_key") || "";
  modal.style.display = "flex";
};

closeBtn.onclick = () => {
  modal.style.display = "none";
};

saveBtn.onclick = () => {
  const key = keyInput.value.trim();
  if (key) {
    localStorage.setItem("gemini_api_key", key);
  } else {
    localStorage.removeItem("gemini_api_key");
  }
  modal.style.display = "none";
  checkApiKeyStatus();
};

window.onclick = (event) => {
  if (event.target === modal) {
    modal.style.display = "none";
  }
};

function checkApiKeyStatus() {
  const key = localStorage.getItem("gemini_api_key");
  const isLocal = location.hostname === "127.0.0.1" || location.hostname === "localhost";
  
  if (key) {
    openBtn.innerHTML = "⚙️ API Ключ збережено";
    openBtn.style.background = "rgba(16, 185, 129, 0.2)";
  } else if (isLocal) {
    openBtn.innerHTML = "⚙️ Налаштування API (Локальний сервер)";
    openBtn.style.background = "rgba(255, 255, 255, 0.2)";
  } else {
    openBtn.innerHTML = "⚠️ Потрібен API Ключ";
    openBtn.style.background = "rgba(239, 68, 68, 0.2)";
  }
}

// Dot product (since embeddings are L2 normalized, dot product equals cosine similarity)
function dotProduct(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
  let dot = 0;
  for (let i = 0; i < vecA.length; i++) {
    dot += vecA[i] * vecB[i];
  }
  return dot;
}

async function getQueryVector(query) {
  const isLocal = location.hostname === "127.0.0.1" || location.hostname === "localhost";
  
  // 1. Try local server endpoint first if running locally
  if (isLocal) {
    try {
      const response = await fetch("/api/embed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: query })
      });
      if (response.ok) {
        const result = await response.json();
        if (result.status === "success" && result.vector) {
          return result.vector;
        }
      }
    } catch (e) {
      console.warn("Local embed API failed, falling back to direct API...", e);
    }
  }
  
  // 2. Try browser direct API call using localStorage API key
  const apiKey = localStorage.getItem("gemini_api_key");
  if (!apiKey) {
    throw new Error("API key not configured. Please click 'Налаштування API' and enter your Gemini API key.");
  }
  
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${apiKey}`;
  const payload = {
    model: "models/gemini-embedding-001",
    content: {
      parts: [{ text: query }]
    }
  };


  
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  
  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(errData.error?.message || `API error: ${response.status}`);
  }
  
  const resData = await response.json();
  return resData.embedding.values;
}

async function handleSearch() {
  const query = el("aiSearch").value.trim();
  if (!query) {
    alert("Будь ласка, введіть пошуковий запит!");
    return;
  }
  
  if (!embeddingIndex) {
    alert("Дані реєстру ще завантажуються. Зачекайте секунду...");
    return;
  }
  
  // Show spinner
  el("searchSpinner").style.display = "block";
  el("searchBtn").disabled = true;
  el("aiResults").innerHTML = `
    <div style="text-align: center; padding: 40px; color: #64748b;">
      <div class="spinner" style="display:inline-block; position:static; margin-bottom:12px; transform:none;"></div>
      <p>Опрацьовуємо запит через ШІ та аналізуємо базу роз'яснень...</p>
    </div>`;
  
  try {
    const queryVector = await getQueryVector(query);
    
    // Calculate similarities
    const results = embeddingIndex.map(chunk => {
      const score = dotProduct(queryVector, chunk.vector);
      return { ...chunk, score };
    });
    
    // Sort and filter top results
    // We only show results with similarity score > 0.35 (to avoid irrelevant matches)
    const sorted = results
      .sort((a, b) => b.score - a.score)
      .slice(0, 15);
      
    renderResults(sorted);
  } catch (err) {
    el("aiResults").innerHTML = `
      <div style="text-align: center; padding: 40px; color: #ef4444; border: 1px dashed #fca5a5; border-radius:12px; background:#fef2f2;">
        <div style="font-size: 36px; margin-bottom: 8px;">⚠️ Помилка</div>
        <p>${err.message}</p>
        <p style="font-size: 13px; margin-top: 12px; color: #64748b;">
          Переконайтеся, що локальний сервер server.py запущений, або додайте ваш API ключ у налаштуваннях.
        </p>
      </div>`;
  } finally {
    el("searchSpinner").style.display = "none";
    el("searchBtn").disabled = false;
  }
}

function renderResults(results) {
  const container = el("aiResults");
  container.innerHTML = "";
  
  if (results.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 40px; color: #94a3b8;">
        <div style="font-size: 48px; margin-bottom: 16px;">🔍</div>
        <h3>Нічого не знайдено</h3>
        <p>Спробуйте переформулювати запит іншими словами.</p>
      </div>`;
    el("resultCount").textContent = "Знайдено: 0 результатів";
    return;
  }
  
  el("resultCount").textContent = `Знайдено ${results.length} найкращих збігів за смислом:`;
  
  results.forEach(item => {
    const card = document.createElement("div");
    card.className = "paragraph-card";
    
    // Convert score to percentage
    const pct = Math.max(0, Math.min(100, Math.round(item.score * 100)));
    const path = `../02_Перейменовані/${encodeURIComponent(item.proposed_name)}`;
    
    card.innerHTML = `
      <div class="card-meta-row">
        <a class="source-doc" href="${path}" target="_blank">📄 ${item.title}</a>
        <span class="score-badge">🎯 Схожість: ${pct}%</span>
      </div>
      <p class="p-text">« ${item.text} »</p>
      <div class="p-actions">
        <span class="tag-label">Абзац ${item.chunk_idx + 1}</span>
        <a href="${path}" target="_blank" style="font-size: 13px; font-weight: bold; color: #0284c7; text-decoration: none;">Відкрити повний документ →</a>
      </div>
    `;
    container.appendChild(card);
  });
}

async function init() {
  checkApiKeyStatus();
  
  el("searchBtn").addEventListener("click", handleSearch);
  el("aiSearch").addEventListener("keydown", (e) => {
    if (e.key === "Enter") handleSearch();
  });
  
  try {
    const res = await fetch("data/embeddings.json");
    if (!res.ok) throw new Error("Embeddings file not found");
    embeddingIndex = await res.json();
    console.log(`Loaded ${embeddingIndex.length} embeddings chunks.`);
  } catch (err) {
    el("aiResults").innerHTML = `
      <div style="text-align: center; padding: 40px; color: #ea580c; border: 1px dashed #fdba74; border-radius:12px; background:#fff7ed;">
        <div style="font-size: 36px; margin-bottom: 8px;">📂 База знань не створена</div>
        <p>Векторна база знань (embeddings.json) не знайдена.</p>
        <p style="font-size: 14px; margin-top: 12px; color: #475569;">
          Запустіть у папці проекту команду для генерації бази знань:<br>
          <code>python 04_Реєстр/build_embeddings.py</code>
        </p>
      </div>`;
  }
}

document.addEventListener("DOMContentLoaded", init);
