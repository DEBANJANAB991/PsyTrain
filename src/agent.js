import {
  AGENT_TOOLS, BEHAVIOR_META, BEHAVIOR_KEYS, EMOTION_NAMES, GAZE_NAMES, GESTURE_NAMES, ARM_NAMES,
  TRAIT_NAMES, EVENT_NAMES, CONVERSATION_STATES, STATE_NAMES, MODE_STATES, NORMAL_BASE, modeStates
} from '../shared/agent-tools.js';
import { PRESETS } from './personality.js';

const round = (x) => Math.round(x * 100) / 100;

/**
 * The agent-facing API: `agent.tools` (schemas) and `agent.execute(name, args)`.
 * Anything that can call tools (the in-app director, an ElevenLabs agent registering these as client tools,
 * a script in the console) goes through here. Errors are returned, not thrown, with a message the agent can
 * read and correct: { ok: false, error: "..." }.
 */
export function createAgent({ affect, personality }) {
  const check = (value, list, what) => {
    if (!list.includes(value)) throw new Error(`unknown ${what} "${value}". Valid: ${list.join(', ')}`);
  };
  let convState = { state: 'engaged', strength: 0 };     // set by set_state

  const state = () => {
    const beh = affect.getBehavior();
    return {
      emotion: affect.state.emotion,
      intensity: round(affect.state.intensity),
      conversationState: { ...convState },
      ...personality.describe(),
      behavior: Object.fromEntries(Object.entries(beh).map(([k, v]) => [k, typeof v === 'number' ? round(v) : v])),
      pinnedByHuman: { ...affect.overrides }
    };
  };

  const handlers = {
    get_state: () => state(),

    list_options: () => ({
      emotions: EMOTION_NAMES, gazes: GAZE_NAMES, gestures: GESTURE_NAMES, arms: ARM_NAMES, events: EVENT_NAMES, traits: TRAIT_NAMES,
      personalities: Object.fromEntries(Object.entries(personality.allPresets()).map(([k, v]) => [k, { description: v.description, traits: v.traits, variability: v.variability, ranges: v.ranges || {}, emotion: v.emotion || null }])),
      behaviors: Object.fromEntries(BEHAVIOR_KEYS.map((k) => [k, { ...BEHAVIOR_META[k] }]))
    }),

    set_personality: (a) => {
      if (a.preset === undefined && a.traits === undefined && a.variability === undefined && a.emotion === undefined && a.intensity === undefined) {
        throw new Error('give at least one of: preset, traits, variability, emotion, intensity');
      }
      if (a.emotion !== undefined) check(a.emotion, EMOTION_NAMES, 'emotion');
      if (a.preset !== undefined) personality.setPreset(a.preset, { applyEmotion: a.emotion === undefined });
      if (a.traits !== undefined) personality.setTraits(a.traits);
      if (a.variability !== undefined) personality.setVariability(a.variability);
      if (a.emotion !== undefined || a.intensity !== undefined) affect.setAffect({ emotion: a.emotion, intensity: a.intensity });
      return state();
    },

    define_personality: (a) => {
      const name = personality.define(a);
      if (a.activate !== false) personality.setPreset(name, { applyEmotion: true });
      return { defined: name, active: a.activate !== false, ...state() };
    },

    set_behavior: (a) => {
      const { exact, ...values } = a;
      if (!Object.keys(values).length) throw new Error(`give at least one behavior: ${BEHAVIOR_KEYS.join(', ')}, arms`);
      const notes = personality.setCenters(values, { exact: Boolean(exact) });
      return { notes, ...state() };
    },

    set_behavior_range: (a) => {
      if (!a.ranges || !Object.keys(a.ranges).length) throw new Error(`give ranges, e.g. { "gazeStudent": { "min": 0, "max": 0.3 } }`);
      personality.setRanges(a.ranges);
      return { ranges: personality.describe().ranges, ...state() };
    },

    set_affect: (a) => {
      if (a.emotion !== undefined) check(a.emotion, EMOTION_NAMES, 'emotion');
      if (a.gaze !== undefined) check(a.gaze, GAZE_NAMES, 'gaze');
      if (a.gesture !== undefined) check(a.gesture, GESTURE_NAMES, 'gesture');
      if (a.emotion === undefined && a.intensity === undefined && a.gaze === undefined && a.gesture === undefined) throw new Error('give at least one of: emotion, intensity, gaze, gesture');
      affect.setAffect({ emotion: a.emotion, intensity: a.intensity, gaze: a.gaze, gesture: a.gesture });
      return state();
    },

    trigger_event: (a) => {
      const r = personality.trigger(a.event, a.strength ?? 0.7);
      return { reaction: r, ...state() };
    },

    /**
     * A conversation state = emotion + gaze + behavior centers on top of the personality. Setting the emotion
     * first clears the previous state's centers, so every state (and `engaged`, the baseline) starts clean.
     */
    set_state: (a) => {
      check(a.state, STATE_NAMES, 'state');
      const st = CONVERSATION_STATES[a.state];
      const k = Math.max(0, Math.min(1, Number(a.strength ?? 0.7)));
      const base = personality.allPresets()[personality.name.replace('*', '')] || {};
      const emotion = st.emotion ?? base.emotion ?? 'neutral';
      const intensity = st.emotion ? Math.max(0.2, Math.min(0.95, st.intensity * (0.5 + k))) : (base.intensity ?? 0.5);
      personality.stateCenters = {};
      affect.setAffect({ emotion, intensity });
      // her baseline in this emotion, then part of the way (strength) towards the state's values. Kept in
      // stateCenters, so a later emotion change or event adds to this state instead of wiping it.
      const cur = affect.getBehavior();
      personality.setStateCenters(Object.fromEntries(Object.entries(st.behavior || {}).map(([key, v]) => [key, cur[key] + (v - cur[key]) * k])));
      if (st.gaze) affect.setAffect({ gaze: st.gaze });
      convState = { state: a.state, strength: round(k) };
      return state();
    }
  };

  const execute = (name, args = {}) => {
    const fn = handlers[name];
    if (!fn) return { ok: false, error: `unknown tool "${name}". Valid: ${Object.keys(handlers).join(', ')}` };
    try { return { ok: true, ...fn(args && typeof args === 'object' ? args : {}) }; }
    catch (e) { return { ok: false, error: e.message }; }
  };

  return { tools: AGENT_TOOLS, execute, state };
}

// ===================================================================================================
// Director: natural language -> tool calls
// ===================================================================================================

/**
 * Claude (via /api/agent/step on the server, Amazon Bedrock or the Claude API; credentials stay there) decides which
 * tools to call; they run here in the browser, results go back to Claude, until it finishes. Without credentials a small rule-based director
 * (offline) handles common phrasings so the whole path still works.
 */
export class Director {
  constructor(agent) { this.agent = agent; this.status = null; }

  async checkStatus() {
    try { const r = await fetch('/api/agent/status', { cache: 'no-store' }); if (r.ok) this.status = await r.json(); } catch { /* offline */ }
    this.status ||= { configured: false };
    return this.status;
  }

  /** @returns {{mode, text, calls:[{name,args,result}]}} */
  async direct(instruction, { onCall = () => {}, mode = 'auto' } = {}) {
    instruction = String(instruction || '').trim();
    if (!instruction) throw new Error('empty instruction');
    if (!this.status) await this.checkStatus();
    const useClaude = mode === 'claude' || (mode === 'auto' && this.status.configured);
    return useClaude ? this._claude(instruction, onCall) : this._offline(instruction, onCall);
  }

  async _claude(instruction, onCall) {
    const calls = [];
    const messages = [{ role: 'user', content: `${instruction}\n\nCurrent state:\n${JSON.stringify(this.agent.state())}` }];
    for (let round = 0; round < 5; round++) {
      const r = await fetch('/api/agent/step', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `director error ${r.status}`);
      if (j.stop_reason === 'refusal') throw new Error('the model declined this request');
      messages.push({ role: 'assistant', content: j.content });             // must be passed back unchanged
      const uses = j.content.filter((b) => b.type === 'tool_use');
      if (j.stop_reason !== 'tool_use' || !uses.length) {
        const text = j.content.filter((b) => b.type === 'text').map((b) => b.text).join(' ').trim();
        return { mode: 'claude', text, calls };
      }
      const results = uses.map((u) => {
        const result = this.agent.execute(u.name, u.input);
        const call = { name: u.name, args: u.input, result };
        calls.push(call); onCall(call);
        return { type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(compact(result)), is_error: !result.ok };
      });
      messages.push({ role: 'user', content: results });                    // all results in one message
    }
    return { mode: 'claude', text: '(stopped after 5 rounds)', calls };
  }

  _offline(instruction, onCall) {
    const calls = [];
    for (const step of offlinePlan(instruction)) {
      const result = this.agent.execute(step.name, step.args);
      const call = { ...step, result }; calls.push(call); onCall(call);
    }
    const ok = calls.filter((c) => c.result.ok).length;
    const text = calls.length
      ? `Offline rules applied ${ok} of ${calls.length} actions (no Bedrock or Anthropic credentials, so this understands only simple phrases).`
      : 'Offline rules found nothing to do. Try e.g. "an anxious patient who avoids eye contact" (Claude via Bedrock or an Anthropic key understands anything).';
    return { mode: 'offline', text, calls };
  }
}

/** Keep tool results short for the model: drop the long option lists it already knows. */
function compact(result) {
  const { ok, error, emotion, intensity, conversationState, personality, traits, variability, ranges, behavior, defined, reaction, notes } = result;
  if (result.personalities) return result;           // list_options: the model asked for it
  return { ok, error, emotion, intensity, conversationState, personality, traits, variability, ranges, behavior, defined, reaction, notes };
}

/** The live director may only add a gesture or a glance with set_affect; emotion comes with the state. */
function liveAffect(args = {}) {
  const { gesture, gaze } = args;
  return { ...(gesture !== undefined ? { gesture } : {}), ...(gaze !== undefined ? { gaze } : {}) };
}

// ===================================================================================================
// Live director: follows a running voice conversation and keeps her body language in step with it
// ===================================================================================================

/**
 * The ElevenLabs patient agent decides WHAT she says (and speaks it); this decides HOW her body behaves.
 * After every patient turn it sends the profile, the recent transcript and the latest exchange to Claude
 * (/api/agent/step, mode "live"), which answers with set_state / set_affect / trigger_event calls that run
 * here. One model call per turn; a turn that arrives while a call is running is merged into the next call.
 * Without Bedrock / Anthropic credentials a few keyword rules pick the state instead.
 *
 * Events: on('update', fn) with { mode, state, calls, text, ms } after each decision, on('error', fn).
 */
export class LiveDirector {
  constructor(agent, director, { profile = '', situation = null } = {}) {
    this.agent = agent;
    this.director = director;          // shares its /api/agent/status check
    this.profile = profile;
    this.situation = situation;        // landing-page situation (distracted, aggressive): sets where "normal" starts
    this.convMode = null;              // the orchestrator's mode (normal / distracted); null = no orchestrator
    this.transcript = [];
    this.lastStudent = '';
    this.interrupted = false;
    this.busy = false;
    this.pending = false;
    this.enabled = true;
    this.listeners = {};
  }

  on(name, fn) { (this.listeners[name] ||= new Set()).add(fn); return () => this.listeners[name].delete(fn); }
  emit(name, data) { this.listeners[name]?.forEach((fn) => { try { fn(data); } catch (e) { console.error(e); } }); }

  reset() {
    this.transcript = []; this.lastStudent = ''; this.interrupted = false; this.pending = false;
    this.cues = false; this.pendingCue = null; clearTimeout(this.cueTimer);
  }

  /**
   * The orchestrator changed her mode (it decides before she answers): put the body into the mode's base state
   * right away. From now on the per-turn decisions only pick states that fit this mode (MODE_STATES).
   */
  setConversationMode(mode, reason = '') {
    if (!MODE_STATES[mode]) return;
    this.convMode = mode;
    const base = mode === 'normal' ? NORMAL_BASE[this.situation] || MODE_STATES.normal[0] : MODE_STATES[mode][0];
    const args = { state: base, strength: 0.8 };
    const result = this.agent.execute('set_state', args);
    this.emit('update', { mode: 'orchestrator', state: args.state, calls: [{ name: 'set_state', args, result }], text: reason, ms: 0 });
  }

  /**
   * The orchestrator's body cue for the next answer (written by the patient model with the answer itself, before
   * the audio exists): the state is set at once, the gesture and glance wait for the first audible word
   * (onSpeechStart). While cues arrive, the slower per-turn Claude call is not needed and is skipped.
   */
  applyCue(cue) {
    this.cues = true;
    const args = { state: this._fit(cue.state), strength: 0.75 };
    const result = this.agent.execute('set_state', args);
    this.pendingCue = { gesture: cue.gesture, gaze: cue.gaze, at: performance.now() };
    // the words may already be playing (a late cue): then move now
    if (performance.now() - (this.speechAt || -1e9) < 1500) this._playPending(0);
    this.emit('update', { mode: 'cue', state: args.state, calls: [{ name: 'set_state', args, result }], text: `cue ${cue.gesture || ''} ${cue.gaze || ''}`.trim(), ms: 0 });
  }

  /** Her first word of an answer is about to be heard in `delayMs`. */
  onSpeechStart(delayMs = 0) {
    this.speechAt = performance.now() + delayMs;
    if (this.pendingCue && performance.now() - this.pendingCue.at < 15000) this._playPending(delayMs);
  }

  _playPending(delayMs) {
    const p = this.pendingCue;
    this.pendingCue = null;
    if (!p || (!p.gesture && !p.gaze)) return;
    clearTimeout(this.cueTimer);
    // a gesture lands a moment after the first sound, like a nod that goes with "yes"
    this.cueTimer = setTimeout(() => {
      this.agent.execute('set_affect', { ...(p.gesture ? { gesture: p.gesture } : {}), ...(p.gaze ? { gaze: p.gaze } : {}) });
    }, Math.max(0, delayMs) + 120);
  }

  /** A state that fits the orchestrator's mode (the requested one if it does). */
  _fit(state) {
    const ok = this.convMode && MODE_STATES[this.convMode];
    if (!ok || ok.includes(state)) return state;
    return this.convMode === 'normal' ? NORMAL_BASE[this.situation] || ok[0] : ok[0];
  }

  addStudent(text) {
    text = String(text || '').trim();
    if (!text) return;
    this.transcript.push({ who: 'Therapist', text });
    this.lastStudent = text;
  }

  noteInterruption() { this.interrupted = true; }

  addPatient(text) {
    text = String(text || '').trim();
    if (!text) return;
    this.transcript.push({ who: 'Patient', text });
    if (this.transcript.length > 40) this.transcript.splice(0, this.transcript.length - 40);
    if (!this.lastStudent) return;                 // her opening greeting: nothing to react to yet
    if (this.cues) return;                         // the orchestrator's cues already moved the body, before the words
    this.observe();
  }

  /** After an interruption ElevenLabs reports the part she actually said. */
  correctPatient(text) {
    const last = [...this.transcript].reverse().find((l) => l.who === 'Patient');
    if (last && text) last.text = String(text).trim();
  }

  async observe() {
    if (!this.enabled) return;
    if (this.busy) { this.pending = true; return; }
    this.busy = true;
    try { await this._decide(); }
    catch (e) { this.emit('error', e); }
    finally {
      this.busy = false;
      if (this.pending) { this.pending = false; this.observe(); }
    }
  }

  async _decide() {
    const t0 = performance.now();
    const lastPatient = [...this.transcript].reverse().find((l) => l.who === 'Patient')?.text || '';
    const student = this.lastStudent, interrupted = this.interrupted;
    this.interrupted = false;
    if (!this.director.status) await this.director.checkStatus();

    const offline = (mode) => {
      const want = this._fit(offlineState(lastPatient, student));
      const calls = [];
      if (want !== this.agent.state().conversationState.state) {
        const result = this.agent.execute('set_state', { state: want, strength: 0.7 });
        calls.push({ name: 'set_state', args: { state: want, strength: 0.7 }, result });
      }
      this.emit('update', { mode, state: this.agent.state().conversationState.state, calls, text: '', ms: Math.round(performance.now() - t0) });
    };
    if (!this.director.status.configured) return offline('offline');
    // if Claude fails (expired credentials, model not enabled, ...) the keyword rules keep the body in step
    try { await this._claude(lastPatient, student, interrupted, t0); }
    catch (e) { this.emit('error', e); offline('offline fallback'); }
  }

  async _claude(lastPatient, student, interrupted, t0) {
    const s = this.agent.state();
    const cut = (x, n) => (x.length > n ? x.slice(0, n - 1) + '…' : x);
    const recent = this.transcript.slice(-9, -1).map((l) => `${l.who}: ${cut(l.text, 400)}`).join('\n') || '(start of the conversation)';
    const content = [
      `Patient profile: ${cut(this.profile || s.description || 'not given', 600)}`,
      `Recent transcript:\n${recent}`,
      `Latest exchange:\nTherapist: ${cut(student, 600)}${interrupted ? '\n(The therapist interrupted her previous answer.)' : ''}\nPatient (saying this now): ${cut(lastPatient, 1200)}`,
      `Her current state: ${s.conversationState.state} (strength ${s.conversationState.strength}), emotion ${s.emotion} at ${s.intensity}.`,
      this.convMode ? `Her conversation mode, decided by the orchestrator: ${this.convMode}. Use only these states: ${MODE_STATES[this.convMode].join(', ')}.` : ''
    ].filter(Boolean).join('\n\n');

    const messages = [{ role: 'user', content }];
    const calls = [];
    let text = '';
    for (let round = 0; round < 2; round++) {
      const r = await fetch('/api/agent/step', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages, mode: 'live' }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `director error ${r.status}`);
      if (j.stop_reason === 'refusal') throw new Error('the model declined this turn');
      text = j.content.filter((b) => b.type === 'text').map((b) => b.text).join(' ').trim();
      const uses = j.content.filter((b) => b.type === 'tool_use');
      if (!uses.length) break;
      const results = uses.map((u) => {
        const args = u.name === 'set_affect' ? liveAffect(u.input)
          : u.name === 'set_state' ? { ...u.input, state: this._fit(u.input?.state) } : u.input;
        const result = this.agent.execute(u.name, args);
        calls.push({ name: u.name, args, result });
        return { type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(compact(result)), is_error: !result.ok };
      });
      if (results.every((x) => !x.is_error)) break;             // done: only go back to the model to fix an error
      messages.push({ role: 'assistant', content: j.content }, { role: 'user', content: results });
    }
    this.emit('update', { mode: 'claude', state: this.agent.state().conversationState.state, calls, text, ms: Math.round(performance.now() - t0) });
  }
}

export { MODE_STATES };

/** Offline stand-in for the live director: keyword cues in her answer (and the therapist's question). */
export function offlineState(patient, student = '') {
  const p = patient.toLowerCase(), s = student.toLowerCase();
  if (/\b(just answer|stop (talking|rambling)|why can'?t you|that'?s not what i asked|be serious)\b/.test(s)) return 'hesitant';
  if (/\b(football|soccer|match|party|parties|phone|food|pizza|snack|by the way|anyway|where was i|that reminds me|speaking of|did i tell you|what was the question|did you hear|is that a|this room|picture|plant|window|wedding|bruno|trumpet|mallorca|group chat)\b/.test(p)) {
    return /\b(haha|funny|laugh|story|once|you should have seen)\b/.test(p) ? 'storytelling' : 'distracted';
  }
  if (/\b(drink|drinking|beer|beers|jonas|lena|argue|argument|arguments|hangover|cut down)\b/.test(p)) return 'uneasy';
  if (/\b(i understand|that sounds|makes sense|thank you for|i hear you|that must be)\b/.test(s)) return 'at_ease';
  return 'engaged';
}

// ---- offline rules -----------------------------------------------------------------------------------
const PERSONALITY_WORDS = [
  [/anxious|nervous|worried|jittery/, 'anxious'], [/hostile|aggressive|confrontational|irritable|angry/, 'hostile'],
  [/guarded|suspicious|reserved|closed off|closed-off/, 'guarded'], [/depress|hopeless|low mood|sad/, 'depressed'],
  [/talkative|chatty|outgoing|energetic|excited/, 'talkative'], [/evasive|dodg|avoids the topic/, 'evasive'],
  [/distract|unfocused|restless|scatterbrain/, 'distractible'], [/stoic|unemotional|composed/, 'stoic'],
  [/cooperative|friendly|helpful|open and/, 'cooperative']
];
const EMOTION_WORDS = [
  [/excited|thrilled/, 'excited'], [/relieved|reassured/, 'relieved'], [/withdrawn/, 'withdrawn'], [/dismissive|disinterested|bored/, 'dismissive'],
  [/tense|stressed/, 'tense'], [/angry|furious|annoyed/, 'angry'], [/sad|tearful|upset/, 'sad'], [/anxious|scared|afraid|fearful/, 'anxious']
];
const EVENT_WORDS = [
  [/sensitive|embarrass|intimate|touchy/, 'sensitive_question'], [/reassur|empath|comfort|calm(s|ed)? (her|him|them)? ?down/, 'reassurance'],
  [/accus|blame|confront/, 'accusation'], [/interrupt/, 'interruption'], [/long silence|awkward silence|silence/, 'long_silence'],
  [/good news/, 'good_news'], [/bad news|diagnos/, 'bad_news'], [/rapport|trust/, 'rapport_built']
];

export function offlinePlan(text) {
  const t = text.toLowerCase();
  const plan = [];
  const intensity = /very|extremely|strongly|really/.test(t) ? 0.85 : /slightly|a bit|mildly|somewhat/.test(t) ? 0.4 : undefined;

  const pers = PERSONALITY_WORDS.find(([re]) => re.test(t));
  if (pers) plan.push({ name: 'set_personality', args: { preset: pers[1], ...(intensity ? { intensity } : {}) } });

  const emo = !pers && EMOTION_WORDS.find(([re]) => re.test(t));
  if (emo) plan.push({ name: 'set_affect', args: { emotion: emo[1], ...(intensity ? { intensity } : {}) } });

  if (/never (looks?|look)? ?away|always (keeps|maintains) eye contact|keeps? eye contact|stares/.test(t)) plan.push({ name: 'set_behavior_range', args: { ranges: { gazeStudent: { min: 0.85, max: 1 } } } });
  else if (/avoid(s|ing)? (eye contact|looking)|never looks at|won'?t look/.test(t)) plan.push({ name: 'set_behavior_range', args: { ranges: { gazeStudent: { min: 0, max: 0.2 } } } });
  if (/looks? around|glances? around|distracted/.test(t) && !pers) plan.push({ name: 'set_behavior_range', args: { ranges: { lookAround: { min: 0.5, max: 1 } } } });

  const vals = {};
  if (/(very|more|really) fidget|fidgets a lot|wring/.test(t)) vals.fidget = 0.85;
  else if (/less fidget|sits still|doesn'?t fidget|still/.test(t)) vals.fidget = 0.05;
  if (/foot tap|taps? (her|his|their) foot|tapping/.test(t)) vals.footTap = 0.7;
  if (/knee|leg bounc|bouncing/.test(t)) vals.legBounce = 0.7;
  if (/crossed arms|arms crossed|folds? (her|his|their) arms/.test(t)) vals.arms = 'crossed';
  else if (/clasped|hands together|wringing hands/.test(t)) vals.arms = 'clasped';
  if (Object.keys(vals).length) plan.push({ name: 'set_behavior', args: vals });

  const ev = EVENT_WORDS.find(([re]) => re.test(t));
  if (ev) plan.push({ name: 'trigger_event', args: { event: ev[1], strength: intensity ?? 0.7 } });
  return plan;
}
