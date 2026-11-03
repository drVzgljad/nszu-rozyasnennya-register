/**
 * Нарада в голосовій кімнаті: «🔴 Нарада» → запис, «⏹ Кінець наради» → доріжки в базу.
 *
 * Сам запис робить рушій ./voice.js (startRecording / stopRecording): кожен голос —
 * окрема доріжка, тож у протоколі точно відомо, хто що сказав. Тут — лише рядок наради
 * в dept_meetings і вивантаження доріжок у приватний кошик meetings
 * (migration_2026-11-03i_meetings.sql). Далі tools\narady_sync.py забирає запис у вхідні,
 * розшифровує локально (Whisper) — і Claude робить протокол та доручення в «Справах».
 * Спільний для «Справ відділу» (spravy/voice.js) і «Чату департаменту» (zviazok.js).
 */

const EXT = { 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a' };

export function createMeeting({ sb, me, name, eng, toast = () => {} }) {
  const m = { id: null, busy: false, dept: '', room: '', label: '', members: new Map() };

  // Поки йде запис, закрити вкладку = втратити нараду: браузер перепитає
  const guard = (e) => { e.preventDefault(); e.returnValue = ''; };

  function remember() {
    (eng.state.members || []).forEach((x) => { if (x.uid) m.members.set(x.uid, x.name || ''); });
  }

  /** Відділ ініціатора — за ним доступ до запису (а не відділ кімнати: кімната буває спільна). */
  async function myDept() {
    if (m.dept) return m.dept;
    const { data } = await sb.from('profiles').select('Section').eq('id', me?.id).maybeSingle();
    return (m.dept = data?.Section || '');
  }

  /** Почати нараду. room: { topic, label } — у якій кімнаті. */
  async function start(room) {
    if (m.busy || eng.recording) return false;
    const dept = await myDept();
    if (!dept) { toast('У профілі не вказано відділ — нараду нікуди записати.', true); return false; }
    const title = (window.prompt('Тема наради (можна лишити порожнім):', '') ?? null);
    if (title === null) return false;                    // «Скасувати»
    m.busy = true;
    try {
      const { data, error } = await sb.from('dept_meetings').insert({
        department: dept, room_topic: room.topic, room_label: room.label || null,
        title: title.trim() || null, started_by_name: name
      }).select('id').single();
      if (error) {
        const missing = /dept_meetings|relation|schema cache/i.test(error.message || '');
        toast(missing ? 'Наради ще не ввімкнено: потрібна міграція migration_2026-11-03i_meetings.sql.' : 'Нараду не почато: ' + error.message, true);
        return false;
      }
      if (!eng.startRecording()) {
        await sb.from('dept_meetings').update({ status: 'failed', note: 'запис не стартував' }).eq('id', data.id);
        toast('Запис не почався: зайдіть у кімнату й спробуйте ще раз.', true);
        return false;
      }
      Object.assign(m, { id: data.id, room: room.topic, label: room.label });
      m.members.clear();
      remember();
      window.addEventListener('beforeunload', guard);
      toast('🔴 Запис наради почався. Усім у кімнаті прийшло попередження.');
      return true;
    } finally {
      m.busy = false;
    }
  }

  /** Завершити нараду: зупинити запис і вивантажити доріжки. */
  async function finish() {
    if (m.busy || !eng.recording || !m.id) return false;
    m.busy = true;
    remember();
    toast('⏳ Зберігаємо запис наради…');
    try {
      const res = await eng.stopRecording();
      const tracks = [];
      let n = 0;
      for (const t of res?.tracks || []) {
        n += 1;
        const type = (t.blob.type || 'audio/webm').split(';')[0];
        const path = `${m.id}/${String(n).padStart(2, '0')}_${t.offset_ms}_${(t.uid || 'x').slice(0, 8)}.${EXT[type] || 'webm'}`;
        const { error } = await sb.storage.from('meetings').upload(path, t.blob, { contentType: type, upsert: false });
        if (error) { console.error('meeting upload', path, error); continue; }
        tracks.push({ path, uid: t.uid, name: t.name, offset_ms: t.offset_ms, dur_ms: t.dur_ms, bytes: t.blob.size });
        if (t.uid) m.members.set(t.uid, t.name || m.members.get(t.uid) || '');
      }
      const lost = (res?.tracks.length || 0) - tracks.length;
      const { error } = await sb.from('dept_meetings').update({
        ended_at: new Date(res?.until || Date.now()).toISOString(),
        participants: [...m.members].map(([uid, nm]) => ({ uid, name: nm })),
        tracks,
        status: tracks.length ? 'uploaded' : 'failed',
        note: lost ? `не вивантажено доріжок: ${lost}` : null,
        updated_at: new Date().toISOString()
      }).eq('id', m.id);
      if (error) throw error;
      toast(tracks.length
        ? `✅ Нараду збережено (${tracks.length} ${tracks.length === 1 ? 'доріжка' : 'доріжки'}${lost ? `, ${lost} не вивантажено` : ''}). Протокол і доручення підготує Claude.`
        : 'Запис порожній: ніхто не говорив з увімкненим мікрофоном.', !tracks.length);
      return true;
    } catch (e) {
      toast('Запис наради не збережено: ' + (e.message || e), true);
      return false;
    } finally {
      window.removeEventListener('beforeunload', guard);
      m.id = null;
      m.busy = false;
    }
  }

  return {
    start,
    finish,
    get busy() { return m.busy; },
    get active() { return !!m.id && eng.recording; }
  };
}
