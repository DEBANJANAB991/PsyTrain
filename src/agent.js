import {
  AGENT_TOOLS, BEHAVIOR_META, BEHAVIOR_KEYS, EMOTION_NAMES, GAZE_NAMES, GESTURE_NAMES, ARM_NAMES,
  TRAIT_NAMES, EVENT_NAMES
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

  const state = () => {
    const beh = affect.getBehavior();
    return {
      emotion: affect.state.emotion,
      intensity: round(affect.state.intensity),
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
 * Claude (via /api/agent/step on the server, key stays there) decides which tools to call; they run here in the
 * browser, results go back to Claude, until it finishes. Without an Anthropic key a small rule-based director
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
      ? `Offline rules applied ${ok} of ${calls.length} actions (no Anthropic key, so this understands only simple phrases).`
      : 'Offline rules found nothing to do. Try e.g. "an anxious patient who avoids eye contact" (an Anthropic key understands anything).';
    return { mode: 'offline', text, calls };
  }
}

/** Keep tool results short for the model: drop the long option lists it already knows. */
function compact(result) {
  const { ok, error, emotion, intensity, personality, traits, variability, ranges, behavior, defined, reaction, notes } = result;
  if (result.personalities) return result;           // list_options: the model asked for it
  return { ok, error, emotion, intensity, personality, traits, variability, ranges, behavior, defined, reaction, notes };
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
