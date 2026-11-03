/**
 * Сповіщення поза порталом (Web Push) для «Чату департаменту».
 *
 * Навіщо: «Покликати в голос» через chat_pings бачить лише той, у кого чат
 * відкритий. Push доходить і на заблокований телефон, і в згорнутий браузер.
 *
 * Як: браузер підписується на push кореневим service worker (sw.js: обробники
 * push / notificationclick), підписку пишемо в push_subscriptions (RLS — свої
 * рядки). Надсилає воркер tools/voice-turn: POST /push/send з JWT того, хто
 * кличе; адресатів воркер бере функцією бази push_targets, текст складає сам.
 *
 * iPhone: Web Push є лише в застосунку, встановленому на головний екран
 * (Safari → «Поділитися» → «На екран „Додому“»), з iOS 16.4.
 */

import { VOICE_TURN_URL } from './voice.js?v=20261103b';

const KEY_URL = VOICE_TURN_URL + '/push/key';
const SEND_URL = VOICE_TURN_URL + '/push/send';

export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
export const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

/** 'unsupported' | 'ios-install' | 'denied' | 'on' | 'off' */
export async function pushState() {
  if (!pushSupported()) return isIOS() && !standalone() ? 'ios-install' : 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await navigator.serviceWorker.getRegistration('/');
  const sub = await reg?.pushManager.getSubscription();
  return sub ? 'on' : 'off';
}

function keyBytes(b64) {
  const s = atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64.length + 3) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

function device() {
  const ua = navigator.userAgent;
  const os = /Android/.test(ua) ? 'Android' : isIOS() ? 'iPhone/iPad' : /Windows/.test(ua) ? 'Windows' : /Mac/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'інше';
  const br = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : '';
  return `${os}${br ? ' · ' + br : ''}`;
}

/** Увімкнути: дозвіл → підписка → рядок у push_subscriptions. Кидає помилку з людським текстом. */
export async function enablePush(sb, me) {
  if (!pushSupported()) throw new Error(isIOS() ? 'на iPhone спершу встановіть портал на головний екран (Поділитися → «На екран Додому»)' : 'цей браузер не вміє push-сповіщень');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('браузер не дав дозволу на сповіщення — дозвольте їх біля адресного рядка');
  const r = await fetch(KEY_URL).catch(() => null);
  const j = r && r.ok ? await r.json().catch(() => null) : null;
  if (!j?.key) throw new Error('сервер сповіщень ще не налаштовано');
  // Кореневий воркер реєструє auth-v2.js; чекаємо, поки він стане активним
  const reg = (await navigator.serviceWorker.getRegistration('/')) || (await navigator.serviceWorker.register('/sw.js?v=60'));
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(j.key) });
  const k = sub.toJSON().keys || {};
  const { error } = await sb.from('push_subscriptions').upsert(
    { user_id: me.id, endpoint: sub.endpoint, p256dh: k.p256dh, auth: k.auth, device: device() },
    { onConflict: 'endpoint' }
  );
  if (error) {
    if (/push_subscriptions/.test(error.message || '')) throw new Error('у базі ще немає таблиці підписок — потрібна міграція 03d');
    throw error;
  }
}

export async function disablePush(sb) {
  const reg = await navigator.serviceWorker.getRegistration('/');
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await sb.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
  await sub.unsubscribe();
}

/**
 * Надіслати запрошення. body: { uids? | dept? | all?, kind: 'invite'|'gather', room, key }.
 * Повертає { people, sent } або null, якщо сервер сповіщень недоступний (тоді
 * лишається запрошення в самому чаті — chat_pings).
 */
export async function sendPushInvite(sb, body) {
  try {
    const { data: { session } } = await sb.auth.getSession();
    const r = await fetch(SEND_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session?.access_token || ''}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const j = await r.json().catch(() => null);
    // Старий воркер (без /push/send) відповідає ключами TURN — це не відправка
    return r.ok && typeof j?.sent === 'number' ? j : null;
  } catch (_) {
    return null;
  }
}
