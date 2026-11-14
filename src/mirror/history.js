/**
 * The consultations this browser completed and MIRROR saved (session IDs only, in localStorage).
 *
 * MIRROR and PsyTrain have no student accounts, so this list is the only safe way to tell "my" saved
 * assessments apart from everyone else's in the MIRROR database: an ID is added only after MIRROR has
 * saved and returned that session's assessment (never for the demo, a failed or an unsubmitted session).
 * The assessments themselves stay in MIRROR and are always re-read from it.
 */
const KEY = 'mirror.progress.v1';
const MAX = 200;

function defaultStorage() {
  try { return globalThis.localStorage ?? null; } catch { return null; }   // blocked storage throws on access
}

export function createHistoryStore(storage = defaultStorage()) {
  function read() {
    if (!storage) return [];
    try {
      const data = JSON.parse(storage.getItem(KEY) ?? 'null');
      if (data?.version !== 1 || !Array.isArray(data.sessions)) return [];
      return data.sessions.filter((s) => typeof s?.sessionId === 'string' && s.sessionId);
    } catch { return []; }
  }
  function write(sessions) {
    if (!storage) return false;
    try { storage.setItem(KEY, JSON.stringify({ version: 1, sessions: sessions.slice(-MAX) })); return true; } catch { return false; }
  }
  return {
    /** false when the browser does not allow storage (the dashboard then explains why it is empty) */
    get available() { return Boolean(storage); },
    list: () => read(),
    /** Record one saved MIRROR session (idempotent). */
    add(sessionId, savedAt = new Date()) {
      if (typeof sessionId !== 'string' || !sessionId) return false;
      const sessions = read();
      if (sessions.some((s) => s.sessionId === sessionId)) return true;
      return write([...sessions, { sessionId, savedAt: savedAt.toISOString() }]);
    }
  };
}
