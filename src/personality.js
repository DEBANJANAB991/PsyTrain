import { BEHAVIOR_META, BEHAVIOR_KEYS, TRAIT_NAMES, EVENT_NAMES, ARM_NAMES, EMOTION_NAMES } from '../shared/agent-tools.js';

/**
 * Personality layer. It sits between the emotion's movement profile (BEHAVIOR in config.js) and the
 * behavior values the rest of the app uses:
 *
 *   emotion profile  ->  + personality (Big Five traits shift each behavior)
 *                    ->  + agent-set centers (set_behavior)
 *                    ->  + active event reactions (decay over time)
 *                    ->  + slow natural drift (variability x range width)
 *                    ->  clamped to the personality's ranges
 *                    ->  (human slider pins are applied last, in Affect.getBehavior)
 *
 * Every knob here is reachable through the agent tools in shared/agent-tools.js.
 */

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const TAU = Math.PI * 2;
const noise = (t, seed) => (Math.sin(t + seed * 12.9898) + 0.5 * Math.sin(2.31 * t + seed * 4.1) + 0.25 * Math.sin(3.77 * t + seed * 7.3)) / 1.75;
const hash = (s) => { let h = 7; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 1000; return h; };

/** How each Big Five trait pushes each behavior, per unit of (trait - 0.5) * 2, i.e. -1..+1. */
const TRAIT_MAP = {
  fidget:      { neuroticism: 0.45, conscientiousness: -0.15, extraversion: 0.10 },
  footTap:     { neuroticism: 0.30, extraversion: 0.15, conscientiousness: -0.10 },
  legBounce:   { neuroticism: 0.30, extraversion: 0.20 },
  shift:       { extraversion: 0.30, conscientiousness: -0.20, neuroticism: 0.15 },
  lookAround:  { openness: 0.25, neuroticism: 0.25, conscientiousness: -0.20, agreeableness: -0.05 },
  gazeStudent: { extraversion: 0.25, agreeableness: 0.15, neuroticism: -0.30 },
  blink:       { neuroticism: 0.80 },
  breath:      { neuroticism: 0.40 },
  headMotion:  { extraversion: 0.35, openness: 0.15 }
};

/** Time scale (seconds) of the slow drift of each behavior. */
const DRIFT_SECONDS = { fidget: 23, footTap: 31, legBounce: 37, shift: 29, lookAround: 41, gazeStudent: 27, blink: 33, breath: 47, headMotion: 19 };

export const PRESETS = {
  default:     { description: 'average person, no strong traits', traits: { openness: 0.5, conscientiousness: 0.5, extraversion: 0.5, agreeableness: 0.5, neuroticism: 0.5 }, variability: 0.25 },
  cooperative: { description: 'friendly, open, answers readily and keeps eye contact', traits: { openness: 0.6, conscientiousness: 0.7, extraversion: 0.6, agreeableness: 0.85, neuroticism: 0.3 }, ranges: { gazeStudent: { min: 0.6, max: 1 }, fidget: { min: 0, max: 0.4 } }, variability: 0.2, emotion: 'neutral', intensity: 0.5 },
  anxious:     { description: 'worried and restless, avoids sustained eye contact, fidgets and glances around', traits: { openness: 0.4, conscientiousness: 0.5, extraversion: 0.35, agreeableness: 0.6, neuroticism: 0.9 }, variability: 0.35, emotion: 'anxious', intensity: 0.6, arms: 'clasped' },
  guarded:     { description: 'reserved and suspicious, shares little, closed posture', traits: { openness: 0.3, conscientiousness: 0.6, extraversion: 0.25, agreeableness: 0.25, neuroticism: 0.55 }, ranges: { gazeStudent: { min: 0.1, max: 0.6 }, fidget: { min: 0, max: 0.5 } }, variability: 0.2, emotion: 'tense', intensity: 0.5, arms: 'crossed' },
  hostile:     { description: 'irritable and confrontational, stares, closed posture', traits: { openness: 0.4, conscientiousness: 0.4, extraversion: 0.55, agreeableness: 0.1, neuroticism: 0.6 }, ranges: { gazeStudent: { min: 0.7, max: 1 } }, variability: 0.25, emotion: 'angry', intensity: 0.6, arms: 'crossed' },
  depressed:   { description: 'low energy, slow and still, looks down, avoids contact', traits: { openness: 0.3, conscientiousness: 0.3, extraversion: 0.1, agreeableness: 0.5, neuroticism: 0.8 }, ranges: { headMotion: { min: 0, max: 0.3 }, shift: { min: 0, max: 0.2 }, gazeStudent: { min: 0, max: 0.35 }, fidget: { min: 0, max: 0.25 } }, variability: 0.15, emotion: 'sad', intensity: 0.6 },
  talkative:   { description: 'outgoing and energetic, animated, lots of movement', traits: { openness: 0.8, conscientiousness: 0.4, extraversion: 0.95, agreeableness: 0.7, neuroticism: 0.4 }, variability: 0.3, emotion: 'excited', intensity: 0.5 },
  evasive:     { description: 'avoids the topic, shifts and looks around, little eye contact', traits: { openness: 0.5, conscientiousness: 0.5, extraversion: 0.4, agreeableness: 0.3, neuroticism: 0.6 }, ranges: { lookAround: { min: 0.4, max: 0.9 }, gazeStudent: { min: 0.05, max: 0.45 } }, variability: 0.3, emotion: 'tense', intensity: 0.5, arms: 'crossed' },
  distractible:{ description: 'cannot stay focused, looks around, restless hands', traits: { openness: 0.9, conscientiousness: 0.1, extraversion: 0.6, agreeableness: 0.5, neuroticism: 0.5 }, ranges: { lookAround: { min: 0.5, max: 1 }, fidget: { min: 0.4, max: 1 } }, variability: 0.45, emotion: 'neutral', intensity: 0.5 },
  stoic:       { description: 'calm and controlled, hardly moves, gives little away', traits: { openness: 0.3, conscientiousness: 0.8, extraversion: 0.2, agreeableness: 0.5, neuroticism: 0.1 }, ranges: { fidget: { min: 0, max: 0.1 }, footTap: { min: 0, max: 0 }, legBounce: { min: 0, max: 0 }, shift: { min: 0, max: 0.15 } }, variability: 0.08, emotion: 'neutral', intensity: 0.4 }
};

/**
 * Situations in the consultation and how a patient reacts. `fx` are behavior offsets at strength 1 that fade out
 * linearly over `seconds`. `emotion(p)` picks an emotion from the personality (or null to keep the current one).
 * `negative` events hit neurotic patients harder; positive ones land better with agreeable patients.
 */
export const EVENTS = {
  sensitive_question: { seconds: 20, negative: true, fx: { fidget: 0.30, footTap: 0.15, legBounce: 0.10, gazeStudent: -0.35, lookAround: 0.20, blink: 0.6, breath: 0.2, shift: 0.2 },
    emotion: (t) => (t.neuroticism > 0.65 ? 'anxious' : t.agreeableness < 0.35 ? 'dismissive' : 'tense') },
  reassurance: { seconds: 25, fx: { fidget: -0.25, gazeStudent: 0.25, breath: -0.2, blink: -0.3, footTap: -0.15, legBounce: -0.2, lookAround: -0.15 }, emotion: () => 'relieved' },
  accusation: { seconds: 25, negative: true, fx: { fidget: 0.15, breath: 0.3, shift: 0.1 },
    fxFn: (t) => ({ gazeStudent: t.agreeableness < 0.4 ? 0.2 : -0.3 }),
    emotion: (t) => (t.agreeableness < 0.4 ? 'angry' : t.neuroticism > 0.5 ? 'anxious' : 'withdrawn'), arms: (t) => (t.agreeableness < 0.4 ? 'crossed' : null) },
  interruption: { seconds: 12, negative: true, fx: { fidget: 0.15, lookAround: 0.15, gazeStudent: -0.1 }, emotion: () => 'tense' },
  long_silence: { seconds: 25, negative: true, fx: { fidget: 0.25, lookAround: 0.30, gazeStudent: -0.2, shift: 0.3, blink: 0.3 },
    emotion: (t) => (t.neuroticism > 0.6 ? 'anxious' : t.extraversion < 0.3 ? 'withdrawn' : null) },
  good_news: { seconds: 25, fx: { fidget: -0.1, gazeStudent: 0.15, breath: -0.1, shift: 0.15 }, emotion: (t) => (t.extraversion > 0.5 ? 'excited' : 'relieved') },
  bad_news: { seconds: 40, negative: true, fx: { gazeStudent: -0.3, fidget: -0.10, breath: -0.1, shift: -0.1 }, emotion: (t) => (t.neuroticism > 0.5 ? 'sad' : 'withdrawn') },
  rapport_built: { seconds: 60, fx: { gazeStudent: 0.2, fidget: -0.15, shift: -0.1, lookAround: -0.1 }, emotion: () => 'relieved' }
};

const STORAGE_KEY = 'psytrain.customPersonalities';
const NAME_RE = /^[a-z][a-z0-9_]{1,29}$/;

export class Personality {
  constructor(affect) {
    this.affect = affect;
    this.custom = loadCustom();
    this.name = 'default';
    this.description = PRESETS.default.description;
    this.traits = { ...PRESETS.default.traits };
    this.ranges = {};              // per behavior { min, max }
    this.variability = PRESETS.default.variability;
    this.centers = {};             // set by agents (set_behavior), cleared when the emotion changes
    this.arms = null;              // preferred arm posture of the personality
    this.events = [];              // active { name, t, seconds, fx, strength }
    this.t = 0;
    this.enabled = true;
    affect.personality = this;
  }

  // ---- registry --------------------------------------------------------------------------------
  allPresets() { return { ...PRESETS, ...this.custom }; }
  presetNames() { return Object.keys(this.allPresets()); }

  setPreset(name, { applyEmotion = false } = {}) {
    const p = this.allPresets()[name];
    if (!p) throw new Error(`unknown personality "${name}". Valid: ${this.presetNames().join(', ')}`);
    this.name = name;
    this.description = p.description || '';
    this.traits = { ...PRESETS.default.traits, ...p.traits };
    this.ranges = JSON.parse(JSON.stringify(p.ranges || {}));
    this.variability = p.variability ?? 0.25;
    this.arms = p.arms || null;
    this.centers = {};
    this.events = [];
    if (applyEmotion && p.emotion) this.affect.setAffect({ emotion: p.emotion, intensity: p.intensity ?? 0.6 });
    else this.affect.setAffect({});
    return this.describe();
  }

  /** Define (and save) a new personality type. */
  define(def) {
    const name = String(def.name || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
    if (!NAME_RE.test(name)) throw new Error('name must be 2-30 characters: lowercase letters, digits and underscores, starting with a letter');
    if (PRESETS[name]) throw new Error(`"${name}" is a built-in personality; pick another name`);
    const traits = {};
    for (const [k, v] of Object.entries(def.traits || {})) {
      if (!TRAIT_NAMES.includes(k)) throw new Error(`unknown trait "${k}". Valid: ${TRAIT_NAMES.join(', ')}`);
      traits[k] = clamp(Number(v), 0, 1);
    }
    const ranges = this._cleanRanges(def.ranges || {});
    const entry = {
      description: String(def.description || '').slice(0, 200),
      traits: { ...PRESETS.default.traits, ...traits },
      ranges,
      variability: def.variability === undefined ? 0.25 : clamp(Number(def.variability), 0, 1)
    };
    if (def.default_emotion) { this._checkEmotion(def.default_emotion); entry.emotion = def.default_emotion; entry.intensity = def.default_intensity ?? 0.6; }
    if (def.arms) { this._checkArms(def.arms); entry.arms = def.arms; }
    this.custom[name] = entry;
    saveCustom(this.custom);
    return name;
  }

  // ---- direct controls (used by tools and the UI) --------------------------------------------------
  setTraits(traits) {
    for (const [k, v] of Object.entries(traits || {})) {
      if (!TRAIT_NAMES.includes(k)) throw new Error(`unknown trait "${k}". Valid: ${TRAIT_NAMES.join(', ')}`);
      this.traits[k] = clamp(Number(v), 0, 1);
    }
    this.name = this.name.endsWith('*') ? this.name : this.name + '*';   // marks "modified preset"
    this.affect.setAffect({});
  }

  setVariability(v) { this.variability = clamp(Number(v), 0, 1); this.affect.setAffect({}); }

  setRanges(ranges) {
    for (const [k, r] of Object.entries(ranges || {})) {
      if (!BEHAVIOR_META[k]) throw new Error(`unknown behavior "${k}". Valid: ${BEHAVIOR_KEYS.join(', ')}`);
      if (r === null) { delete this.ranges[k]; continue; }
      const meta = BEHAVIOR_META[k];
      const lo = clamp(Number(r.min ?? meta.min), meta.min, meta.max), hi = clamp(Number(r.max ?? meta.max), meta.min, meta.max);
      this.ranges[k] = { min: Math.min(lo, hi), max: Math.max(lo, hi) };
    }
    this.affect.setAffect({});
  }

  _cleanRanges(ranges) {
    const out = {};
    for (const [k, r] of Object.entries(ranges)) {
      if (!BEHAVIOR_META[k]) throw new Error(`unknown behavior "${k}". Valid: ${BEHAVIOR_KEYS.join(', ')}`);
      if (!r) continue;
      const meta = BEHAVIOR_META[k];
      const lo = clamp(Number(r.min ?? meta.min), meta.min, meta.max), hi = clamp(Number(r.max ?? meta.max), meta.min, meta.max);
      out[k] = { min: Math.min(lo, hi), max: Math.max(lo, hi) };
    }
    return out;
  }

  /** Set behavior centers. exact = true pins them (no drift, ignores ranges). */
  setCenters(values, { exact = false } = {}) {
    const clean = {}, notes = [];
    for (const [k, v] of Object.entries(values || {})) {
      if (k === 'arms') { this._checkArms(v); this.arms = v; continue; }
      if (!BEHAVIOR_META[k]) throw new Error(`unknown behavior "${k}". Valid: ${BEHAVIOR_KEYS.join(', ')}, arms`);
      const meta = BEHAVIOR_META[k], val = clamp(Number(v), meta.min, meta.max);
      if (val !== Number(v)) notes.push(`${k} clamped to ${val}`);
      clean[k] = val;
    }
    if (exact) {
      this.affect.setAffect({ behavior: clean });
    } else {
      Object.assign(this.centers, clean);
      this.affect.setAffect({});
    }
    return notes;
  }

  clearCenters() { this.centers = {}; }

  // ---- events --------------------------------------------------------------------------------------
  trigger(name, strength = 0.7) {
    const ev = EVENTS[name];
    if (!ev) throw new Error(`unknown event "${name}". Valid: ${EVENT_NAMES.join(', ')}`);
    strength = clamp(Number(strength), 0, 1);
    const t = this.traits;
    const react = ev.negative ? 0.5 + 0.5 * t.neuroticism : 0.5 + 0.5 * t.agreeableness;   // 0.5..1
    const fx = { ...ev.fx, ...(ev.fxFn ? ev.fxFn(t) : {}) };
    this.events = this.events.filter((e) => e.name !== name);
    this.events.push({ name, t: 0, seconds: ev.seconds, fx, scale: strength * react * 1.3 });
    const emotion = ev.emotion ? ev.emotion(t) : null;
    const arms = ev.arms ? ev.arms(t) : null;
    if (arms) this.arms = arms;
    if (emotion) this.affect.setAffect({ emotion, intensity: clamp(0.35 + 0.55 * strength * react * 1.2, 0.3, 0.95) });
    else this.affect.setAffect({});
    return { emotion, reaction: +react.toFixed(2), seconds: ev.seconds };
  }

  // ---- per frame ------------------------------------------------------------------------------------
  update(dtMs) {
    this.t += dtMs / 1000;
    if (this.events.length) {
      for (const e of this.events) e.t += dtMs / 1000;
      this.events = this.events.filter((e) => e.t < e.seconds);
    }
  }

  eventOffset(key) {
    let s = 0;
    for (const e of this.events) s += (e.fx[key] || 0) * e.scale * (1 - e.t / e.seconds);
    return s;
  }

  /** Turn the emotion's behavior profile into this personality's behavior (mutates and returns `out`). */
  apply(out) {
    if (!this.enabled) return out;
    for (const key of BEHAVIOR_KEYS) {
      const meta = BEHAVIOR_META[key];
      const r = this.ranges[key] || { min: meta.min, max: meta.max };
      let c = this.centers[key];
      if (c === undefined) {
        let off = 0;
        for (const [trait, w] of Object.entries(TRAIT_MAP[key] || {})) off += w * (this.traits[trait] - 0.5) * 2;
        c = out[key] + off;
      }
      c += this.eventOffset(key);
      const drift = noise((this.t / DRIFT_SECONDS[key]) * TAU, hash(key)) * this.variability * (r.max - r.min) / 2;
      out[key] = clamp(c + drift, r.min, r.max);
    }
    out.arms = this.arms || out.arms;
    return out;
  }

  // ---- introspection --------------------------------------------------------------------------------
  describe() {
    return {
      personality: this.name,
      description: this.description,
      traits: { ...this.traits },
      variability: +this.variability.toFixed(2),
      ranges: JSON.parse(JSON.stringify(this.ranges)),
      centers: { ...this.centers },
      arms: this.arms,
      activeEvents: this.events.map((e) => ({ event: e.name, secondsLeft: +(e.seconds - e.t).toFixed(1) }))
    };
  }

  _checkEmotion(e) { if (!EMOTION_NAMES.includes(e)) throw new Error(`unknown emotion "${e}". Valid: ${EMOTION_NAMES.join(', ')}`); }
  _checkArms(a) { if (!ARM_NAMES.includes(a)) throw new Error(`unknown arms "${a}". Valid: ${ARM_NAMES.join(', ')}`); }
}

function loadCustom() {
  try { return JSON.parse(globalThis.localStorage?.getItem(STORAGE_KEY) || '{}') || {}; } catch { return {}; }
}
function saveCustom(c) {
  try { globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(c)); } catch { /* private mode: keep in memory only */ }
}
