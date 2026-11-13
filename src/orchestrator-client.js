/**
 * Browser side of the orchestrator (server/orchestrator.js). While a conversation runs it listens to
 * /api/orchestrator/events (server-sent events; polling /api/orchestrator/state as a fallback) and reports:
 *
 *   const watch = new ModeWatcher(conversation);
 *   watch.on('mode', ({ mode, reason, by }) => ...);           // the body mode of the current answer
 *   watch.on('cue', ({ state, gesture, gaze, mode }) => ...);  // the body cue of the next answer
 *
 * Both are decided BEFORE the answer is spoken (the cue arrives with the first words, before ElevenLabs has turned
 * them into audio), so the body can move with the voice instead of after it.
 */
const POLL_MS = 400;

export class ModeWatcher {
  constructor(conversation) {
    this.conversation = conversation;
    this.listeners = {};
    this.mode = 'normal';
    this.seq = 0;
    this.cueSeq = 0;
    this.state = null;
    conversation.on('session', (id) => this._start(id));
    conversation.on('status', (s) => { if (s === 'idle') this._stop(); });
  }

  on(name, fn) { (this.listeners[name] ||= new Set()).add(fn); return () => this.listeners[name].delete(fn); }
  emit(name, data) { this.listeners[name]?.forEach((fn) => { try { fn(data); } catch (e) { console.error(e); } }); }

  _start(id) {
    this._stop();
    this.session = id;
    this.seq = 0;
    this.cueSeq = 0;
    if (this.mode !== 'normal') { this.mode = 'normal'; this.emit('mode', { mode: 'normal', reason: 'new conversation', by: 'start' }); }
    const url = `/api/orchestrator/events?session=${encodeURIComponent(id)}`;
    if (typeof EventSource === 'function') {
      this.es = new EventSource(url);
      this.es.onmessage = (e) => { try { this._handle(JSON.parse(e.data)); } catch { /* bad message */ } };
      // the browser reconnects on its own; poll meanwhile so nothing is missed
      this.es.onerror = () => { if (!this.timer) this.timer = setInterval(() => this._poll(), POLL_MS); };
      this.es.onopen = () => { clearInterval(this.timer); this.timer = null; };
    } else {
      this.timer = setInterval(() => this._poll(), POLL_MS);
    }
  }

  _stop() {
    clearInterval(this.timer); this.timer = null;
    this.es?.close(); this.es = null;
  }

  async _poll() {
    if (this.busy) return;
    this.busy = true;
    try {
      const r = await fetch(`/api/orchestrator/state?session=${encodeURIComponent(this.session)}`, { cache: 'no-store' });
      if (r.ok) this._handle(await r.json());
    } catch { /* offline for a moment */ }
    finally { this.busy = false; }
  }

  _handle(s) {
    if (!s?.active || s.session !== this.session) return;
    this.state = s;
    if (s.seq !== this.seq) {
      this.seq = s.seq;
      const last = s.events?.at(-1);
      // the body follows the mode of the current answer: a risk question is answered directly (normal)
      // even while the session's mode stays distracted / aggressive
      const body = s.answerMode || s.mode;
      if (body !== this.mode) {
        this.mode = body;
        const risk = body !== s.mode;
        this.emit('mode', {
          mode: body, sessionMode: s.mode,
          reason: risk ? `risk question, answered directly (mode stays ${s.mode})` : last?.reason || s.reason,
          by: risk ? 'risk' : last?.by || 'orchestrator'
        });
      }
    }
    if (s.cue && s.cue.seq !== this.cueSeq) {
      this.cueSeq = s.cue.seq;
      this.emit('cue', s.cue);
    }
    this.emit('state', s);
  }
}
