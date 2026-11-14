/**
 * Orchestrator: the brain behind the voice patient.
 *
 * ElevenLabs keeps the ears (speech recognition), turn-taking and the voice, but for every answer it calls this
 * server as its "custom LLM" (OpenAI Chat Completions format, streamed). Each call:
 *
 *   1. mode decision   "Bingo" in the student's words toggles the mode; otherwise a fast model (Haiku) decides
 *                      normal / distracted with prompts/orchestrator.txt. Meanwhile the answer in the current mode
 *                      is already being generated, and is used if the mode stays the same.
 *   2. answer          Sonnet writes the patient's answer with prompts/<situation>/guardrails.txt + <mode>.txt + the memory,
 *                      streamed straight back to ElevenLabs, which speaks it.
 *   3. memory          after the answer, a fast model updates the running summary (prompts/memory.txt).
 *
 * Routes:
 *   POST /api/llm/v1/chat/completions   called by ElevenLabs (Authorization: Bearer ORCHESTRATOR_TOKEN)
 *   GET  /api/orchestrator/state?session=<id>   mode, why it changed, memory: polled by the browser for the body
 *        language and the debug label
 *
 * The browser starts each conversation with a random session id (custom_llm_extra_body.session), so several
 * conversations can run at once. Prompts are read from ai-patient-voice/prompts/ on every call: edit and talk.
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { loadEnv } from 'vite';
import { resolveProvider, llmClient } from './agent.js';
import { modeStates, CONVERSATION_STATES } from '../shared/agent-tools.js';

const MAX_BODY = 600_000;
const KEEP_MESSAGES = 16;          // recent turns sent verbatim; the memory summary covers the rest
const MAX_SESSIONS = 200;
const FIRST_TOKEN_MS = 12_000;
const ANSWER_MS = 40_000;
const DECIDE_MS = 6_000;           // the mode decision must not hold up her answer for longer than this
const MAX_TURN_CHARS = 4_000;      // one turn of the conversation, as sent to the models
const SESSION_RE = /^[A-Za-z0-9_-]{6,80}$/;
const BINGO_RE = /\bbingo\b/i;
const KEY_RE = /^[a-z0-9-]{2,40}$/;
/**
 * Backstop for the decision model's `risk` flag: a question about suicide, self-harm or harming others is answered
 * directly (normal prompt) even if the decision call fails, times out, misses it, or the turn was a "Bingo".
 * False positives only mean one plain answer, so this errs on the wide side.
 */
export const RISK_RE = new RegExp([
  'suicid\\w*', 'self[- ]?harm\\w*', 'kill(ing)? (yourself|myself|himself|herself|someone|anyone|somebody)',
  '(end|take|ending|taking) (your|my|his|her) (own )?life', '(want|wanted|wish|wished|wanting) (to be|you were|you were) dead',
  'better off dead', "(don'?t|not|no longer) (want(ing)? to|wish to) (live|be alive|be here|wake up)",
  "(didn'?t|not|never) wake up", "life('?s| is) not worth", "life isn'?t worth", 'thoughts? (of|about) (death|dying)',
  '(hurt|harm|hurting|harming) (yourself|others|other people|someone|anyone|somebody)', '(cut|cutting) yourself',
  'overdose'
].map((x) => `\\b${x}\\b`).join('|'), 'i');

/** The decision tool for a session: normal or the situation's behaviour mode (e.g. distracted). */
const decideTool = (modes) => ({
  name: 'decide_mode',
  description: 'Set the mode the patient answers the therapist\'s latest words in.',
  input_schema: {
    type: 'object',
    properties: {
      mode: { type: 'string', enum: modes },
      intervention: { type: 'boolean', description: 'true if the therapist\'s latest words are an intervention as defined in your rules (bringing the patient back / de-escalating)' },
      brusque: { type: 'boolean', description: 'true if the therapist\'s latest words are brusque, reproachful, lecturing or arguing' },
      risk: { type: 'boolean', description: 'true if the therapist\'s latest words ask about suicide, wanting to be dead, self-harm or harming others' },
      reason: { type: 'string', description: 'one short sentence for the debug log' }
    },
    required: ['mode', 'intervention', 'brusque', 'risk', 'reason'],
    additionalProperties: false
  }
});

const GESTURES = ['nod', 'shake', 'shrug'];
const GAZES = ['student', 'away', 'down'];

/** "[[body state=uneasy gesture=shrug gaze=down]]" -> { state, gesture, gaze }, limited to what fits the mode. */
function parseCue(tag, states) {
  const kv = Object.fromEntries([...tag.matchAll(/(\w+)\s*=\s*"?([\w-]+)"?/g)].map((m) => [m[1].toLowerCase(), m[2].toLowerCase()]));
  return {
    state: states.includes(kv.state) ? kv.state : states[0],
    gesture: GESTURES.includes(kv.gesture) ? kv.gesture : null,
    gaze: GAZES.includes(kv.gaze) ? kv.gaze : null
  };
}

/** {{key}} -> vars[key]; unknown placeholders are left as they are, so a typo is visible in the prompt. */
const fill = (text, vars) => text.replace(/\{\{(\w+)\}\}/g, (m, k) => (vars[k] !== undefined ? vars[k] : m));

function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = '', tooBig = false;
    // past the limit: stop collecting and answer 400 (the reply closes the connection, see send*); destroying
    // the socket here would leave the caller with a dropped connection instead of an error
    req.on('data', (c) => { if (tooBig) return; data += c; if (data.length > MAX_BODY) { tooBig = true; data = ''; reject(new Error('body too large')); } });
    req.on('end', () => { if (tooBig) return; try { resolve(JSON.parse(data || '{}')); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

function sendJson(res, status, obj) {
  res.statusCode = status;
  if (!res.req?.complete) res.setHeader('Connection', 'close');     // an unread (too large) body is not drained
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(obj));
}

const textOf = (content) => typeof content === 'string' ? content
  : Array.isArray(content) ? content.map((p) => (typeof p === 'string' ? p : p?.text || '')).join('') : '';

/** OpenAI-style history from ElevenLabs -> Anthropic messages: their system prompt dropped, roles alternating, user first and last. */
function toAnthropic(messages) {
  const out = [];
  for (const m of messages || []) {
    if (m?.role !== 'user' && m?.role !== 'assistant') continue;
    const text = textOf(m.content).trim().slice(0, MAX_TURN_CHARS);
    if (!text) continue;
    const last = out[out.length - 1];
    if (last && last.role === m.role) last.content += '\n' + text;
    else out.push({ role: m.role, content: text });
  }
  if (out[0]?.role !== 'user') out.unshift({ role: 'user', content: '(The therapist welcomes the patient into the room.)' });
  if (out[out.length - 1].role !== 'user') out.push({ role: 'user', content: '(The therapist is quiet for a moment.)' });
  // keep the recent part; it must still start with a user turn
  let recent = out.slice(-KEEP_MESSAGES);
  if (recent[0].role !== 'user') recent = recent.slice(1);
  return recent;
}

const EMOJI_RE = /\p{Extended_Pictographic}|\p{Emoji_Modifier}|\uFE0F|\u200D/gu;
const MAX_SPAN = 200;

/**
 * Last guardrail before ElevenLabs speaks: removes what the prompts forbid but a model may still write, across
 * stream-chunk boundaries: body cues and other bracketed text ([[body ...]], [sighs]), *stage directions* and
 * **markdown**, emojis. An opener that is not closed within MAX_SPAN characters was not markup: its text is kept.
 *   const f = speechFilter(); f.push(chunk) -> speakable text so far; f.end() -> whatever was still held back
 */
export function speechFilter() {
  let held = '', open = null, depth = 0, lastSpace = false;
  // one space where a removed span sat between two
  const keep = (t) => { let o = ''; for (const c of t.replace(EMOJI_RE, '')) { const sp = c === ' '; if (sp && lastSpace) continue; lastSpace = sp; o += c; } return o; };
  const release = () => { const t = keep(held.replace(/[*\[\]]/g, '')); held = ''; open = null; depth = 0; return t; };
  return {
    push(text) {
      let out = '';
      for (const ch of String(text || '')) {
        if (!open) {
          if (ch === '*') { open = '*'; held = ch; }
          else if (ch === '[') { open = '['; depth = 1; held = ch; }
          else if (ch !== ']') out += keep(ch);
          continue;
        }
        held += ch;
        if (open === '*' && ch === '*') { held = ''; open = null; }
        else if (open === '[' && ch === '[') depth++;
        else if (open === '[' && ch === ']' && --depth === 0) { held = ''; open = null; }
        else if (held.length > MAX_SPAN) out += release();
      }
      return out;
    },
    end() { return release(); }
  };
}

const transcript = (msgs, n, who = 'Patient') => msgs.slice(-n).map((m) => `${m.role === 'user' ? 'Therapist' : who}: ${m.content}`).join('\n');

/**
 * @param {object} [opts]  for tests: `llmClient(cfg, model)` replaces the SDK client factory,
 *                         `timeouts: { decide, firstToken, answer }` (ms) replace the defaults above
 */
export function orchestrator(opts = {}) {
  const makeClient = opts.llmClient || llmClient;
  const T = { decide: DECIDE_MS, firstToken: FIRST_TOKEN_MS, answer: ANSWER_MS, ...opts.timeouts };
  let env = {}, mode = 'development', root = process.cwd();
  const sessions = new Map();

  const settings = () => {
    let voiceEnv = {};
    try { voiceEnv = loadEnv(mode, path.join(root, 'ai-patient-voice'), ''); } catch { /* none */ }
    const cfg = resolveProvider(env);
    return {
      cfg,
      token: env.ORCHESTRATOR_TOKEN || voiceEnv.ORCHESTRATOR_TOKEN || '',
      // her words: the director's model by default; the decisions and the memory: a fast model
      patientModel: env.PATIENT_MODEL || (cfg.provider === 'bedrock' ? cfg.model : 'claude-sonnet-4-6'),
      fastModel: env.ORCHESTRATOR_MODEL || (cfg.provider === 'bedrock' ? 'global.anthropic.claude-haiku-4-5-20251001-v1:0' : 'claude-haiku-4-5')
    };
  };

  const promptsDir = () => path.join(root, 'ai-patient-voice', 'prompts');
  const personas = () => JSON.parse(fs.readFileSync(path.join(promptsDir(), 'personas.json'), 'utf8'));

  /** prompts/<situation>/<name>.txt with the session's persona filled in (read on every call: edit and talk). */
  const prompt = (s, name) => fill(fs.readFileSync(path.join(promptsDir(), s.situation, `${name}.txt`), 'utf8').trim(), s.vars);

  /** Who the patient is for a landing-page choice (personas.json); unknown or missing keys fall back to the first entries. */
  const resolvePersona = (extra = {}) => {
    const P = personas();
    const patientKey = KEY_RE.test(extra.patient || '') && P.patients[extra.patient] ? extra.patient : Object.keys(P.patients)[0];
    const situation = KEY_RE.test(extra.situation || '') && P.situations[extra.situation] ? extra.situation : Object.keys(P.situations)[0];
    const pat = P.patients[patientKey], sit = P.situations[situation];
    const man = pat.gender === 'man';
    const person = sit.personas[pat.gender] || Object.values(sit.personas)[0];
    return {
      patient: patientKey, situation, behavior: sit.mode, brusqueEndsMode: Boolean(sit.brusque_ends_mode),
      vars: {
        about: '', ...person, ...(pat.about ? { about: pat.about } : {}),
        she: man ? 'he' : 'she', her: man ? 'him' : 'her', hers: man ? 'his' : 'her', She: man ? 'He' : 'She'
      }
    };
  };

  const session = (id, extra) => {
    let s = sessions.get(id);
    if (!s) {
      s = { id, ...resolvePersona(extra), mode: 'normal', since: Date.now(), turns: 0, turnsInMode: 0, interventions: 0, summary: '', reason: 'session start', seq: 0, events: [], memoryBusy: Promise.resolve(), lastDecision: null };
      s.modes = ['normal', s.behavior];
      console.log(`[orchestrator] ${id.slice(0, 12)} new session: ${s.vars.name} (${s.patient}, ${s.situation})`);
      sessions.set(id, s);
      if (sessions.size > MAX_SESSIONS) sessions.delete(sessions.keys().next().value);
    }
    return s;
  };

  /** What the browser sees of a session (state endpoint and event stream). */
  const stateOf = (s) => ({
    session: s.id, active: true, mode: s.mode, answerMode: s.answerMode || s.mode, behavior: s.behavior, patient: s.patient,
    situation: s.situation, name: s.vars.name, seq: s.seq, reason: s.reason, turns: s.turns, interventions: s.interventions,
    cue: s.cue || null, lastDecision: s.lastDecision, events: s.events.slice(-10), summary: s.summary, lastError: s.lastError || null
  });

  const subscribers = new Map();      // session id -> Set of open event-stream responses
  const publish = (s) => {
    const set = subscribers.get(s.id);
    if (!set?.size) return;
    const msg = `data: ${JSON.stringify(stateOf(s))}\n\n`;
    for (const r of set) { try { r.write(msg); } catch { /* closed */ } }
  };

  const setMode = (s, next, reason, by) => {
    if (next === s.mode) return false;
    s.events.push({ at: Date.now(), from: s.mode, to: next, reason, by, turn: s.turns });
    if (s.events.length > 30) s.events.shift();
    s.mode = next; s.turnsInMode = 0; s.seq++;
    if (next === s.behavior) s.interventions = 0;
    console.log(`[orchestrator] ${s.id.slice(0, 8)} ${s.events.at(-1).from} -> ${next} (${by}): ${reason}`);
    return true;
  };

  /** A few things from prompts/distractions.txt, picked once per session, so each conversation drifts differently. */
  const todaysDistractions = (s) => {
    if (!s.distractions) {
      let pool = [];
      try { pool = prompt(s, 'distractions').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')); } catch { /* optional file */ }
      for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
      s.distractions = pool.slice(0, 5);
    }
    return s.distractions;
  };

  /** prompts/body.txt (shared by all situations), with the body states that fit this answer's mode. */
  const bodyPrompt = (s, m) => {
    try {
      const states = modeStates(m, s.situation).map((x) => `  - ${x}: ${CONVERSATION_STATES[x]?.what || x}`).join('\n');
      return fill(fs.readFileSync(path.join(promptsDir(), 'body.txt'), 'utf8').trim(), { ...s.vars, states });
    } catch { return ''; }
  };

  const systemFor = (s, m) => [
    prompt(s, 'guardrails'),
    prompt(s, m),
    bodyPrompt(s, m),
    m !== 'normal' && todaysDistractions(s).length
      ? `# WHAT CATCHES YOUR ATTENTION TODAY (prefer these for your tangents, roughly in this order; anything else from YOUR LIFE is fine too)\n${todaysDistractions(s).map((d) => '- ' + d).join('\n')}`
      : '',
    `# MEMORY OF THIS CONVERSATION (summary of everything so far; stay consistent with it)\n${s.summary || 'The conversation has just started.'}`
  ].filter(Boolean).join('\n\n');

  /** Fast model: which mode for the next answer? */
  async function decide(st, s, msgs, student) {
    const recentEvents = s.events.slice(-4).map((e) => `${e.from} -> ${e.to} at answer ${e.turn} (${e.by === 'bingo' ? 'forced by the trainer, not something the patient did' : e.reason})`).join('; ') || 'none';
    const content = [
      `Current mode: ${s.mode} (for the last ${s.turnsInMode} of the patient's answers). Answers so far: ${s.turns}.`,
      s.mode !== 'normal' ? `Interventions by the therapist since this ${s.mode} mode began: ${s.interventions}.` : '',
      `Earlier mode changes: ${recentEvents}.`,
      `Memory:\n${s.summary || '(nothing yet)'}`,
      `Recent conversation:\n${transcript(msgs.slice(0, -1), 8, s.vars.first_name) || '(start)'}`,
      `The therapist just said: "${student}"`,
      'Decide the mode for the next answer.'
    ].filter(Boolean).join('\n\n');
    // a decision that takes too long is dropped (the caller keeps the mode); the request itself is aborted
    const ac = new AbortController();
    let timer;
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => { ac.abort(); reject(new Error(`decision timed out after ${T.decide} ms`)); }, T.decide); });
    const r = await Promise.race([
      makeClient(st.cfg, st.fastModel).messages.create({
        model: st.fastModel, max_tokens: 300, system: prompt(s, 'orchestrator'),
        tools: [decideTool(s.modes)], tool_choice: { type: 'tool', name: 'decide_mode' },
        messages: [{ role: 'user', content }]
      }, { signal: ac.signal }),
      timeout
    ]).finally(() => clearTimeout(timer));
    const d = r.content.find((b) => b.type === 'tool_use')?.input;
    if (!d || !s.modes.includes(d.mode)) throw new Error('no valid decision');
    return { mode: d.mode, intervention: Boolean(d.intervention), brusque: Boolean(d.brusque), risk: Boolean(d.risk), reason: String(d.reason || '').slice(0, 300), by: 'orchestrator' };
  }

  /** Start the patient's answer in mode `m`; tokens are buffered until a sink is attached. */
  function startAnswer(st, s, m, msgs) {
    const a = { mode: m, chunks: [], sink: null, text: '', error: null };
    a.stream = makeClient(st.cfg, st.patientModel).messages.stream({
      model: st.patientModel, max_tokens: 400, system: systemFor(s, m), messages: msgs      // (this model takes no temperature)
    });
    a.started = Date.now();
    // a stalled stream must not leave her silent: no first word within FIRST_TOKEN_MS, or not done within ANSWER_MS
    const stall = setTimeout(() => { if (!a.text) { a.timedOut = true; a.abort(); } }, T.firstToken);
    const cap = setTimeout(() => { a.timedOut = true; a.abort(); }, T.answer);
    // the answer starts with a body cue ([[body ...]], prompts/body.txt): hold the first characters until the cue
    // is complete (or clearly absent), publish it, and pass only the spoken words on
    let head = '', headDone = false;
    const speech = speechFilter();
    const say = (t) => emit(speech.push(t));
    const emit = (t) => { if (!a.text) t = t.trimStart(); if (!t) return; if (!a.text) a.firstTokenMs = Date.now() - a.started; a.text += t; if (a.sink) a.sink(t); else a.chunks.push(t); };
    a.stream.on('text', (t) => {
      if (headDone) return say(t);
      head += t;
      const trimmed = head.trimStart();
      const end = trimmed.indexOf(']]');
      if (trimmed.startsWith('[[') && end === -1 && trimmed.length < 200) return;   // cue still arriving
      headDone = true;
      if (trimmed.startsWith('[[') && end !== -1) {
        a.cue = parseCue(trimmed.slice(0, end + 2), modeStates(m, s.situation));
        a.cueMs = Date.now() - a.started;
        a.onCue?.(a.cue);
        say(trimmed.slice(end + 2).trimStart());
      } else say(head);
    });
    a.done = a.stream.finalMessage().then(() => {}, (e) => { a.error = a.timedOut ? new Error(`answer timed out (${a.text ? 'too long' : 'no first word'})`) : e; })
      .finally(() => { clearTimeout(stall); clearTimeout(cap); emit(speech.end()); });   // (an unfinished leading cue is dropped)
    a.abort = () => { try { a.stream.abort(); } catch { /* finished */ } };
    return a;
  }

  /** Memory saver: runs after the answer, one at a time per session. */
  function remember(st, s, student, answer, m) {
    s.memoryBusy = s.memoryBusy.then(async () => {
      const change = s.events.at(-1)?.turn === s.turns - 1 ? `Mode for this answer: ${m} (changed: ${s.events.at(-1).reason}).` : `Mode for this answer: ${m}.`;
      const r = await makeClient(st.cfg, st.fastModel).messages.create({
        model: st.fastModel, max_tokens: 500, system: prompt(s, 'memory'),
        messages: [{ role: 'user', content: `Current summary:\n${s.summary || '(empty)'}\n\n${change}\n\nLatest exchange:\nTherapist: ${student}\n${s.vars.first_name}: ${answer}\n\nWrite the updated summary.` }]
      });
      const text = r.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
      if (text) s.summary = text.slice(0, 3000);
    }).catch((e) => {
      console.warn('[orchestrator] memory update failed:', e.message);
      s.lastError = { at: Date.now(), what: 'memory', message: String(e.message).slice(0, 300) };
    });
  }

  async function completions(req, res) {
    const st = settings();
    const auth = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!st.token) return sendJson(res, 503, { error: 'ORCHESTRATOR_TOKEN is not set (run ai-patient-voice/update_agent.py)' });
    const a = Buffer.from(auth), b = Buffer.from(st.token);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return sendJson(res, 401, { error: 'unauthorized' });
    if (st.cfg.missing) return sendJson(res, 503, { error: `${st.cfg.missing} is not set` });

    let body;
    try { body = await readJson(req); } catch { return sendJson(res, 400, { error: 'bad or too large JSON' }); }
    const sid = body.elevenlabs_extra_body?.session;
    const s = session(typeof sid === 'string' && SESSION_RE.test(sid) ? sid : 'default-session', body.elevenlabs_extra_body);
    const msgs = toAnthropic(body.messages);
    const student = msgs[msgs.length - 1].content;

    // OpenAI Chat Completions stream
    const id = 'chatcmpl-' + randomUUID();
    const created = Math.floor(Date.now() / 1000);
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    const chunk = (delta, finish = null) => res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model: 'psytrain-orchestrator', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
    chunk({ role: 'assistant', content: '' });

    let closed = false, answer = null;
    res.on('close', () => { closed = true; answer?.abort(); });     // ElevenLabs hung up (e.g. the student interrupted)

    const t0 = Date.now();
    // 1. mode decision, with the answer in the current mode already running
    let d;
    if (BINGO_RE.test(student)) {
      d = { mode: s.mode === 'normal' ? s.behavior : 'normal', intervention: false, reason: 'the student said "Bingo"', by: 'bingo' };
    } else {
      answer = startAnswer(st, s, s.mode, msgs);
      try { d = await decide(st, s, msgs, student); }
      catch (e) { d = { mode: s.mode, intervention: false, reason: 'decision failed, kept the mode: ' + e.message.slice(0, 120), by: 'error' }; }
      if (s.mode === s.behavior) {
        if (d.intervention) {
          s.interventions++;
          if (d.mode === s.behavior && s.interventions >= 2) { d.mode = 'normal'; d.reason = 'second intervention: the patient always comes back now'; }
        } else if (d.mode === 'normal' && !(d.brusque && s.brusqueEndsMode)) {
          // the patient only comes back after an intervention (for "distracted" also when the therapist is brusque);
          // "Bingo" is the trainer's override
          d.mode = s.behavior; d.reason = `kept ${s.behavior}: no intervention yet (orchestrator wanted normal: ${d.reason})`;
        }
      }
    }
    if (!d.risk && RISK_RE.test(student)) { d.risk = true; d.riskBy = 'keywords'; }
    const changed = setMode(s, d.mode, d.reason, d.by);
    if (changed || d.by === 'bingo') s.reason = d.reason;
    // a question about suicide, self-harm or harming others is answered directly (normal prompt) in any mode;
    // the mode itself stays, so the behaviour continues with the next question
    const answerMode = d.risk ? 'normal' : s.mode;
    if (answerMode !== (s.answerMode || s.mode) || (s.answerMode && answerMode === s.mode && s.answerMode !== s.mode)) s.seq++;
    s.answerMode = answerMode;
    s.lastDecision = { ...d, answerMode, ms: Date.now() - t0, student: student.slice(0, 200), speculation: answer ? (answer.mode === answerMode ? 'used' : 'discarded') : 'none' };
    if (closed) { answer?.abort(); return; }

    // 2. the answer in the decided mode (reuse the one already running if the mode did not change)
    if (!answer || answer.mode !== answerMode) { answer?.abort(); answer = startAnswer(st, s, answerMode, msgs); }
    const m = answerMode;
    publish(s);                                         // mode (and answer mode) are known: the body can move now
    // the body cue of this answer reaches the browser before ElevenLabs has turned the first words into audio
    const sendCue = (cue) => {
      s.cue = { ...cue, mode: m, seq: (s.cue?.seq || 0) + 1, ms: Date.now() - t0 };
      s.lastDecision.cueMs = s.cue.ms;
      publish(s);
    };
    if (answer.cue) sendCue(answer.cue); else answer.onCue = sendCue;
    for (const c of answer.chunks) chunk({ content: c });
    answer.sink = (t) => { if (!closed) chunk({ content: t }); };
    await answer.done;
    if (answer.error && !closed) {
      console.warn('[orchestrator] answer failed:', answer.error.message);
      s.lastError = { at: Date.now(), what: 'answer', message: String(answer.error.message).slice(0, 300) };
      if (!answer.text) chunk({ content: 'Sorry, what was that?' });         // keep the conversation going, in character
    }
    if (!closed) { chunk({}, 'stop'); res.write('data: [DONE]\n\n'); res.end(); }

    // 3. bookkeeping + memory
    s.lastDecision.firstWordMs = answer.firstTokenMs != null ? answer.firstTokenMs + (answer.started - t0) : null;
    s.turns++; s.turnsInMode++;
    if (answer.text) remember(st, s, student, answer.text, m);
  }

  const handler = async (req, res, next) => {
    const url = (req.url || '').split('?')[0];
    if (req.method === 'POST' && /^\/api\/llm(\/v1)?\/chat\/completions$/.test(url)) {
      try { return await completions(req, res); }
      catch (e) {
        console.error('[orchestrator]', e);
        if (!res.headersSent) return sendJson(res, 500, { error: 'orchestrator failed' });
        try { res.end(); } catch { /* closed */ }
        return;
      }
    }
    if (req.method === 'GET' && (url === '/api/orchestrator/state' || url === '/api/orchestrator/events')) {
      const sid = new URL(req.url, 'http://x').searchParams.get('session') || '';
      if (!SESSION_RE.test(sid)) return sendJson(res, 400, { error: 'bad session id' });
      if (url === '/api/orchestrator/state') {
        const s = sessions.get(sid);
        return sendJson(res, 200, s ? stateOf(s) : { session: sid, active: false, mode: 'normal', seq: 0 });
      }
      // Server-sent events: the browser hears about a mode change or a body cue the moment it is decided
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.write(': connected\n\n');
      let set = subscribers.get(sid);
      if (!set) { set = new Set(); subscribers.set(sid, set); }
      set.add(res);
      const s = sessions.get(sid);
      if (s) res.write(`data: ${JSON.stringify(stateOf(s))}\n\n`);
      const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* closed */ } }, 15000);
      req.on('close', () => { clearInterval(ping); set.delete(res); if (!set.size) subscribers.delete(sid); });
      return;
    }
    return next();
  };

  return {
    name: 'psytrain-orchestrator',
    configResolved(config) { mode = config.mode; root = config.root; env = loadEnv(config.mode, config.root, ''); },
    configureServer(server) { server.middlewares.use(handler); },
    configurePreviewServer(server) { server.middlewares.use(handler); }
  };
}
