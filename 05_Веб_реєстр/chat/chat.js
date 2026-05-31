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

document.addEventListener("DOMContentLoaded", init);
