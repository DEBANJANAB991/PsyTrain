/**
 * Voice: text -> speech audio + timings -> TalkingHead lip-sync.
 *
 *   voice.speak('I have had this pain for three days.')
 *
 * With an ElevenLabs key on the server (see .env.example) the audio and per-character timestamps come from
 * the ElevenLabs "with-timestamps" API through /api/voice/speak. Without a key a built-in DEMO voice
 * (synthetic buzz, timed from the text) is used, so the whole mouth pipeline can still be tested.
 *
 * Lip-sync: TalkingHead's speakAudio() takes the audio plus word timings and turns each word into visemes
 * (mouth shapes) scheduled over that word's real time span.
 */

/** ElevenLabs character alignment -> word list with times in milliseconds (TalkingHead's format). */
export function alignmentToWords(al) {
  const chars = al?.characters, st = al?.character_start_times_seconds, en = al?.character_end_times_seconds;
  const words = [], wtimes = [], wdurations = [];
  if (!chars || !st || !en) return { words, wtimes, wdurations };
  let cur = '', s = 0, e = 0;
  const flush = () => {
    if (cur) { words.push(cur); wtimes.push(Math.round(s * 1000)); wdurations.push(Math.max(40, Math.round((e - s) * 1000))); }
    cur = '';
  };
  for (let i = 0; i < chars.length; i++) {
    if (/\s/.test(chars[i])) flush();
    else { if (!cur) s = st[i]; cur += chars[i]; e = en[i]; }
  }
  flush();
  return { words, wtimes, wdurations };
}

const b64ToArrayBuffer = (b64) => {
  const bin = atob(b64), n = bin.length, u = new Uint8Array(n);
  for (let i = 0; i < n; i++) u[i] = bin.charCodeAt(i);
  return u.buffer;
};

export class Voice {
  constructor(head, affect) {
    this.head = head;
    this.affect = affect;
    this.status = { checked: false, configured: false, voiceId: null, model: null };
    this.last = null;           // info about the last utterance
    this.busyUntil = 0;
  }

  async checkStatus() {
    try {
      const r = await fetch('/api/voice/status', { cache: 'no-store' });
      if (r.ok) this.status = { checked: true, ...(await r.json()) };
    } catch { /* offline / no server: demo voice */ }
    this.status.checked = true;
    return this.status;
  }

  get speaking() { return Boolean(this.head.isSpeaking) || performance.now() < this.busyUntil; }

  /** Speak `text`. mode: 'auto' (ElevenLabs if configured, else demo) | 'elevenlabs' | 'demo'. */
  async speak(text, { voiceId, mode = 'auto' } = {}) {
    text = String(text ?? '').trim();
    if (!text) return null;
    if (!this.status.checked) await this.checkStatus();
    const useEleven = mode === 'elevenlabs' || (mode === 'auto' && this.status.configured);

    const ctx = this.head.audioCtx;
    await ctx.resume();           // needs a user gesture the first time (the Speak button is one)

    let buffer, timing, source;
    if (useEleven) {
      const r = await fetch('/api/voice/speak', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, voiceId })
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `voice server error ${r.status}`);
      buffer = await ctx.decodeAudioData(b64ToArrayBuffer(j.audio_base64));
      timing = alignmentToWords(j.alignment);
      if (!timing.words.length) timing = evenWords(text, buffer.duration * 1000);   // no alignment returned
      source = 'elevenlabs';
    } else {
      ({ buffer, timing } = synthDemo(ctx, text));
      source = 'demo';
    }

    this.affect?.gaze?.lookAtStudent();         // she answers looking at the doctor
    this.head.speakAudio({ audio: buffer, ...timing }, { lipsyncLang: 'en' });
    this.busyUntil = performance.now() + buffer.duration * 1000 + 500;
    this.last = { text, source, seconds: +buffer.duration.toFixed(2), words: timing.words.length };
    return this.last;
  }

  stop() {
    this.busyUntil = 0;
    try { this.head.stopSpeaking(); } catch { /* nothing playing */ }
  }
}

/** Fallback when no alignment is available: spread the words over the audio by letter count. */
function evenWords(text, totalMs) {
  const words = text.split(/\s+/).filter(Boolean);
  const letters = words.reduce((a, w) => a + w.length, 0) || 1;
  let t = 0; const wtimes = [], wdurations = [];
  for (const w of words) { const d = (w.length / letters) * totalMs; wtimes.push(Math.round(t)); wdurations.push(Math.round(d * 0.9)); t += d; }
  return { words, wtimes, wdurations };
}

/**
 * DEMO voice: a robotic vowel-ish buzz (no ElevenLabs key needed). Each word gets a duration from its length,
 * with pauses after commas / full stops, so the mouth has real timings to follow.
 */
function synthDemo(ctx, text) {
  const sr = ctx.sampleRate;
  const words = text.split(/\s+/).filter(Boolean);
  const plan = []; let t = 0.15;
  for (const w of words) {
    const letters = w.replace(/[^A-Za-z]/g, '').length;
    const dur = Math.min(0.75, Math.max(0.14, 0.065 * letters + 0.07));
    plan.push({ w, start: t, dur, letters });
    t += dur + (/[,;:]$/.test(w) ? 0.22 : /[.!?]$/.test(w) ? 0.4 : 0.06);
  }
  const total = t + 0.2;
  const buf = ctx.createBuffer(1, Math.ceil(total * sr), sr);
  const d = buf.getChannelData(0);
  let phase = 0;
  for (const p of plan) {
    const n0 = Math.floor(p.start * sr), n = Math.floor(p.dur * sr);
    const f0base = 105 + (p.w.length % 5) * 8;
    for (let i = 0; i < n; i++) {
      const x = i / n;
      const env = Math.min(1, x * 12) * Math.min(1, (1 - x) * 10) * (0.6 + 0.4 * Math.sin(x * Math.PI * Math.max(1, p.letters / 2.5)));
      const f0 = f0base * (1 + 0.08 * Math.sin(x * 3.1));
      phase += (2 * Math.PI * f0) / sr;
      let s = 0;
      for (let k = 1; k <= 9; k++) s += Math.sin(phase * k) / k;          // glottal-ish harmonics
      s += (Math.random() - 0.5) * 0.25 * (x < 0.15 ? 1 : 0.2);           // a little consonant noise
      d[n0 + i] = s * env * 0.16;
    }
  }
  const timing = { words: plan.map((p) => p.w), wtimes: plan.map((p) => Math.round(p.start * 1000)), wdurations: plan.map((p) => Math.round(p.dur * 1000)) };
  return { buffer: buf, timing };
}
