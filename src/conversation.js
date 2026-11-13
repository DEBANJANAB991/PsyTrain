import { buildLipsync } from './lipsync.js';
// served from public/ as a real file: Vite would inline a small worklet as a data: URL, which some browsers refuse
const micWorkletUrl = '/worklets/mic-worklet.js';
const ECHO_TAIL_SECONDS = 0.6;

/**
 * Live voice conversation with the ElevenLabs patient agent (ai-patient-voice/: Mary Keller's prompt, voice,
 * speech recognition and turn-taking all live in that agent).
 *
 *   const conv = new LiveConversation(head);
 *   conv.on('student', (text) => ...);  conv.on('patient', (text) => ...);
 *   await conv.start();   // needs a user gesture (microphone + audio)
 *   conv.stop();
 *
 * The server hands out a one-time signed WebSocket URL (/api/voice/agent-session, key stays on the server).
 * Microphone audio goes up as 16 kHz PCM; her speech comes back as PCM chunks with per-character timings,
 * which are played through TalkingHead's audio graph with our own lip-sync (lipsync.js) on the avatar.
 *
 * Events: status (string), student (text), patient (text), correction (text), interruption, ended ({ reason }), error (Error).
 */
export class LiveConversation {
  /** patient / situation: the landing-page choice (keys of PATIENT_OPTIONS / SITUATIONS in cases.js). */
  constructor(head, { patient = null, situation = null } = {}) {
    this.head = head;
    this.patient = patient;
    this.situation = situation;
    this.ws = null;
    this.listeners = {};
    this.player = new StreamPlayer(head);
    this.state = 'idle';            // idle | connecting | live
    // false (speakers): the mic sends silence while she speaks, so her voice is not heard as the student's turn;
    // you cannot interrupt her then. true (headphones): the mic stays open. Same as ai-patient-voice/talk.py.
    this.headphones = false;
  }

  /** The mic is gated: she is speaking (or just stopped; covers the speaker buffer and room echo). */
  get micMuted() { return !this.headphones && this.head.audioCtx.currentTime < this.player.next + ECHO_TAIL_SECONDS; }

  on(name, fn) { (this.listeners[name] ||= new Set()).add(fn); return () => this.listeners[name].delete(fn); }
  emit(name, data) { this.listeners[name]?.forEach((fn) => { try { fn(data); } catch (e) { console.error(e); } }); }
  _status(s) { this.state = s; this.emit('status', s); }

  get active() { return this.state !== 'idle'; }
  get speaking() { return this.player.playing; }

  /** Microphone loudness 0..1 (RMS, scaled so normal speech reaches about 0.5 to 1); 0 when the mic is off. */
  get micLevel() {
    const a = this.micAnalyser;
    if (!a) return 0;
    const buf = (this._levelBuf ||= new Float32Array(a.fftSize));
    a.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    return Math.min(1, Math.sqrt(sum / buf.length) * 8);
  }

  async start() {
    if (this.active) return;
    this._status('connecting');
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('microphone not available (needs https or localhost)');
      const ctx = this.head.audioCtx;
      await ctx.resume();
      // ask for the microphone first: if it is refused there is no point in opening a session
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });

      // the selected patient (avatar) and situation pick the voice, the opener and the person the orchestrator plays
      const q = new URLSearchParams();
      if (this.patient) q.set('patient', this.patient);
      if (this.situation) q.set('situation', this.situation);
      const r = await fetch(`/api/voice/agent-session?${q}`, { cache: 'no-store' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `could not start the conversation (${r.status})`);
      this.who = j.name || null;

      this.dropUpTo = -1;
      this.session = 'web-' + crypto.randomUUID();
      this.emit('session', this.session);
      this.responseId = null;
      this.responseMs = 0;
      const ws = new WebSocket(j.signed_url);
      this.ws = ws;
      await new Promise((resolve, reject) => {
        ws.onopen = resolve;
        ws.onerror = () => reject(new Error('could not connect to the ElevenLabs agent'));
      });
      ws.onerror = () => this.emit('error', new Error('connection error'));
      ws.onclose = (e) => this._end(e.reason || (e.code === 1000 ? 'conversation ended' : `connection closed (${e.code})`));
      ws.onmessage = (e) => { try { this._onMessage(JSON.parse(e.data)); } catch (err) { console.warn('[conversation] bad message', err); } };
      // the orchestrator (server/orchestrator.js) keeps mode + memory per session; this id links its calls to us
      ws.send(JSON.stringify({
        type: 'conversation_initiation_client_data',
        custom_llm_extra_body: { session: this.session, patient: j.patient, situation: j.situation },
        ...(j.overrides ? { conversation_config_override: j.overrides } : {})
      }));
    } catch (e) {
      this._end(null);
      throw e;
    }
  }

  stop() {
    if (!this.active) return;
    try { this.ws?.close(1000, 'ended by the user'); } catch { /* already closed */ }
    this._end('ended by you');
  }

  _end(reason) {
    if (this.state === 'idle') return;
    this.player.stop();
    this.micNode?.disconnect(); this.micSource?.disconnect(); this.micSink?.disconnect(); this.micAnalyser?.disconnect();
    this.micNode = this.micSource = this.micSink = this.micAnalyser = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (this.ws) { this.ws.onclose = this.ws.onmessage = this.ws.onerror = null; this.ws = null; }
    this._status('idle');
    if (reason) this.emit('ended', { reason });
  }

  _send(obj) { if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj)); }

  async _startMic(rate) {
    const ctx = this.head.audioCtx;
    if (this.micModuleCtx !== ctx) {               // once per audio context
      await ctx.audioWorklet.addModule(micWorkletUrl);
      this.micModuleCtx = ctx;
    }
    if (!this.stream) return;                      // ended while loading
    this.micSource = ctx.createMediaStreamSource(this.stream);
    this.micNode = new AudioWorkletNode(ctx, 'psytrain-mic', { processorOptions: { targetRate: rate, chunkMs: 100 } });
    // silence instead of dropping chunks, so the agent's audio stream stays continuous
    this.micNode.port.onmessage = (e) => {
      const bytes = this.micMuted ? new Uint8Array(e.data.byteLength) : new Uint8Array(e.data);
      this._send({ user_audio_chunk: bytesToBase64(bytes) });
    };
    // a silent sink keeps the worklet running without sending the microphone to the speakers
    this.micSink = ctx.createGain();
    this.micSink.gain.value = 0;
    this.micSource.connect(this.micNode).connect(this.micSink).connect(ctx.destination);
    // loudness for the talk dock's mic meter (talk-ui.js)
    this.micAnalyser = ctx.createAnalyser();
    this.micAnalyser.fftSize = 1024;
    this.micSource.connect(this.micAnalyser);
  }

  _onMessage(m) {
    switch (m.type) {
      case 'conversation_initiation_metadata': {
        const meta = m.conversation_initiation_metadata_event || {};
        this.conversationId = meta.conversation_id;
        this.outRate = pcmRate(meta.agent_output_audio_format);
        const inRate = pcmRate(meta.user_input_audio_format);
        if (!this.outRate || !inRate) {
          this.emit('error', new Error(`unsupported audio format (${meta.agent_output_audio_format} / ${meta.user_input_audio_format}); set pcm_16000 in ai-patient-voice/agent_config.py`));
          return this.stop();
        }
        this._startMic(inRate).then(() => this._status('live')).catch((e) => { this.emit('error', e); this.stop(); });
        break;
      }
      case 'ping':
        this._send({ type: 'pong', event_id: m.ping_event?.event_id });
        break;
      case 'audio': {
        const ev = m.audio_event || {};
        if (!ev.audio_base_64 || ev.event_id <= this.dropUpTo) break;
        const fresh = ev.event_id !== this.responseId;
        if (fresh) { this.responseId = ev.event_id; this.responseMs = 0; }
        const pcm = new Int16Array(base64ToBytes(ev.audio_base_64).buffer);
        const ms = (pcm.length / this.outRate) * 1000;
        const timing = alignmentWords(ev.alignment, ms, this.responseMs);
        this.responseMs += ms;
        const startAt = this.player.push(pcm, this.outRate, timing);
        // first audio of a new answer: tell listeners when it will actually be heard (gestures start with the words)
        if (fresh && startAt != null) this.emit('speechstart', { delayMs: Math.max(0, (startAt - this.head.audioCtx.currentTime) * 1000) });
        break;
      }
      case 'agent_response':
        this.emit('patient', m.agent_response_event?.agent_response || '');
        break;
      case 'agent_response_correction':
        this.emit('correction', m.agent_response_correction_event?.corrected_agent_response || '');
        break;
      case 'user_transcript':
        this.emit('student', m.user_transcription_event?.user_transcript || '');
        break;
      case 'interruption':
        this.dropUpTo = m.interruption_event?.event_id ?? this.dropUpTo;
        this.player.stop();
        this.emit('interruption');
        break;
      case 'client_tool_call':
        // the patient agent has no client tools; answer so it does not wait
        this._send({ type: 'client_tool_result', tool_call_id: m.client_tool_call?.tool_call_id, result: 'not available', is_error: true });
        break;
      case 'error':
        this.emit('error', new Error(m.error_event?.message || m.message || 'agent error'));
        break;
      default: break;                 // vad_score, agent_response_metadata, ... not needed here
    }
  }
}

/**
 * Plays PCM chunks back to back on TalkingHead's audio graph and schedules the matching mouth animation
 * (visemes from the word timings + jaw from the loudness) on the avatar's animation clock.
 */
class StreamPlayer {
  constructor(head) { this.head = head; this.sources = new Set(); this.next = 0; }

  get playing() { return this.head.audioCtx.currentTime < this.next; }

  push(pcm, rate, timing) {
    const head = this.head, ctx = head.audioCtx;
    if (!pcm.length) return;
    const buf = ctx.createBuffer(1, pcm.length, rate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) d[i] = pcm[i] / 32768;

    const now = ctx.currentTime;
    if (this.next < now + 0.05) this.next = now + 0.1;     // a small lead so the first chunk is not clipped
    const startAt = this.next;

    let anims = [];
    try { anims = buildLipsync(head, buf, timing); } catch (e) { console.warn('[conversation] lip-sync failed', e); }
    const t0 = head.animClock + (startAt - now) * 1000;
    for (const a of anims) { a.ts = a.ts.map((x) => t0 + x); head.animQueue.push(a); }

    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(head.audioAnalyzerNode);
    src.onended = () => { this.sources.delete(src); src.disconnect(); };
    src.start(startAt);
    this.sources.add(src);
    this.next = startAt + buf.duration;
    return startAt;
  }

  stop() {
    for (const s of this.sources) { try { s.stop(); } catch { /* not started */ } }
    this.sources.clear();
    this.next = 0;
    const h = this.head;
    h.animQueue = h.animQueue.filter((x) => x.template?.name !== 'viseme' && x.template?.name !== 'jaw');
    try { h.resetLips?.(); } catch { /* ignore */ }
  }
}

/**
 * ElevenLabs character alignment of one audio chunk -> TalkingHead word timings (ms from the chunk start).
 * Times are normally relative to the chunk; if they run past the chunk they are taken as relative to the
 * whole response and shifted by the audio already played (`offsetMs`).
 */
function alignmentWords(al, chunkMs, offsetMs) {
  const chars = al?.chars, st = al?.char_start_times_ms, du = al?.char_durations_ms;
  const words = [], wtimes = [], wdurations = [];
  if (!chars?.length || !st?.length || !du?.length) return { words, wtimes, wdurations };
  const shift = st[0] > chunkMs ? offsetMs : 0;
  let cur = '', s = 0, e = 0;
  const flush = () => {
    if (cur) { words.push(cur); wtimes.push(Math.max(0, s - shift)); wdurations.push(Math.max(40, e - s)); }
    cur = '';
  };
  for (let i = 0; i < chars.length; i++) {
    if (/\s/.test(chars[i])) flush();
    else { if (!cur) s = st[i]; cur += chars[i]; e = st[i] + (du[i] || 0); }
  }
  flush();
  return { words, wtimes, wdurations };
}

const pcmRate = (fmt) => { const m = /^pcm_(\d+)$/.exec(fmt || 'pcm_16000'); return m ? Number(m[1]) : null; };

function base64ToBytes(b64) {
  const bin = atob(b64), n = bin.length & ~1;        // 16-bit samples: an odd trailing byte is dropped
  const u = new Uint8Array(n);
  for (let i = 0; i < n; i++) u[i] = bin.charCodeAt(i);
  return u;
}

function bytesToBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
