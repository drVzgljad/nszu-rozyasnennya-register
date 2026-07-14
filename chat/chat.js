import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://qdqtkvyvhtjgxpxnvblk.supabase.co';
const SUPABASE_KEY = 'sb_publishable_YXDm02hDBzLQmsUuVnZ_Og_IxQ60VCz';
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

let currentUser = null;
let currentUserRole = 'guest';
let chatMessages = [];
let messageReactions = {}; // messageId -> Array of reaction objects
let realtimeChannel = null;
let activeChat = { type: 'group' }; // { type: 'group' }, { type: 'private', userId: '...', userName: '...' } or { type: 'room', roomId: '...', roomName: '...' }
let knownUsers = {}; // userId -> userName mapping for offline/active DM lists
let unreadCounts = {}; // userId or roomId -> number of unread messages
let chatRooms = []; // Custom private group rooms representing multi-user DMs

const byId = (id) => document.getElementById(id);

async function init() {
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('mode') === 'popup') {
    document.body.classList.add('is-popup-window');
    document.title = "Робочий чат Департаменту";
    makePopupDraggable();
  }

  // Check auth session
  const { data: { session } } = await sb.auth.getSession();
  if (!session) {
    showSystemMessage("Помилка авторизації. Будь ласка, увійдіть до свого профілю.");
    return;
  }
  currentUser = session.user;

  // Load user profile role
  const { data: profile, error: profileErr } = await sb
    .from('profiles')
    .select('role')
    .eq('id', currentUser.id)
    .single();

  if (!profileErr && profile) {
    currentUserRole = profile.role;
  }

  // Load historical messages
  await loadMessages();

  // Load custom group rooms
  await loadRooms();

  // Setup Realtime subscription
  setupRealtime();

  // Send message event handler
  const form = byId("chatInputForm");
  if (form) {
    form.addEventListener("submit", handleSendMessage);
  }

  // Setup desktop notifications
  initNotificationSetup();

  // Setup emoji picker
  initEmojiPicker();

  // File attachments event handlers
  const fileBtn = byId("attachFileBtn");
  const fileInput = byId("chatFileInput");
  if (fileBtn && fileInput) {
    fileBtn.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", handleFileUpload);
  }

  // Cancel edit button handler
  const cancelBtn = byId("cancelEditBtn");
  if (cancelBtn) {
    cancelBtn.addEventListener("click", cancelEditing);
  }

  // PIP Mode Toggle
  const pipToggle = byId("pipToggleBtn");
  if (pipToggle) {
    pipToggle.addEventListener("click", togglePipMode);
  }

  // Setup click handler for General Chat item
  const mainGroupChannel = byId("channelGroupMain");
  if (mainGroupChannel) {
    mainGroupChannel.addEventListener("click", () => selectChannel({ type: 'group' }));
  }

  // Group creation modal triggers
  const openGroupBtn = byId("openCreateGroupBtn");
  const closeGroupBtn = byId("closeGroupModalBtn");
  const submitGroupBtn = byId("submitCreateGroupBtn");
  
  if (openGroupBtn) openGroupBtn.addEventListener("click", openCreateGroupModal);
  if (closeGroupBtn) closeGroupBtn.addEventListener("click", closeCreateGroupModal);
  if (submitGroupBtn) submitGroupBtn.addEventListener("click", handleCreateGroupSubmit);

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

  // Fetch reactions for loaded messages
  messageReactions = {};
  if (chatMessages.length > 0) {
    const messageIds = chatMessages.map(m => m.id);
    const { data: reactionsData, error: reactionsError } = await sb
      .from('chat_reactions')
      .select('*')
      .in('message_id', messageIds);

    if (reactionsError) {
      console.error('Error loading chat reactions:', reactionsError);
    } else if (reactionsData) {
      reactionsData.forEach(rx => {
        if (!messageReactions[rx.message_id]) {
          messageReactions[rx.message_id] = [];
        }
        messageReactions[rx.message_id].push(rx);
      });
    }
  }

  // Extract known user names from historical messages
  chatMessages.forEach(msg => {
    if (msg.user_id && msg.user_name) {
      knownUsers[msg.user_id] = msg.user_name;
    }
  });

  renderMessages();
  renderStats();
  renderPinnedMessages();
  renderDialoguesList();
}

function renderMessages() {
  const container = byId("chatMessages");
  if (!container) return;
  container.innerHTML = "";

  const filtered = chatMessages.filter(msg => {
    if (activeChat.type === 'group') {
      return !msg.recipient_id && !msg.room_id;
    } else if (activeChat.type === 'room') {
      return msg.room_id === activeChat.roomId;
    } else {
      return !msg.room_id && (
             (msg.user_id === currentUser.id && msg.recipient_id === activeChat.userId) ||
             (msg.user_id === activeChat.userId && msg.recipient_id === currentUser.id)
      );
    }
  });

  if (filtered.length === 0) {
    let emptyText = 'Повідомлень немає. Будьте першим, хто напише!';
    if (activeChat.type === 'room') {
      emptyText = 'Немає повідомлень у цій групі. Почніть обговорення!';
    } else if (activeChat.type === 'private') {
      emptyText = 'Немає повідомлень у цьому діалозі. Напишіть щось приватне!';
    }
    container.innerHTML = `<div class="chat-system-message">${emptyText}</div>`;
    return;
  }

  filtered.forEach(msg => {
    appendMessageElement(msg, false); // don't scroll each, we scroll once at the end
  });

  scrollToBottom();
}

function isOnlyEmojis(str) {
  try {
    const clean = str.replace(/\s+/g, '');
    if (!clean) return false;
    const emojiRegex = /^[\p{Extended_Pictographic}\u200d\ufe0f\u{1F3FB}-\u{1F3FF}\u20e3]+$/u;
    return emojiRegex.test(clean);
  } catch (e) {
    console.warn("isOnlyEmojis regex failed or unsupported in this browser:", e);
    return false;
  }
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
  
  // Detect if message is 1-3 emojis only
  let useLargeEmoji = false;
  try {
    const trimmedText = (msg.message_text || "").trim();
    const isEmojiOnly = isOnlyEmojis(trimmedText);
    let emojiCount = 0;
    if (isEmojiOnly) {
      const cleanText = trimmedText.replace(/\s+/g, '');
      const emojis = [...cleanText.matchAll(/[\p{Extended_Pictographic}]/gu)];
      emojiCount = emojis.length;
    }
    useLargeEmoji = isEmojiOnly && emojiCount > 0 && emojiCount <= 3;
  } catch (e) {
    console.warn("Emoji count calculation failed:", e);
  }

  const msgDiv = document.createElement("div");
  msgDiv.className = `chat-msg ${isMe ? 'msg-sent' : 'msg-received'} ${useLargeEmoji ? 'msg-only-emojis' : ''}`;
  msgDiv.dataset.id = msg.id;

  msgDiv.innerHTML = `
    <div class="chat-msg-meta">
      <span class="sender-name">${escapeHtml(msg.user_name || "Користувач")}</span>
      <span class="msg-time">${formatTime(msg.created_at)}</span>
      ${msg.is_top ? '<span class="pinned-badge" title="Закріплено як ТОП" style="font-size: 10px; color: var(--accent-dark, #2f6b9e); font-weight: 700; margin-left: 8px; background: rgba(74, 143, 199, 0.12); padding: 2px 6px; border-radius: 6px; display: inline-flex; align-items: center; gap: 3px;">📌 Важливе</span>' : ''}
    </div>
    <div class="chat-msg-bubble">${renderMessageText(msg.message_text)}</div>
  `;

  // Attach hover action controls
  const actionsDiv = document.createElement("div");
  actionsDiv.className = "chat-msg-actions";
  let hasActions = false;

  // Pin/Unpin action button (visible on public group messages only)
  if (!msg.recipient_id) {
    const pinBtn = document.createElement("button");
    pinBtn.type = "button";
    pinBtn.className = `chat-action-btn pin-btn ${msg.is_top ? 'is-active' : ''}`;
    pinBtn.title = msg.is_top ? "Відкріпити" : "Закріпити як ТОП";
    pinBtn.textContent = "📌";
    pinBtn.addEventListener("click", () => togglePinMessage(msg.id, msg.is_top));
    actionsDiv.appendChild(pinBtn);
    hasActions = true;
  }

  // Reaction picker action button (visible to non-guests)
  if (currentUserRole !== 'guest') {
    const reactBtn = document.createElement("button");
    reactBtn.type = "button";
    reactBtn.className = "chat-action-btn react-btn";
    reactBtn.title = "Реагувати";
    reactBtn.textContent = "😀";
    reactBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      showReactionPicker(msg.id, reactBtn);
    });
    actionsDiv.appendChild(reactBtn);
    hasActions = true;
  }

  if (isMe) {
    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "chat-action-btn edit-btn";
    editBtn.title = "Редагувати";
    editBtn.textContent = "✏️";
    editBtn.addEventListener("click", () => startEditing(msg.id, msg.message_text));
    
    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "chat-action-btn delete-btn";
    deleteBtn.title = "Видалити";
    deleteBtn.textContent = "🗑️";
    deleteBtn.addEventListener("click", () => deleteMessage(msg.id));
    
    actionsDiv.appendChild(editBtn);
    actionsDiv.appendChild(deleteBtn);
    hasActions = true;
  }

  if (hasActions) {
    msgDiv.appendChild(actionsDiv);
  }

  // Create reactions wrapper
  const rxWrapper = document.createElement("div");
  rxWrapper.className = "chat-msg-reactions-wrapper";
  rxWrapper.id = `rx-wrapper-${msg.id}`;
  msgDiv.appendChild(rxWrapper);

  container.appendChild(msgDiv);

  // Render reactions for this message
  renderMessageReactions(msg.id);

  if (scroll) {
    scrollToBottom();
  }
}

function renderMessageReactions(messageId) {
  const rxWrapper = byId(`rx-wrapper-${messageId}`);
  if (!rxWrapper) return;
  rxWrapper.innerHTML = "";

  const reactions = messageReactions[messageId] || [];
  if (reactions.length === 0) {
    rxWrapper.style.display = "none";
    return;
  }
  rxWrapper.style.display = "flex";

  // Group reactions by emoji
  const grouped = {};
  reactions.forEach(rx => {
    if (!grouped[rx.emoji]) {
      grouped[rx.emoji] = [];
    }
    grouped[rx.emoji].push(rx);
  });

  // Render a pill for each unique emoji
  Object.keys(grouped).forEach(emoji => {
    const users = grouped[emoji];
    const count = users.length;
    const hasMyReaction = users.some(rx => rx.user_id === currentUser?.id);

    const pill = document.createElement("button");
    pill.type = "button";
    pill.className = `reaction-pill ${hasMyReaction ? 'active' : ''}`;
    
    // Create tooltip text showing list of reactor names
    const names = users.map(rx => rx.user_name).join(", ");
    pill.title = names;

    pill.innerHTML = `
      <span class="reaction-emoji">${emoji}</span>
      <span class="reaction-count">${count}</span>
    `;

    // Click handler to toggle reaction
    pill.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleReaction(messageId, emoji);
    });

    rxWrapper.appendChild(pill);
  });
}

async function toggleReaction(messageId, emoji) {
  if (currentUserRole === 'guest') {
    alert("Гості не можуть залишати реакції.");
    return;
  }

  const existing = (messageReactions[messageId] || []).find(
    rx => rx.user_id === currentUser.id && rx.emoji === emoji
  );

  if (existing) {
    // Delete reaction
    const { error } = await sb
      .from('chat_reactions')
      .delete()
      .eq('id', existing.id);

    if (error) {
      console.error("Error deleting reaction:", error);
      alert("Не вдалося видалити реакцію: " + error.message);
    } else {
      // Optimistic update
      messageReactions[messageId] = messageReactions[messageId].filter(rx => rx.id !== existing.id);
      renderMessageReactions(messageId);
    }
  } else {
    // Add reaction
    const profileName = currentUser.user_metadata?.full_name || currentUser.email.split('@')[0];
    const newRx = {
      message_id: messageId,
      user_id: currentUser.id,
      user_name: profileName,
      emoji: emoji
    };

    const { data, error } = await sb
      .from('chat_reactions')
      .insert(newRx)
      .select();

    if (error) {
      console.error("Error inserting reaction:", error);
      alert("Не вдалося додати реакцію: " + error.message);
    } else if (data && data.length > 0) {
      // Optimistic update
      if (!messageReactions[messageId]) {
        messageReactions[messageId] = [];
      }
      messageReactions[messageId].push(data[0]);
      renderMessageReactions(messageId);
    }
  }
}

let currentPickerMessageId = null;

function showReactionPicker(messageId, triggerBtn) {
  let picker = byId("messageReactionPicker");
  if (!picker) {
    picker = document.createElement("div");
    picker.id = "messageReactionPicker";
    picker.className = "message-reaction-picker";
    
    const emojis = ['👍', '❤️', '🔥', '👏', '😂', '😮', '😢'];
    emojis.forEach(emoji => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "picker-emoji-btn";
      btn.textContent = emoji;
      btn.addEventListener("click", () => {
        if (currentPickerMessageId) {
          toggleReaction(currentPickerMessageId, emoji);
        }
        picker.style.display = "none";
      });
      picker.appendChild(btn);
    });
    
    document.body.appendChild(picker);
  }

  currentPickerMessageId = messageId;

  // Position the picker close to the triggerBtn
  const rect = triggerBtn.getBoundingClientRect();
  const pickerWidth = 240; // Approximate
  const pickerHeight = 40; // Approximate
  
  // Align it horizontally centered above the trigger button
  const top = rect.top + window.scrollY - pickerHeight - 8;
  const left = rect.left + window.scrollX + (rect.width / 2) - (pickerWidth / 2);

  picker.style.top = `${top}px`;
  picker.style.left = `${left}px`;
  picker.style.display = "flex";

  // Prevent immediate click close handler
  setTimeout(() => {
    const closePicker = (e) => {
      if (!picker.contains(e.target) && e.target !== triggerBtn) {
        picker.style.display = "none";
        document.removeEventListener("click", closePicker);
      }
    };
    document.addEventListener("click", closePicker);
  }, 50);
}

function showSystemMessage(text) {
  const container = byId("chatMessages");
  if (!container) return null;
  
  const msgDiv = document.createElement("div");
  msgDiv.className = "chat-system-message";
  msgDiv.textContent = text;
  container.appendChild(msgDiv);
  scrollToBottom();
  return msgDiv;
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

  if (editingMessageId) {
    const { data, error } = await sb
      .from('chat_messages')
      .update({ message_text: text })
      .eq('id', editingMessageId)
      .select();

    input.disabled = false;
    sendBtn.disabled = false;

    if (error) {
      console.error('Error updating message:', error);
      alert("Не вдалося оновити повідомлення: " + error.message);
    } else if (!data || data.length === 0) {
      console.warn('Update affected 0 rows. Check RLS policies.');
      alert("Помилка: не вдалося оновити повідомлення. Перевірте дозволи (RLS політика).");
    } else {
      // Immediate local UI update fallback
      const idx = chatMessages.findIndex(m => m.id === editingMessageId);
      if (idx !== -1) {
        chatMessages[idx].message_text = text;
      }
      const el = document.querySelector(`.chat-msg[data-id="${editingMessageId}"]`);
      if (el) {
        let useLargeEmoji = false;
        try {
          const isEmojiOnly = isOnlyEmojis(text);
          let emojiCount = 0;
          if (isEmojiOnly) {
            const cleanText = text.replace(/\s+/g, '');
            const emojis = [...cleanText.matchAll(/[\p{Extended_Pictographic}]/gu)];
            emojiCount = emojis.length;
          }
          useLargeEmoji = isEmojiOnly && emojiCount > 0 && emojiCount <= 3;
        } catch (e) {
          console.warn("Emoji parsing failed in edit fallback:", e);
        }
        el.classList.toggle('msg-only-emojis', useLargeEmoji);

        const bubble = el.querySelector('.chat-msg-bubble');
        if (bubble) {
          bubble.innerHTML = renderMessageText(text);
          const meta = el.querySelector('.chat-msg-meta');
          if (meta && !meta.querySelector('.edited-label')) {
            const span = document.createElement('span');
            span.className = 'edited-label';
            span.style.cssText = 'font-size: 10px; opacity: 0.6; margin-left: 6px; font-style: italic;';
            span.textContent = '(ред.)';
            meta.appendChild(span);
          }
        }
      }
      cancelEditing();
    }
  } else {
    const profileName = currentUser.user_metadata?.full_name || currentUser.email.split('@')[0];

    const insertPayload = {
      user_id: currentUser.id,
      user_name: profileName,
      message_text: text
    };
    if (activeChat.type === 'private') {
      insertPayload.recipient_id = activeChat.userId;
    } else if (activeChat.type === 'room') {
      insertPayload.room_id = activeChat.roomId;
    }

    const { data, error } = await sb.from('chat_messages').insert(insertPayload).select();

    input.disabled = false;
    sendBtn.disabled = false;

    if (error) {
      console.error('Error sending message:', error);
      showSystemMessage("Помилка надсилання повідомлення: " + error.message);
    } else {
      input.value = "";
      input.focus();

      // Optimistic rendering fallback: if Realtime hasn't rendered it yet
      if (data && data.length > 0) {
        const insertedMsg = data[0];
        if (!chatMessages.some(m => m.id === insertedMsg.id)) {
          chatMessages.push(insertedMsg);
          
          let belongsToActive = false;
          if (activeChat.type === 'group') {
            belongsToActive = !insertedMsg.recipient_id && !insertedMsg.room_id;
          } else if (activeChat.type === 'room') {
            belongsToActive = insertedMsg.room_id === activeChat.roomId;
          } else {
            belongsToActive = !insertedMsg.room_id && (
                              (insertedMsg.user_id === currentUser.id && insertedMsg.recipient_id === activeChat.userId) ||
                              (insertedMsg.user_id === activeChat.userId && insertedMsg.recipient_id === currentUser.id));
          }

          if (belongsToActive) {
            appendMessageElement(insertedMsg, true);
          }
          renderStats();
          renderDialoguesList();
        }
      }
    }
  }
}

function setupRealtime() {
  const profileName = currentUser?.user_metadata?.full_name || currentUser?.email.split('@')[0] || "Користувач";

  realtimeChannel = sb.channel('chat_room', {
    config: {
      presence: {
        key: currentUser?.id || 'anonymous'
      }
    }
  });

  realtimeChannel
    .on('postgres_changes', { 
      event: '*', 
      schema: 'public', 
      table: 'chat_messages' 
    }, payload => {
      const { eventType, new: newMsg, old: oldMsg } = payload;
      
      if (eventType === 'INSERT') {
        if (!chatMessages.some(m => m.id === newMsg.id)) {
          chatMessages.push(newMsg);
          
          if (newMsg.user_id && newMsg.user_name) {
            knownUsers[newMsg.user_id] = newMsg.user_name;
          }

          let belongsToActive = false;
          if (activeChat.type === 'group') {
            belongsToActive = !newMsg.recipient_id && !newMsg.room_id;
          } else if (activeChat.type === 'room') {
            belongsToActive = newMsg.room_id === activeChat.roomId;
          } else {
            belongsToActive = !newMsg.room_id && (
                              (newMsg.user_id === currentUser.id && newMsg.recipient_id === activeChat.userId) ||
                              (newMsg.user_id === activeChat.userId && newMsg.recipient_id === currentUser.id));
          }

          if (belongsToActive) {
            appendMessageElement(newMsg, true);
          } else {
            // Incoming private DM for us from someone else
            if (newMsg.recipient_id === currentUser.id && newMsg.user_id !== currentUser.id) {
              const senderId = newMsg.user_id;
              unreadCounts[senderId] = (unreadCounts[senderId] || 0) + 1;
              playNotificationSound();
              triggerIncomingAlert(newMsg);
            } else if (newMsg.room_id && newMsg.user_id !== currentUser.id) {
              // Message in some room
              unreadCounts[newMsg.room_id] = (unreadCounts[newMsg.room_id] || 0) + 1;
              playNotificationSound();
              triggerIncomingAlert(newMsg);
            }
          }

          renderStats();
          renderDialoguesList();
        }
      } else if (eventType === 'UPDATE') {
        const idx = chatMessages.findIndex(m => m.id === newMsg.id);
        if (idx !== -1) {
          chatMessages[idx] = newMsg;
          
          // Find element in UI and update
          const el = document.querySelector(`.chat-msg[data-id="${newMsg.id}"]`);
          if (el) {
            let useLargeEmoji = false;
            try {
              const trimmedText = (newMsg.message_text || "").trim();
              const isEmojiOnly = isOnlyEmojis(trimmedText);
              let emojiCount = 0;
              if (isEmojiOnly) {
                const cleanText = trimmedText.replace(/\s+/g, '');
                const emojis = [...cleanText.matchAll(/[\p{Extended_Pictographic}]/gu)];
                emojiCount = emojis.length;
              }
              useLargeEmoji = isEmojiOnly && emojiCount > 0 && emojiCount <= 3;
            } catch (e) {
              console.warn("Emoji parsing failed in UPDATE handler:", e);
            }
            el.classList.toggle('msg-only-emojis', useLargeEmoji);

            // Toggle pin button state
            const pinBtn = el.querySelector('.pin-btn');
            if (pinBtn) {
              pinBtn.className = `chat-action-btn pin-btn ${newMsg.is_top ? 'is-active' : ''}`;
              pinBtn.title = newMsg.is_top ? "Відкріпити" : "Закріпити як ТОП";
            }

            const bubble = el.querySelector('.chat-msg-bubble');
            if (bubble) {
              bubble.innerHTML = renderMessageText(newMsg.message_text);
            }

            const meta = el.querySelector('.chat-msg-meta');
            if (meta) {
              const badge = meta.querySelector('.pinned-badge');
              if (newMsg.is_top && !badge) {
                const span = document.createElement('span');
                span.className = 'pinned-badge';
                span.title = 'Закріплено як ТОП';
                span.style.cssText = 'font-size: 10px; color: var(--accent-dark, #2f6b9e); font-weight: 700; margin-left: 8px; background: rgba(74, 143, 199, 0.12); padding: 2px 6px; border-radius: 6px; display: inline-flex; align-items: center; gap: 3px;';
                span.textContent = '📌 Важливе';
                meta.appendChild(span);
              } else if (!newMsg.is_top && badge) {
                badge.remove();
              }

              if (!meta.querySelector('.edited-label')) {
                const span = document.createElement('span');
                span.className = 'edited-label';
                span.style.cssText = 'font-size: 10px; opacity: 0.6; margin-left: 6px; font-style: italic;';
                span.textContent = '(ред.)';
                meta.appendChild(span);
              }
            }
          }
          renderPinnedMessages();
        }
      } else if (eventType === 'DELETE') {
        const idx = chatMessages.findIndex(m => m.id === oldMsg.id);
        if (idx !== -1) {
          chatMessages.splice(idx, 1);
          
          // Remove from UI
          const el = document.querySelector(`.chat-msg[data-id="${oldMsg.id}"]`);
          if (el) el.remove();
          renderStats();
          renderPinnedMessages();
        }
      }
    })
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'chat_rooms'
    }, payload => {
      const { eventType, new: newRoom, old: oldRoom } = payload;
      if (eventType === 'INSERT') {
        if (!chatRooms.some(r => r.id === newRoom.id)) {
          chatRooms.push(newRoom);
          renderDialoguesList();
          // If we created this room, select it!
          if (newRoom.created_by === currentUser.id) {
            selectChannel({
              type: 'room',
              roomId: newRoom.id,
              roomName: newRoom.name
            });
          } else {
            playNotificationSound();
          }
        }
      } else if (eventType === 'UPDATE') {
        const idx = chatRooms.findIndex(r => r.id === newRoom.id);
        if (idx !== -1) {
          chatRooms[idx] = newRoom;
          if (activeChat.type === 'room' && activeChat.roomId === newRoom.id) {
            activeChat.roomName = newRoom.name;
            const headerTitle = document.querySelector(".chat-header-title");
            if (headerTitle) {
              headerTitle.textContent = "Груповий чат: " + newRoom.name;
            }
          }
          renderDialoguesList();
        }
      } else if (eventType === 'DELETE') {
        const idx = chatRooms.findIndex(r => r.id === oldRoom.id);
        if (idx !== -1) {
          chatRooms.splice(idx, 1);
          if (activeChat.type === 'room' && activeChat.roomId === oldRoom.id) {
            selectChannel({ type: 'group' });
          } else {
            renderDialoguesList();
          }
        }
      }
    })
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'chat_reactions'
    }, payload => {
      const { eventType, new: newRx, old: oldRx } = payload;
      if (eventType === 'INSERT') {
        const messageId = newRx.message_id;
        if (!messageReactions[messageId]) {
          messageReactions[messageId] = [];
        }
        if (!messageReactions[messageId].some(rx => rx.id === newRx.id)) {
          messageReactions[messageId].push(newRx);
          renderMessageReactions(messageId);
        }
      } else if (eventType === 'DELETE') {
        let foundMessageId = null;
        Object.keys(messageReactions).forEach(mId => {
          const idx = messageReactions[mId].findIndex(rx => rx.id === oldRx.id);
          if (idx !== -1) {
            messageReactions[mId].splice(idx, 1);
            foundMessageId = mId;
          }
        });
        if (foundMessageId) {
          renderMessageReactions(foundMessageId);
        }
      }
    })
    .on('presence', { event: 'sync' }, () => {
      const state = realtimeChannel.presenceState();
      updateOnlineUsersList(state);
    })
    .subscribe(async (status) => {
      updateConnectionStatus(status);
      if (status === 'SUBSCRIBED' && currentUser) {
        await realtimeChannel.track({
          user_id: currentUser.id,
          user_name: profileName,
          online_at: new Date().toISOString()
        });
      }
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
      if (permission === 'granted') {
        localStorage.setItem('chat_notifications_enabled', 'true');
        playNotificationSound();
        new Notification("Сповіщення активовано!", {
          body: "Ви будете отримувати повідомлення про нові репліки в чаті.",
          icon: "../assets/icon-192.png"
        });
      }
      updateNotificationButtonState();
    } else if (Notification.permission === 'granted') {
      const currentlyMuted = localStorage.getItem('chat_notifications_enabled') === 'false';
      localStorage.setItem('chat_notifications_enabled', currentlyMuted ? 'true' : 'false');
      updateNotificationButtonState();
      if (currentlyMuted) {
        playNotificationSound();
      }
    } else {
      alert("Доступ до сповіщень заблоковано в налаштуваннях браузера. Будь ласка, дозвольте їх вручну у налаштуваннях сайту.");
    }
  });
}

function updateNotificationButtonState() {
  const btn = byId('enableNotificationsBtn');
  if (!btn) return;

  const label = btn.querySelector('span') || btn;
  const isMuted = localStorage.getItem('chat_notifications_enabled') === 'false';

  if (Notification.permission === 'granted') {
    if (isMuted) {
      label.textContent = 'Сповіщення вимкнено (Muted)';
      btn.style.background = '#f2f8fb';
      btn.style.color = 'var(--muted, #647688)';
      btn.style.borderColor = 'var(--line, #dde6ee)';
    } else {
      label.textContent = 'Сповіщення увімкнено';
      btn.style.background = '#e9f7f3';
      btn.style.color = '#08705e';
      btn.style.borderColor = 'rgba(84, 173, 132, 0.25)';
    }
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

  // Check if user muted notifications in localStorage
  const isMuted = localStorage.getItem('chat_notifications_enabled') === 'false';
  if (isMuted) return;

  // Play notification sound
  playNotificationSound();

  // Show desktop notification if page is not active
  const isTabHidden = document.hidden || !document.hasFocus();
  if (isTabHidden && Notification.permission === 'granted') {
    const notification = new Notification(`Нове повідомлення від ${msg.user_name || "Користувач"}`, {
      body: msg.message_text,
      icon: "../assets/icon-192.png",
      tag: "chat-activity",
      renotify: true
    });
    
    notification.onclick = () => {
      window.focus();
      notification.close();
    };
  }
}

/* ── Supabase Presence List ──────────────────────── */

function updateOnlineUsersList(state) {
  const container = byId('onlineUsersList');
  const countEl = byId('onlineCount');
  if (!container) return;

  container.innerHTML = '';

  const onlineUsers = [];
  Object.keys(state).forEach(key => {
    const userPresences = state[key];
    if (userPresences && userPresences.length > 0) {
      onlineUsers.push(userPresences[0]);
    }
  });

  if (countEl) {
    countEl.textContent = onlineUsers.length;
  }

  if (onlineUsers.length === 0) {
    container.innerHTML = '<div class="online-user-item system">Нікого немає у чаті</div>';
    return;
  }

  onlineUsers.forEach(u => {
    const isMe = currentUser && u.user_id === currentUser.id;

    // Save to known users list
    if (u.user_id && u.user_name) {
      knownUsers[u.user_id] = u.user_name;
    }

    const item = document.createElement('div');
    item.className = 'online-user-item';
    item.innerHTML = `
      <span class="online-indicator-dot"></span>
      <span>${escapeHtml(u.user_name || "Користувач")}${isMe ? ' (Ви)' : ''}</span>
    `;

    if (!isMe && u.user_id) {
      item.title = "Надіслати приватне повідомлення";
      item.addEventListener('click', () => {
        selectChannel({
          type: 'private',
          userId: u.user_id,
          userName: u.user_name || "Користувач"
        });
      });
    }

    container.appendChild(item);
  });
}

/* ── Message Editing & Deletion ──────────────────── */

let editingMessageId = null;

function startEditing(id, text) {
  if (text.startsWith('📎 [Файл:')) {
    alert("Файли не можна редагувати, їх можна лише видалити.");
    return;
  }
  
  editingMessageId = id;
  const input = byId("chatMessageInput");
  const banner = byId("chatEditBanner");
  const sendBtn = byId("sendBtn");
  
  if (input && banner && sendBtn) {
    input.value = text;
    banner.style.display = "flex";
    banner.querySelector("span").textContent = `Редагування повідомлення: "${text.substring(0, 30)}${text.length > 30 ? '...' : ''}"`;
    sendBtn.querySelector("span").textContent = "Зберегти";
    input.focus();
  }
}

function cancelEditing() {
  editingMessageId = null;
  const input = byId("chatMessageInput");
  const banner = byId("chatEditBanner");
  const sendBtn = byId("sendBtn");
  
  if (input && banner && sendBtn) {
    input.value = "";
    banner.style.display = "none";
    sendBtn.querySelector("span").textContent = "Надіслати";
  }
}

async function deleteMessage(id) {
  if (!confirm("Ви впевнені, що хочете видалити це повідомлення для всіх?")) return;
  
  const { data, error } = await sb
    .from('chat_messages')
    .delete()
    .eq('id', id)
    .select();

  if (error) {
    console.error("Error deleting message:", error);
    alert("Не вдалося видалити повідомлення: " + error.message);
  } else if (!data || data.length === 0) {
    console.warn('Delete affected 0 rows. Check RLS policies.');
    alert("Помилка: не вдалося видалити повідомлення. Перевірте дозволи (RLS політика).");
  } else {
    // Immediate local UI update fallback
    const idx = chatMessages.findIndex(m => m.id === id);
    if (idx !== -1) {
      chatMessages.splice(idx, 1);
    }
    const el = document.querySelector(`.chat-msg[data-id="${id}"]`);
    if (el) el.remove();
    renderStats();
  }
}

/* ── File Uploads (Supabase Storage) ──────────────── */

async function handleFileUpload(e) {
  const fileInput = e.target;
  const file = fileInput.files[0];
  if (!file || !currentUser) return;

  // 10MB limit
  if (file.size > 10 * 1024 * 1024) {
    alert("Розмір файлу не повинен перевищувати 10 МБ.");
    fileInput.value = "";
    return;
  }

  const profileName = currentUser.user_metadata?.full_name || currentUser.email.split('@')[0];
  const originalName = file.name;
  
  // Show uploading system message
  const progressMsg = showSystemMessage(`Завантаження файлу "${originalName}"...`);
  
  const ext = originalName.split('.').pop();
  // Unique random name in storage to prevent collisions
  const uniqueName = `${crypto.randomUUID()}.${ext}`;

  const { data, error } = await sb.storage
    .from('chat-attachments')
    .upload(uniqueName, file);

  fileInput.value = ""; // Reset input

  if (error) {
    console.error("Storage upload error:", error);
    alert("Помилка завантаження файлу. Переконайтеся, що в консолі вашого Supabase створено ПУБЛІЧНИЙ бакет з назвою 'chat-attachments'.\nДеталі: " + error.message);
    if (progressMsg) progressMsg.remove();
    return;
  }

  // Get public URL
  const { data: { publicUrl } } = sb.storage
    .from('chat-attachments')
    .getPublicUrl(uniqueName);

  // Send formatted message
  const fileMsg = `📎 [Файл: ${originalName} (${formatBytes(file.size)})](${publicUrl})`;
  
  const filePayload = {
    user_id: currentUser.id,
    user_name: profileName,
    message_text: fileMsg
  };
  if (activeChat.type === 'private') {
    filePayload.recipient_id = activeChat.userId;
  } else if (activeChat.type === 'room') {
    filePayload.room_id = activeChat.roomId;
  }

  const { data: insertData, error: sendError } = await sb.from('chat_messages').insert(filePayload).select();

  if (progressMsg) progressMsg.remove();

  if (sendError) {
    console.error("Error sending file link message:", sendError);
    alert("Файл завантажено, але не вдалося надіслати повідомлення: " + sendError.message);
  } else {
    // Optimistic rendering fallback: if Realtime hasn't rendered it yet
    if (insertData && insertData.length > 0) {
      const insertedMsg = insertData[0];
      if (!chatMessages.some(m => m.id === insertedMsg.id)) {
        chatMessages.push(insertedMsg);
        
        let belongsToActive = false;
        if (activeChat.type === 'group') {
          belongsToActive = !insertedMsg.recipient_id && !insertedMsg.room_id;
        } else if (activeChat.type === 'room') {
          belongsToActive = insertedMsg.room_id === activeChat.roomId;
        } else {
          belongsToActive = !insertedMsg.room_id && (
                            (insertedMsg.user_id === currentUser.id && insertedMsg.recipient_id === activeChat.userId) ||
                            (insertedMsg.user_id === activeChat.userId && insertedMsg.recipient_id === currentUser.id));
        }

        if (belongsToActive) {
          appendMessageElement(insertedMsg, true);
        }
        renderStats();
        renderDialoguesList();
      }
    }
  }
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function renderMessageText(text) {
  if (text.startsWith('📎 [Файл:')) {
    const match = text.match(/📎 \[Файл:\s*([^\]]+)\]\(([^)]+)\)/);
    if (match) {
      const fileDesc = match[1];
      const url = match[2];
      
      const lastSpace = fileDesc.lastIndexOf('(');
      const name = lastSpace !== -1 ? fileDesc.substring(0, lastSpace).trim() : fileDesc;
      const size = lastSpace !== -1 ? fileDesc.substring(lastSpace + 1, fileDesc.length - 1).trim() : '';
      
      const ext = name.split('.').pop().toLowerCase();
      
      // If it's an image, render preview
      if (['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp'].includes(ext)) {
        return `
          <div class="chat-image-preview-container">
            <a href="${url}" target="_blank" rel="noopener">
              <img src="${url}" alt="${escapeHtml(name)}" class="chat-inline-image" loading="lazy">
            </a>
            <div class="chat-image-meta">
              <span class="chat-image-name" title="${escapeHtml(name)}">${escapeHtml(name)}</span>
              <span class="chat-image-size">${escapeHtml(size)}</span>
            </div>
          </div>
        `;
      }
      
      let icon = '📄';
      if (['pdf'].includes(ext)) icon = '📕';
      if (['doc', 'docx'].includes(ext)) icon = '📘';
      if (['xls', 'xlsx', 'csv'].includes(ext)) icon = '📗';
      
      return `
        <a href="${url}" target="_blank" rel="noopener" class="chat-file-card">
          <span class="chat-file-icon">${icon}</span>
          <span class="chat-file-info">
            <span class="chat-file-name" title="${escapeHtml(name)}">${escapeHtml(name)}</span>
            <span class="chat-file-size">${escapeHtml(size || 'Завантажити')}</span>
          </span>
        </a>
      `;
    }
  }
  const escaped = escapeHtml(text);
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const linked = escaped.replace(urlRegex, (match) => {
    // Прибираємо кінцеві розділові знаки, що прилипли до URL
    let url = match;
    let trailing = '';
    const trailingMatch = url.match(/([.,;:!?)]+)$/);
    if (trailingMatch) {
      trailing = trailingMatch[1];
      url = url.slice(0, -trailing.length);
    }
    return `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>${trailing}`;
  });
  return linked.replace(/\n/g, '<br>');
}

/* ── Emoji Picker Panel ──────────────────────────── */

function initEmojiPicker() {
  const trigger = byId('emojiTriggerBtn');
  const popup = byId('emojiPickerPopup');
  const input = byId('chatMessageInput');
  
  if (!trigger || !popup || !input) return;

  const popularEmojis = [
    '😀', '😂', '😊', '😉', '😎', '😍', '🤔', '🤷', '🤦',
    '👍', '👎', '👏', '🙌', '🎉', '🔥', '🚀', '💡', '💬',
    '❓', '❗', '✅', '❌', '🤝', '💻', '🩺', '💊', '🩹', 
    '🏥', '🚑', '📢', '✍️', '📅', '⏳', '🏥', '⚕️', '🩺'
  ];

  const grid = popup.querySelector('.emoji-grid');
  if (grid) {
    grid.innerHTML = '';
    const uniqueEmojis = [...new Set(popularEmojis)];
    uniqueEmojis.forEach(emoji => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'emoji-btn';
      btn.textContent = emoji;
      btn.style.cssText = 'background: none; border: none; font-size: 20px; padding: 4px; cursor: pointer; border-radius: 6px; display: flex; align-items: center; justify-content: center; transition: background 0.15s;';
      
      btn.addEventListener('mouseenter', () => btn.style.background = 'rgba(74, 143, 199, 0.15)');
      btn.addEventListener('mouseleave', () => btn.style.background = 'none');
      
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        
        const start = input.selectionStart;
        const end = input.selectionEnd;
        const text = input.value;
        input.value = text.substring(0, start) + emoji + text.substring(end);
        
        input.selectionStart = input.selectionEnd = start + emoji.length;
        input.focus();
        
        popup.style.display = 'none';
      });
      grid.appendChild(btn);
    });
  }

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    const isHidden = popup.style.display === 'none';
    popup.style.display = isHidden ? 'block' : 'none';
  });

  document.addEventListener('click', (e) => {
    if (!popup.contains(e.target) && e.target !== trigger) {
      popup.style.display = 'none';
    }
  });
}

/* ── Pinned/Top Messages Left Panel Logic ────────── */

function renderPinnedMessages() {
  const list = byId("pinnedMessagesList");
  if (!list) return;

  const pinned = chatMessages.filter(msg => {
    if (msg.is_top) {
      if (activeChat.type === 'group') {
        return !msg.recipient_id && !msg.room_id;
      } else if (activeChat.type === 'room') {
        return msg.room_id === activeChat.roomId;
      } else {
        return !msg.room_id && (
               (msg.user_id === currentUser.id && msg.recipient_id === activeChat.userId) ||
               (msg.user_id === activeChat.userId && msg.recipient_id === currentUser.id)
        );
      }
    }
    return false;
  });

  if (pinned.length === 0) {
    list.innerHTML = `
      <div class="pinned-placeholder" style="font-size: 12.5px; color: var(--muted); line-height: 1.45; font-style: italic;">
        Немає закріплених оголошень. Наведіть на повідомлення та натисніть 📌, щоб додати його сюди.
      </div>
    `;
    return;
  }

  list.innerHTML = "";
  pinned.forEach(msg => {
    const item = document.createElement("div");
    item.className = "pinned-message-item";
    item.dataset.id = msg.id;
    
    let textPreview = msg.message_text;
    if (textPreview.startsWith('📎 [Файл:')) {
      const match = textPreview.match(/📎 \[Файл:\s*([^\]]+)\]/);
      textPreview = match ? `📎 Файл: ${match[1]}` : '📎 Файл';
    }
    if (textPreview.length > 55) {
      textPreview = textPreview.substring(0, 55) + "...";
    }

    item.innerHTML = `
      <div class="pinned-item-header">
        <span class="pinned-item-author">${escapeHtml(msg.user_name || "Користувач")}</span>
        <button type="button" class="unpin-item-btn" title="Відкріпити">❌</button>
      </div>
      <div class="pinned-item-body">${escapeHtml(textPreview)}</div>
    `;

    item.addEventListener("click", (e) => {
      if (e.target.classList.contains("unpin-item-btn")) {
        e.stopPropagation();
        togglePinMessage(msg.id, true);
        return;
      }
      scrollToMessage(msg.id);
    });

    list.appendChild(item);
  });
}

async function togglePinMessage(id, currentIsTop) {
  const nextIsTop = !currentIsTop;

  const { data, error } = await sb
    .from('chat_messages')
    .update({ is_top: nextIsTop })
    .eq('id', id)
    .select();

  if (error) {
    console.error("Error toggling pin status:", error);
    alert("Не вдалося змінити статус закріплення: " + error.message);
  } else if (!data || data.length === 0) {
    console.warn('Pin toggle affected 0 rows. Check RLS policies.');
    alert("Помилка: не вдалося змінити статус закріплення. Перевірте дозволи (RLS політика).");
  } else {
    // Immediate local UI update fallback
    const idx = chatMessages.findIndex(m => m.id === id);
    if (idx !== -1) {
      chatMessages[idx].is_top = nextIsTop;
    }
    
    // Toggle class on message DOM
    const el = document.querySelector(`.chat-msg[data-id="${id}"]`);
    if (el) {
      const pinBtn = el.querySelector('.pin-btn');
      if (pinBtn) {
        pinBtn.className = `chat-action-btn pin-btn ${nextIsTop ? 'is-active' : ''}`;
        pinBtn.title = nextIsTop ? "Відкріпити" : "Закріпити як ТОП";
      }
      
      // Update badge
      const meta = el.querySelector('.chat-msg-meta');
      if (meta) {
        const badge = meta.querySelector('.pinned-badge');
        if (nextIsTop && !badge) {
          const span = document.createElement('span');
          span.className = 'pinned-badge';
          span.title = 'Закріплено як ТОП';
          span.style.cssText = 'font-size: 10px; color: var(--accent-dark, #2f6b9e); font-weight: 700; margin-left: 8px; background: rgba(74, 143, 199, 0.12); padding: 2px 6px; border-radius: 6px; display: inline-flex; align-items: center; gap: 3px;';
          span.textContent = '📌 Важливе';
          meta.appendChild(span);
        } else if (!nextIsTop && badge) {
          badge.remove();
        }
      }
    }
    
    // Re-render pinned list
    renderPinnedMessages();
  }
}

function scrollToMessage(id) {
  const el = document.querySelector(`.chat-msg[data-id="${id}"]`);
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    
    // Flash highlight effect
    el.classList.add('highlight-flash');
    setTimeout(() => el.classList.remove('highlight-flash'), 1500);
      } else {
    alert("Повідомлення не знайдено в поточній історії.");
  }
}

/* ── Picture-in-Picture Floating Chat Logic ──────── */
let popupRef = null;

function togglePipMode() {
  if (popupRef && !popupRef.closed) {
    popupRef.focus();
    return;
  }

  const popupWidth = 430;
  const popupHeight = 620;
  const left = (screen.width - popupWidth) / 2;
  const top = (screen.height - popupHeight) / 2;

  const popupUrl = new URL(window.location.origin + window.location.pathname);
  popupUrl.searchParams.set('mode', 'popup');

  popupRef = window.open(
    popupUrl.toString(),
    'chat_popup',
    `width=${popupWidth},height=${popupHeight},left=${left},top=${top},menubar=no,status=no,toolbar=no,location=no,resizable=yes`
  );

  if (popupRef) {
    const chatWin = byId("chatWindow");
    if (chatWin) {
      chatWin.classList.add("popup-active");
      showPopupOverlay();
    }

    const timer = setInterval(() => {
      if (!popupRef || popupRef.closed) {
        clearInterval(timer);
        if (chatWin) {
          chatWin.classList.remove("popup-active");
        }
      }
    }, 1000);
  }
}

function showPopupOverlay() {
  const win = byId("chatWindow");
  if (!win) return;

  let overlay = win.querySelector(".chat-popup-overlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.className = "chat-popup-overlay";
    overlay.innerHTML = `
      <div class="chat-popup-overlay-content">
        <span style="font-size: 40px; margin-bottom: 12px; display: block;">↗️</span>
        <h3 style="margin: 0 0 8px; font-size: 17px; font-weight: 700; color: var(--ink);">Чат відкрито в окремому вікні</h3>
        <p style="margin: 0; font-size: 13px; color: var(--muted); line-height: 1.45;">Ви можете переміщати його по всьому екрану та згортати основне вікно.</p>
        <button type="button" class="action primary restore-chat-btn" style="margin-top: 16px; padding: 10px 20px; font-size: 13.5px; font-weight: 700; border-radius: 12px; cursor: pointer;">
          Повернути чат сюди
        </button>
      </div>
    `;

    overlay.querySelector(".restore-chat-btn").addEventListener("click", () => {
      if (popupRef && !popupRef.closed) {
        popupRef.close();
      }
      const chatWin = byId("chatWindow");
      if (chatWin) {
        chatWin.classList.remove("popup-active");
      }
    });

    win.appendChild(overlay);
  }
}

function makePopupDraggable() {
  const handle = byId("chatWindowHeader");
  if (!handle) return;

  let startX = 0;
  let startY = 0;

  function onMouseDown(e) {
    if (e.target.closest('.chat-header-btn')) return;
    startX = e.screenX;
    startY = e.screenY;

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }

  function onMouseMove(e) {
    const dx = e.screenX - startX;
    const dy = e.screenY - startY;
    
    window.moveBy(dx, dy);

    startX = e.screenX;
    startY = e.screenY;
  }

  function onMouseUp() {
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
  }

  // Touch support
  function onTouchStart(e) {
    if (e.target.closest('.chat-header-btn')) return;
    const touch = e.touches[0];
    startX = touch.screenX;
    startY = touch.screenY;

    document.addEventListener('touchmove', onTouchMove, { passive: false });
    document.addEventListener('touchend', onTouchEnd);
  }

  function onTouchMove(e) {
    const touch = e.touches[0];
    const dx = touch.screenX - startX;
    const dy = touch.screenY - startY;

    window.moveBy(dx, dy);

    startX = touch.screenX;
    startY = touch.screenY;
  }

  function onTouchEnd() {
    document.removeEventListener('touchmove', onTouchMove);
    document.removeEventListener('touchend', onTouchEnd);
  }

  handle.addEventListener('mousedown', onMouseDown);
  handle.addEventListener('touchstart', onTouchStart);
}

function selectChannel(channel) {
  activeChat = channel;

  // Clear unread counts for this channel
  if (channel.type === 'private') {
    unreadCounts[channel.userId] = 0;
  } else if (channel.type === 'room') {
    unreadCounts[channel.roomId] = 0;
  }

  // Update Header Title
  const headerTitle = document.querySelector(".chat-header-title");
  if (headerTitle) {
    if (channel.type === 'group') {
      headerTitle.textContent = "Робочий чат Департаменту";
    } else if (channel.type === 'room') {
      headerTitle.textContent = "Груповий чат: " + channel.roomName;
    } else {
      headerTitle.textContent = "Приватний чат з " + channel.userName;
    }
  }

  // Update Input Placeholder
  const input = byId("chatMessageInput");
  if (input) {
    if (channel.type === 'group') {
      input.placeholder = "Введіть повідомлення експертам департаменту...";
    } else if (channel.type === 'room') {
      input.placeholder = `Надіслати у групу ${channel.roomName}...`;
    } else {
      input.placeholder = `Надіслати приватне повідомлення для ${channel.userName}...`;
    }
  }

  // Render messages, pinned messages and updates Dialogues list active styling
  renderMessages();
  renderPinnedMessages();
  renderDialoguesList();
  
  // Reset scroll
  scrollToBottom();
}

function renderDialoguesList() {
  const list = byId("channelsList");
  if (!list) return;

  // Clear everything except General main channel item
  const mainGroup = byId("channelGroupMain");
  list.innerHTML = "";
  if (mainGroup) {
    // Restore main channel and toggle active class
    mainGroup.className = `channel-item ${activeChat.type === 'group' ? 'active' : ''}`;
    list.appendChild(mainGroup);
  }

  // Render group rooms
  chatRooms.forEach(room => {
    const item = document.createElement("div");
    const isActive = activeChat.type === 'room' && activeChat.roomId === room.id;
    item.className = `channel-item ${isActive ? 'active' : ''}`;
    item.dataset.type = "room";
    item.dataset.roomId = room.id;

    const unreadCount = unreadCounts[room.id] || 0;
    const isCreator = currentUser && room.created_by === currentUser.id;

    item.innerHTML = `
      <span class="channel-icon">👥</span>
      <span class="channel-name">${escapeHtml(room.name)}</span>
      ${unreadCount > 0 ? `<span class="unread-badge">🔴 ${unreadCount}</span>` : ''}
      ${isCreator ? `<button type="button" class="channel-delete-btn" title="Видалити групу">🗑️</button>` : ''}
    `;

    const deleteBtn = item.querySelector('.channel-delete-btn');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteRoom(room.id, room.name);
      });
    }

    item.addEventListener("click", () => {
      selectChannel({
        type: 'room',
        roomId: room.id,
        roomName: room.name
      });
    });

    list.appendChild(item);
  });

  // Find all private dialogue userIds from chatMessages
  const dialogueUserIds = new Set();
  chatMessages.forEach(m => {
    if (m.recipient_id && !m.room_id) {
      if (m.user_id === currentUser.id) {
        dialogueUserIds.add(m.recipient_id);
      } else if (m.recipient_id === currentUser.id) {
        dialogueUserIds.add(m.user_id);
      }
    }
  });

  // Render each private dialogue channel item
  dialogueUserIds.forEach(userId => {
    // Skip rendering if userId matches current user
    if (currentUser && userId === currentUser.id) return;

    const userName = knownUsers[userId] || "Користувач";
    const item = document.createElement("div");
    
    const isActive = activeChat.type === 'private' && activeChat.userId === userId;
    item.className = `channel-item ${isActive ? 'active' : ''}`;
    item.dataset.type = "private";
    item.dataset.userId = userId;

    const unreadCount = unreadCounts[userId] || 0;
    
    item.innerHTML = `
      <span class="channel-icon">👤</span>
      <span class="channel-name">${escapeHtml(userName)}</span>
      ${unreadCount > 0 ? `<span class="unread-badge">🔴 ${unreadCount}</span>` : ''}
      <button type="button" class="channel-delete-btn" title="Видалити діалог">🗑️</button>
    `;

    const deleteBtn = item.querySelector('.channel-delete-btn');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        deletePrivateDialogue(userId, userName);
      });
    }

    item.addEventListener("click", () => {
      selectChannel({
        type: 'private',
        userId: userId,
        userName: userName
      });
    });

    list.appendChild(item);
  });
}

async function loadRooms() {
  const { data, error } = await sb
    .from('chat_rooms')
    .select('*');
  
  if (error) {
    console.error('Error loading chat rooms:', error);
    return;
  }
  chatRooms = data || [];
  renderDialoguesList();
}

function openCreateGroupModal() {
  const modal = byId("createGroupModal");
  if (!modal) return;

  // Clear inputs
  const nameInput = byId("newGroupNameInput");
  if (nameInput) nameInput.value = "";

  // Populate checkboxes
  const membersList = byId("modalMembersList");
  if (membersList) {
    membersList.innerHTML = "";

    // We can list all users in knownUsers (excluding currentUser)
    const userIds = Object.keys(knownUsers).filter(id => id !== currentUser.id);

    if (userIds.length === 0) {
      membersList.innerHTML = '<div style="font-size: 13px; color: var(--muted); text-align: center; padding: 10px;">Немає інших відомих користувачів. Напишіть спочатку в загальний чат, щоб користувачі з\'явилися в списку.</div>';
    } else {
      userIds.forEach(userId => {
        const userName = knownUsers[userId];
        const div = document.createElement("label");
        div.className = "modal-member-checkbox-item";
        div.innerHTML = `
          <input type="checkbox" value="${userId}">
          <span>${escapeHtml(userName)}</span>
        `;
        membersList.appendChild(div);
      });
    }
  }

  modal.style.display = "flex";
}

function closeCreateGroupModal() {
  const modal = byId("createGroupModal");
  if (modal) {
    modal.style.display = "none";
  }
}

async function handleCreateGroupSubmit() {
  const nameInput = byId("newGroupNameInput");
  if (!nameInput) return;

  const roomName = nameInput.value.trim();
  if (!roomName) {
    alert("Будь ласка, введіть назву групи.");
    return;
  }

  // Get selected members
  const checkboxes = document.querySelectorAll('#modalMembersList input[type="checkbox"]:checked');
  const selectedIds = Array.from(checkboxes).map(cb => cb.value);

  // Creator MUST be in member_ids
  if (!selectedIds.includes(currentUser.id)) {
    selectedIds.push(currentUser.id);
  }

  // Submit to Supabase
  const submitBtn = byId("submitCreateGroupBtn");
  if (submitBtn) submitBtn.disabled = true;

  const { data, error } = await sb
    .from('chat_rooms')
    .insert({
      name: roomName,
      member_ids: selectedIds,
      created_by: currentUser.id
    })
    .select();

  if (submitBtn) submitBtn.disabled = false;

  if (error) {
    console.error("Error creating group room:", error);
    alert("Не вдалося створити групу: " + error.message);
  } else {
    closeCreateGroupModal();
    if (data && data.length > 0) {
      const newRoom = data[0];
      // Optimistic update if realtime is slow
      if (!chatRooms.some(r => r.id === newRoom.id)) {
        chatRooms.push(newRoom);
        renderDialoguesList();
        selectChannel({
          type: 'room',
          roomId: newRoom.id,
          roomName: newRoom.name
        });
      }
    }
  }
}

/* ── Видалення каналів ────────────────────────────── */

async function deleteRoom(roomId, roomName) {
  if (!confirm(`Ви впевнені, що хочете видалити групу "${roomName}"?\n\nВсі повідомлення в цій групі будуть видалені назавжди.`)) return;

  const { error } = await sb
    .from('chat_rooms')
    .delete()
    .eq('id', roomId);

  if (error) {
    console.error('Error deleting room:', error);
    alert('Не вдалося видалити групу: ' + error.message);
    return;
  }

  // Видаляємо повідомлення цієї кімнати з локального масиву
  chatMessages = chatMessages.filter(m => m.room_id !== roomId);
  chatRooms = chatRooms.filter(r => r.id !== roomId);

  // Якщо ми були в цій кімнаті — переходимо в загальний чат
  if (activeChat.type === 'room' && activeChat.roomId === roomId) {
    selectChannel({ type: 'group' });
  } else {
    renderDialoguesList();
  }
}

async function deletePrivateDialogue(userId, userName) {
  if (!confirm(`Видалити діалог з "${userName}"?\n\nВсі повідомлення в цьому діалозі будуть видалені для всіх.`)) return;

  // Знаходимо ID повідомлень цього діалогу
  const dialogueMsgIds = chatMessages
    .filter(m => !m.room_id && (
      (m.user_id === currentUser.id && m.recipient_id === userId) ||
      (m.user_id === userId && m.recipient_id === currentUser.id)
    ))
    .map(m => m.id);

  if (dialogueMsgIds.length === 0) {
    alert('Діалог вже порожній.');
    return;
  }

  const { error } = await sb
    .from('chat_messages')
    .delete()
    .in('id', dialogueMsgIds);

  if (error) {
    console.error('Error deleting private dialogue:', error);
    alert('Не вдалося видалити діалог: ' + error.message);
    return;
  }

  // Видаляємо з локального масиву
  chatMessages = chatMessages.filter(m => !dialogueMsgIds.includes(m.id));

  // Якщо ми були в цьому діалозі — переходимо в загальний чат
  if (activeChat.type === 'private' && activeChat.userId === userId) {
    selectChannel({ type: 'group' });
  } else {
    renderDialoguesList();
  }
}

document.addEventListener("DOMContentLoaded", init);
