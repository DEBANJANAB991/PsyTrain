import {
  SEATED_POSE, ARMS, BODY_DELTAS, FACE, MICRO, BEHAVIOR,
  EMOTIONS, GAZES, GESTURES
} from './config.js';

const clamp01 = (x) => Math.min(1, Math.max(0, Number.isFinite(x) ? x : 0));
const MOOD_NAME = 'patient_affect';

// How the eyes wander while idle, per emotion (TalkingHead anim ranges: rotateY = sideways, rotateX = down+).
const EYE_STYLE = {
  neutral:    { dt: [200, [2000, 5000], [3000, 9000, 1, 2]], y: [-0.35, 0.35], x: [-0.1, 0.3], head: 0.5 },
  tense:      { dt: [120, [250, 900]],                        y: [-0.8, 0.8],   x: [-0.2, 0.5], head: 0.4 },
  anxious:    { dt: [100, [180, 700]],                        y: [-0.9, 0.9],   x: [-0.3, 0.5], head: 0.6 },
  angry:      { dt: [300, [3000, 8000]],                      y: [-0.15, 0.15], x: [-0.05, 0.1], head: 0.2 },
  sad:        { dt: [500, [3000, 7000]],                      y: [-0.2, 0.2],   x: [0.4, 0.8],  head: 0.1 },
  withdrawn:  { dt: [400, [2500, 6000]],                      y: [-0.25, 0.25], x: [0.3, 0.7],  head: 0.1 },
  dismissive: { dt: [300, [1500, 4000]],                      y: [-0.8, 0.8],   x: [-0.5, 0.2], head: 0.5 },
  relieved:   { dt: [200, [2500, 6000], [3000, 9000, 1, 2]],  y: [-0.3, 0.3],   x: [-0.1, 0.3], head: 0.5 }
};

/**
 * The single entry point for the patient's emotional state. Debug buttons and (later)
 * the ElevenLabs `set_affect` tool call both end up here:
 *
 *   affect.setAffect({ emotion, intensity, gaze, gesture, behavior })
 *
 * `behavior` is an optional partial override of the body-language profile (see BEHAVIOR in
 * config.js), e.g. { fidget: 0.9, lookAround: 0.5, arms: 'crossed' }. Pass `behavior: null` to
 * clear overrides. Everything goes through TalkingHead's public API.
 */
export class Affect {
  constructor(head) {
    this.head = head;
    this.state = { emotion: 'neutral', intensity: 0.7, gaze: 'student', gesture: 'none' };
    this.overrides = {};          // user overrides of the behaviour profile
    this.shiftOffset = {};        // posture-shift deltas from the body-language layer
    this.bodyLang = null;         // set by main.js
    this.listeners = new Set();
    this.poseCache = this._makeStraightBase();
    this._lockSeated();
  }

  /**
   * She must never stand up. TalkingHead can change pose by itself (random 'pose' animations from its
   * built-in moods, stopAnimation(), emoji, gestures...). Route every pose change through this guard:
   * only templates we built (marked `seated`) are accepted; anything else is ignored and logged.
   */
  _lockSeated() {
    const h = this.head;
    const orig = h.setPoseFromTemplate.bind(h);
    this._setPoseRaw = orig;
    this.blockedPoseAttempts = 0;
    h.setPoseFromTemplate = (template, ms) => {
      if (template && template.seated) return orig(template, ms);
      this.blockedPoseAttempts++;
      if (this.blockedPoseAttempts <= 5) console.warn('[affect] blocked a non-seated pose change', new Error().stack.split('\n').slice(2, 5).join(' | '));
      return this._applyPose(ms ?? 700);   // re-assert the seated pose instead
    };
  }

  /** Drop animations that would change pose on their own. Called every frame by BodyLanguage. */
  purgePoseAnims() {
    const q = this.head.animQueue;
    for (let i = q.length - 1; i >= 0; i--) if (q[i].template.name === 'pose') q.splice(i, 1);
  }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  /** Effective behaviour = neutral -> emotion profile blended by intensity, then overrides. */
  getBehavior() {
    const { emotion, intensity } = this.state;
    const a = BEHAVIOR.neutral, b = BEHAVIOR[emotion] || a;
    const out = {};
    for (const k of Object.keys(a)) {
      out[k] = typeof a[k] === 'number' ? a[k] + (b[k] - a[k]) * intensity : b[k];
    }
    return Object.assign(out, this.overrides);
  }

  setAffect(input = {}) {
    let { emotion, intensity, gaze, gesture, behavior } = input;
    const s = this.state;
    const prevArms = this.getBehavior().arms;
    if (emotion !== undefined) {
      if (!EMOTIONS.includes(emotion)) { console.warn('[affect] unknown emotion', emotion); emotion = s.emotion; }
      s.emotion = emotion;
      if (input.behavior === undefined) this.overrides = {};   // new emotion = fresh behaviour
    }
    if (intensity !== undefined) s.intensity = clamp01(intensity);
    if (behavior === null) this.overrides = {};
    else if (behavior && typeof behavior === 'object') Object.assign(this.overrides, behavior);
    if (gaze !== undefined) {
      if (GAZES.includes(gaze)) s.gaze = gaze; else console.warn('[affect] unknown gaze', gaze);
    }

    this._applyMood();
    this._applyPose(emotion !== undefined || this.getBehavior().arms !== prevArms ? 900 : 500);
    if (gaze !== undefined) this._applyGaze(s.gaze);
    if (gesture && gesture !== 'none') {
      if (GESTURES.includes(gesture)) this.playGesture(gesture); else console.warn('[affect] unknown gesture', gesture);
    }
    this.listeners.forEach((fn) => fn({ ...s }, this.getBehavior()));
    return { ...s, behavior: this.getBehavior() };
  }

  // ---- mood (face + blink + eyes + breathing + micro-expressions) -----------------------
  _applyMood() {
    const mood = this._buildMood();
    this.head.animMoods[MOOD_NAME] = mood;
    this.head.setMood(MOOD_NAME);
    // TalkingHead's built-in moods leave a random 'pose' animation (and a 'mouth' one) in the queue;
    // setMood() only replaces animations with the same name, so drop the leftovers. Without this the
    // patient randomly stands up / changes to a standing pose.
    const mine = new Set(mood.anims.map((a) => a.name));
    for (const name of ['pose', 'mouth']) if (!mine.has(name)) this._removeAnim(name);
  }

  _buildMood() {
    const { emotion, intensity: k } = this.state;
    const beh = this.getBehavior();
    const neutral = FACE.neutral;
    const target = FACE[emotion] || neutral;
    const baseline = {};
    for (const key of new Set([...Object.keys(neutral), ...Object.keys(target)])) {
      const a = neutral[key] ?? 0, b = target[key] ?? 0;
      baseline[key] = a + (b - a) * k;
    }

    const es = EYE_STYLE[emotion] || EYE_STYLE.neutral;
    const pStudent = beh.gazeStudent;
    const headMove = es.head * (0.4 + beh.headMotion);
    const idleEyes = { alt: [
      { p: pStudent, delay: [200, 3000], dt: [200, [2000, 5000], [3000, 9000, 1, 2]],
        vs: { headMove: [0.5], eyesRotateY: [[-0.3, 0.3]], eyesRotateX: [[-0.1, 0.3]], eyeContact: [null, 1] } },
      { delay: [100, 1500], dt: es.dt,
        vs: { headMove: [headMove], eyesRotateY: [es.y], eyesRotateX: [es.x] } }
    ]};
    const speakEyes = { alt: [
      { p: Math.max(pStudent, 0.5), delay: [200, 5000], dt: [0, [3000, 10000, 1, 2], [2000, 5000]],
        vs: { eyeContact: [1, null], headMove: [null, 0.4, null], eyesRotateY: [null, [-0.5, 0.5]], eyesRotateX: [null, [-0.2, 0.5]] } },
      { delay: [200, 5000], dt: [200, [2000, 5000, 1, 2]],
        vs: { headMove: [0.4, null], eyesRotateY: [[-0.5, 0.5]], eyesRotateX: [[-0.2, 0.5]] } }
    ]};

    // Blink rate: 1.0 ~ one blink every ~4 s on average; double blinks happen occasionally.
    const br = Math.max(0.2, beh.blink);
    const blink = { name: 'blink', alt: [
      { p: 0.85, delay: [1200 / br, 7000 / br, 1, 2], dt: [50, [90, 250], 110], vs: { eyeBlinkLeft: [1, 1, 0], eyeBlinkRight: [1, 1, 0] } },
      { delay: [1200 / br, 4000 / br, 1, 2], dt: [50, [90, 200], 100, [10, 400, 0], 50, [90, 200], 100], vs: { eyeBlinkLeft: [1, 1, 0, 0, 1, 1, 0], eyeBlinkRight: [1, 1, 0, 0, 1, 1, 0] } }
    ]};

    // Micro-expressions: small, asymmetric, short flickers.
    const micro = {};
    for (const [mt, amp] of Object.entries(MICRO[emotion] || MICRO.neutral)) micro[mt] = [[0, amp * (0.4 + 0.6 * k), 2]];
    const microAnim = { name: 'misc', delay: [300, 3000], dt: [[120, 450], [400, 2500, 2]], vs: micro };

    const mv = 0.35 + beh.headMotion; // head motion multiplier
    return {
      baseline,
      speech: { deltaRate: 0, deltaPitch: 0, deltaVolume: 0 },
      anims: [
        { name: 'breathing', delay: 800, dt: [1300 / beh.breath, 500 / beh.breath, 1000 / beh.breath], vs: { chestInhale: [0.5 + 0.2 * (beh.breath - 1), 0.5, 0] } },
        { name: 'head',
          idle: { delay: [0, 1000], dt: [[200, 5000]], vs: { bodyRotateX: [[-0.03 * mv, 0.06 * mv]], bodyRotateY: [[-0.14 * mv, 0.14 * mv]], bodyRotateZ: [[-0.05 * mv, 0.05 * mv]] } },
          speaking: { dt: [[0, 1000, 0]], vs: { bodyRotateX: [[-0.03, 0.08, 1, 2]], bodyRotateY: [[-0.06, 0.06]], bodyRotateZ: [[-0.05, 0.05]] } } },
        { name: 'eyes', idle: idleEyes, speaking: speakEyes },
        blink,
        microAnim
      ]
    };
  }

  // ---- body language (seated pose + arms + emotion deltas + posture shift) --------------
  _makeStraightBase() {
    const straight = this.head.poseTemplates['straight'].props;
    const base = {};
    for (const [k, v] of Object.entries(straight)) base[k] = { x: v.x, y: v.y, z: v.z };
    return base;
  }

  _basePose(arms) {
    const base = {};
    for (const [k, v] of Object.entries(this.poseCache)) base[k] = { ...v };
    for (const [k, v] of Object.entries(SEATED_POSE)) base[k] = { ...v };
    for (const [k, v] of Object.entries(ARMS[arms] || ARMS.rest)) base[k] = { ...v };
    return base;
  }

  /** Rebuild from edited SEATED_POSE values (live tuning from the console). */
  setSeatedOverrides(overrides) {
    Object.assign(SEATED_POSE, overrides);
    this._applyPose(80);
  }

  setShiftOffset(offset, ms = 1600) {
    this.shiftOffset = offset || {};
    this._applyPose(ms);
  }

  _applyPose(ms = 700) {
    const { emotion, intensity } = this.state;
    const props = this._basePose(this.getBehavior().arms);
    const add = (k, d, f) => {
      const p = props[k] || (props[k] = { x: 0, y: 0, z: 0 });
      p.x += d.x * f; p.y += d.y * f; p.z += d.z * f;
    };
    for (const [k, d] of Object.entries(BODY_DELTAS[emotion] || {})) add(k, d, intensity);
    for (const [k, d] of Object.entries(this.shiftOffset)) add(k, d, 1);
    // TalkingHead mirrors a *new* pose template when weight is not "on the left foot";
    // keep our seated pose from flipping left/right.
    this.head.poseWeightOnLeft = true;
    this.head.poseName = 'patient_seated';
    this._setPoseRaw({ props, seated: true }, ms);
  }

  // ---- gaze + gestures -----------------------------------------------------------------
  _removeAnim(name) {
    const q = this.head.animQueue;
    const i = q.findIndex((a) => a.template.name === name);
    if (i !== -1) q.splice(i, 1);
  }

  _applyGaze(gaze) {
    const h = this.head;
    this._removeAnim('gaze_override');
    if (gaze === 'student') {
      h.lookAtCamera(3000);
    } else if (gaze === 'away') {
      h.lookAhead(3000);
    } else if (gaze === 'around') {
      this.bodyLang?.lookAround();
      this.state.gaze = 'student'; // one-shot, then back to default behaviour
    } else if (gaze === 'down') {
      h.animQueue.push(h.animFactory({
        name: 'gaze_override', dt: [500, 3000, 600],
        vs: { eyesRotateX: [0.6, 0.6, 0], bodyRotateX: [0.12, 0.12, 0], eyeContact: [0, 0, 0], headMove: [0, 0, 0] }
      }));
    }
  }

  playGesture(name) {
    const h = this.head;
    if (name === 'nod') {
      h.animQueue.push(h.animFactory({
        name: 'gesture_nod', dt: [250, 250, 250, 300], vs: { bodyRotateX: [0.2, 0.02, 0.17, 0] }
      }));
    } else if (name === 'shake') {
      h.animQueue.push(h.animFactory({
        name: 'gesture_shake', dt: [200, 300, 300, 300, 250], vs: { bodyRotateY: [0.22, -0.22, 0.2, -0.15, 0] }
      }));
    } else if (name === 'shrug') {
      this.bodyLang?.shrug();
    }
  }
}
