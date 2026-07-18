let embeddingIndex = null;
const documentsMap = new Map();
let isServerAvailable = false;

const el = (id) => document.getElementById(id);

// Local server state holds whether backend API is reachable

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
  // 1. Try local server endpoint first
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
    console.warn("Local embed API failed or not running, falling back to browser direct API...", e);
  }
  
  // No local server and no external API key direct calls allowed
  throw new Error("Локальний сервер не відповідає. Запустіть Відкрити_реєстр.cmd.");
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
          Переконайтеся, що локальний сервер server.py запущений.
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
    
    // Resolve path using documentsMap if available, else fall back to original proposed path
    let path = `../02_Перейменовані/${encodeURIComponent(item.proposed_name)}`;
    const doc = documentsMap.get(item.doc_id);
    if (doc && doc.local_path) {
      path = doc.local_path.split("/").map(part => encodeURIComponent(part)).join("/");
    }
    
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
  // Check if local server endpoint is running and responding
  try {
    const probeResponse = await fetch("/api/embed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "probe" })
    });
    if (probeResponse.ok) {
      const probeResult = await probeResponse.json();
      if (probeResult.status === "success") {
        isServerAvailable = true;
      }
    }
  } catch (e) {
    isServerAvailable = false;
  }
  
  if (!isServerAvailable) {
    el("aiSearch").disabled = true;
    el("searchBtn").disabled = true;
    el("aiSearch").placeholder = "Пошук відключено (потрібен локальний запуск)";
    el("aiResults").innerHTML = `
      <div style="text-align: center; padding: 40px; color: #ea580c; border: 1px dashed #fdba74; border-radius:12px; background:#fff7ed;">
        <div style="font-size: 36px; margin-bottom: 8px;">🖥️ Потрібен локальний запуск</div>
        <p>Семантичний AI-пошук доступний лише у локальному робочому просторі експертів.</p>
        <p style="font-size: 14px; margin-top: 12px; color: #475569;">
          Будь ласка, запустіть проєкт через файл <strong>Відкрити_реєстр.cmd</strong> у кореневій теці, щоб підключити AI-функції.
        </p>
      </div>`;
    return;
  }
  
  el("searchBtn").addEventListener("click", handleSearch);
  el("aiSearch").addEventListener("keydown", (e) => {
    if (e.key === "Enter") handleSearch();
  });
  
  try {
    const docsRes = await fetch("data/documents.json");
    if (docsRes.ok) {
      const docsData = await docsRes.json();
      if (docsData && docsData.documents) {
        docsData.documents.forEach(doc => {
          documentsMap.set(doc.id, doc);
        });
      }
    }
  } catch (err) {
    console.warn("Failed to load documents registry:", err);
  }
  
  try {
    const res = await fetch("data/embeddings.json");
    if (!res.ok) throw new Error("Embeddings file not found");
    embeddingIndex = await res.json();
    console.log(`Loaded ${embeddingIndex.length} embeddings chunks.`);
  } catch (err) {
    // Векторна база (data/embeddings.json, ~74 МБ) свідомо не публікується на сайт —
    // ШІ-пошук працює лише в локальній копії порталу.
    el("aiResults").innerHTML = `
      <div style="text-align: center; padding: 40px; color: #ea580c; border: 1px dashed #fdba74; border-radius:12px; background:#fff7ed;">
        <div style="font-size: 36px; margin-bottom: 8px;">🖥️ Лише офлайн-режим</div>
        <p>Семантичний (ШІ) пошук доступний тільки в локальній версії порталу.</p>
        <p style="font-size: 14px; margin-top: 12px; color: #475569;">
          Скористайтеся <a href="rozjasnennya.html" style="color:#2563eb;">звичайним пошуком по базі роз'яснень</a> —
          він охоплює ті самі документи.
        </p>
      </div>`;
  }
}

document.addEventListener("DOMContentLoaded", init);
