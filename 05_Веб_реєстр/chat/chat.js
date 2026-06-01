import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://qdqtkvyvhtjgxpxnvblk.supabase.co';
const SUPABASE_KEY = 'sb_publishable_YXDm02hDBzLQmsUuVnZ_Og_IxQ60VCz';
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

let currentUser = null;
let chatMessages = [];
let realtimeChannel = null;

const byId = (id) => document.getElementById(id);

async function init() {
  // Check auth session
  const { data: { session } } = await sb.auth.getSession();
  if (!session) {
    showSystemMessage("Помилка авторизації. Будь ласка, увійдіть до свого профілю.");
    return;
  }
  currentUser = session.user;

  // Load historical messages
  await loadMessages();

  // Setup Realtime subscription
  setupRealtime();

  // Send message event handler
  const form = byId("chatInputForm");
  if (form) {
    form.addEventListener("submit", handleSendMessage);
  }

  // Setup desktop notifications
  initNotificationSetup();

  // Handle page unloading to unsubscribe
  window.addEventListener('beforeunload', () => {
    if (realtimeChannel) {
      sb.removeChannel(realtimeChannel);
    }
  });
}

async function loadMessages() {
  const messagesContainer = byId("chatMessages");
  if (messagesContainer) {
    messagesContainer.innerHTML = '<div class="chat-system-message">Завантаження повідомлень...</div>';
  }

  const { data, error } = await sb
    .from('chat_messages')
    .select('*')
    .order('created_at', { ascending: true })
    .limit(100);

  if (error) {
    console.error('Error loading chat messages:', error);
    showSystemMessage("Не вдалося завантажити історію повідомлень.");
    return;
  }

  chatMessages = data || [];
  renderMessages();
  renderStats();
}

function renderMessages() {
  const container = byId("chatMessages");
  if (!container) return;
  container.innerHTML = "";

  if (chatMessages.length === 0) {
    container.innerHTML = '<div class="chat-system-message">Повідомлень немає. Будьте першим, хто напише!</div>';
    return;
  }

  chatMessages.forEach(msg => {
    appendMessageElement(msg, false); // don't scroll each, we scroll once at the end
  });

  scrollToBottom();
}

function appendMessageElement(msg, scroll = true) {
  const container = byId("chatMessages");
  if (!container) return;

  // Remove placeholder if it is there
  const systemMsg = container.querySelector(".chat-system-message");
  if (systemMsg && (chatMessages.length > 0 || msg)) {
    systemMsg.remove();
  }

  const isMe = currentUser && msg.user_id === currentUser.id;
  const msgDiv = document.createElement("div");
  msgDiv.className = `chat-msg ${isMe ? 'msg-sent' : 'msg-received'}`;
  msgDiv.dataset.id = msg.id;

  msgDiv.innerHTML = `
    <div class="chat-msg-meta">
      <span class="sender-name">${escapeHtml(msg.user_name || "Користувач")}</span>
      <span class="msg-time">${formatTime(msg.created_at)}</span>
    </div>
    <div class="chat-msg-bubble">${escapeHtml(msg.message_text)}</div>
  `;

  container.appendChild(msgDiv);

  if (scroll) {
    scrollToBottom();
  }
}

function showSystemMessage(text) {
  const container = byId("chatMessages");
  if (!container) return;
  
  const msgDiv = document.createElement("div");
  msgDiv.className = "chat-system-message";
  msgDiv.textContent = text;
  container.appendChild(msgDiv);
  scrollToBottom();
}

function scrollToBottom() {
  const wrapper = byId("chatMessagesWrapper");
  if (wrapper) {
    wrapper.scrollTop = wrapper.scrollHeight;
  }
}

async function handleSendMessage(e) {
  e.preventDefault();
  const input = byId("chatMessageInput");
  const sendBtn = byId("sendBtn");
  const text = input.value.trim();

  if (!text || !currentUser) return;

  input.disabled = true;
  sendBtn.disabled = true;

  const profileName = currentUser.user_metadata?.full_name || currentUser.email.split('@')[0];

  const { error } = await sb.from('chat_messages').insert({
    user_id: currentUser.id,
    user_name: profileName,
    message_text: text
  });

  input.disabled = false;
  sendBtn.disabled = false;

  if (error) {
    console.error('Error sending message:', error);
    showSystemMessage("Помилка надсилання повідомлення: " + error.message);
  } else {
    input.value = "";
    input.focus();
  }
}

function setupRealtime() {
  realtimeChannel = sb.channel('public:chat_messages')
    .on('postgres_changes', { 
      event: 'INSERT', 
      schema: 'public', 
      table: 'chat_messages' 
    }, payload => {
      const newMsg = payload.new;
      // Avoid duplicate appending if loaded already
      if (!chatMessages.some(m => m.id === newMsg.id)) {
        chatMessages.push(newMsg);
        appendMessageElement(newMsg, true);
        renderStats();
        triggerIncomingAlert(newMsg);
      }
    })
    .subscribe((status) => {
      updateConnectionStatus(status);
    });
}

function updateConnectionStatus(status) {
  const dot = byId("statusDot");
  const text = byId("statusText");
  if (!dot || !text) return;

  if (status === 'SUBSCRIBED') {
    dot.className = "status-dot online";
    text.textContent = "В мережі (Активно)";
  } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
    dot.className = "status-dot offline";
    text.textContent = "Помилка підключення";
  } else {
    dot.className = "status-dot offline";
    text.textContent = "Підключення...";
  }
}

function renderStats() {
  const container = byId("chatStats");
  if (!container) return;

  const total = chatMessages.length;
  // Get count of unique users who sent messages
  const uniqueUsers = new Set(chatMessages.map(m => m.user_id)).size;

  container.innerHTML = `
    <div class="stat">
      <strong>${total}</strong>
      <span>Повідомлень</span>
    </div>
    <div class="stat">
      <strong>${uniqueUsers}</strong>
      <span>Учасників</span>
    </div>
  `;
}

function escapeHtml(str) {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatTime(isoString) {
  if (!isoString) return "";
  const date = new Date(isoString);
  return date.toLocaleTimeString("uk-UA", {
    hour: "2-digit",
    minute: "2-digit"
  });
}

/* ── Desktop & Audio Notifications ──────────────── */

function initNotificationSetup() {
  if (!('Notification' in window)) return;
  
  const card = byId('notificationCard');
  if (card) card.style.display = '';

  const btn = byId('enableNotificationsBtn');
  if (!btn) return;

  updateNotificationButtonState();

  btn.addEventListener('click', async () => {
    if (Notification.permission === 'default') {
      const permission = await Notification.requestPermission();
      updateNotificationButtonState();
      if (permission === 'granted') {
        playNotificationSound();
        new Notification("Сповіщення активовано!", {
          body: "Ви будете отримувати повідомлення про нові репліки в чаті.",
          icon: "../assets/nszu-shield.svg"
        });
      }
    } else if (Notification.permission === 'granted') {
      playNotificationSound();
    } else {
      alert("Доступ до сповіщень заблоковано в налаштуваннях браузера. Будь ласка, дозвольте їх вручну у налаштуваннях сайту.");
    }
  });
}

function updateNotificationButtonState() {
  const btn = byId('enableNotificationsBtn');
  if (!btn) return;

  const label = btn.querySelector('span') || btn;

  if (Notification.permission === 'granted') {
    label.textContent = 'Сповіщення увімкнено';
    btn.style.background = '#e9f7f3';
    btn.style.color = '#08705e';
    btn.style.borderColor = 'rgba(84, 173, 132, 0.25)';
  } else if (Notification.permission === 'denied') {
    label.textContent = 'Доступ заблоковано';
    btn.style.background = '#fdf2f2';
    btn.style.color = '#c0392b';
    btn.style.borderColor = 'rgba(192, 57, 43, 0.2)';
  } else {
    label.textContent = 'Увімкнути сповіщення';
    btn.style.background = '#fff';
    btn.style.color = 'var(--accent-dark)';
    btn.style.borderColor = 'rgba(0,111,201,.22)';
  }
}

function playNotificationSound() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    
    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
    
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.12);
    
    setTimeout(() => {
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(880, ctx.currentTime); // A5
      gain2.gain.setValueAtTime(0.08, ctx.currentTime);
      gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
      
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start();
      osc2.stop(ctx.currentTime + 0.18);
    }, 70);
  } catch (e) {
    console.error("Audio beep error:", e);
  }
}

function triggerIncomingAlert(msg) {
  if (!currentUser || msg.user_id === currentUser.id) return; // Ignore own messages

  // Play notification sound
  playNotificationSound();

  // Show desktop notification if page is not active
  const isTabHidden = document.hidden || !document.hasFocus();
  if (isTabHidden && Notification.permission === 'granted') {
    const notification = new Notification(`Нове повідомлення від ${msg.user_name || "Користувач"}`, {
      body: msg.message_text,
      icon: "../assets/nszu-shield.svg",
      tag: "chat-activity",
      renotify: true
    });
    
    notification.onclick = () => {
      window.focus();
      notification.close();
    };
  }
}

document.addEventListener("DOMContentLoaded", init);
