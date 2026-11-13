import { SEATED_POSE, BODY_DELTAS, FACE, GAZE_STYLE, EMOTIONS, GAZES, GESTURES } from './config.js';

const clamp01 = (x) => Math.min(1, Math.max(0, Number.isFinite(x) ? x : 0));
const MOOD_NAME = 'patient_affect';

/**
 * The single entry point for the patient's emotional state. Debug buttons and (later)
 * the ElevenLabs `set_affect` tool call both end up here:
 *
 *   affect.setAffect({ emotion, intensity, gaze, gesture })
 *
 * It only talks to TalkingHead's public API (moods, poses, look-at), never to morphs/bones.
 */
export class Affect {
  constructor(head) {
    this.head = head;
    this.state = { emotion: 'neutral', intensity: 0.6, gaze: 'student', gesture: 'none' };
    this.basePose = this._makeBasePose();
    this.listeners = new Set();
  }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  setAffect(input = {}) {
    let { emotion, intensity, gaze, gesture } = input;
    const s = this.state;
    if (emotion !== undefined) {
      if (!EMOTIONS.includes(emotion)) { console.warn('[affect] unknown emotion', emotion); emotion = s.emotion; }
      s.emotion = emotion;
    }
    if (intensity !== undefined) s.intensity = clamp01(intensity);
    if (gaze !== undefined) {
      if (!GAZES.includes(gaze)) { console.warn('[affect] unknown gaze', gaze); } else { s.gaze = gaze; }
    }

    this._applyMood();
    this._applyPose();
    this._applyGaze(input.gaze !== undefined ? s.gaze : null);
    if (gesture && gesture !== 'none') {
      if (GESTURES.includes(gesture)) this.playGesture(gesture);
      else console.warn('[affect] unknown gesture', gesture);
    }
    this.listeners.forEach((fn) => fn({ ...s }));
    return { ...s };
  }

  // ---- mood (face + blink + idle eye behaviour) ----------------------------------------
  _applyMood() {
    const { emotion, intensity } = this.state;
    this.head.animMoods[MOOD_NAME] = this._buildMood(emotion, intensity);
    this.head.setMood(MOOD_NAME);
  }

  _buildMood(emotion, intensity) {
    const neutral = FACE.neutral;
    const target = FACE[emotion] || neutral;
    const baseline = {};
    for (const k of new Set([...Object.keys(neutral), ...Object.keys(target)])) {
      const a = neutral[k] ?? 0;
      const b = target[k] ?? 0;
      baseline[k] = a + (b - a) * intensity;
    }
    const style = GAZE_STYLE[emotion] || GAZE_STYLE.neutral;
    const tense = emotion === 'tense';
    const withdrawn = emotion === 'withdrawn';
    const k = intensity;

    const eyeAlt = (extra) => ({ delay: [200, 5000], dt: [200, [2000, 5000, 1, 2]], vs: extra });
    const idleEyes = { alt: [
      { p: style.studentProb, delay: [200, 4000], dt: [200, [2000, 5000], [3000, 9000, 1, 2]],
        vs: { headMove: [0.5], eyesRotateY: [[-0.3, 0.3]], eyesRotateX: [[-0.1, 0.3]], eyeContact: [null, 1] } },
      tense
        ? { delay: [100, 800], dt: [120, [250, 900]], vs: { headMove: [0.2 + 0.4 * k], eyesRotateY: [[-0.8, 0.8]], eyesRotateX: [[-0.2, 0.5]] } }
        : withdrawn
          ? { delay: [500, 4000], dt: [400, [2500, 6000]], vs: { headMove: [0.1], eyesRotateY: [[-0.25, 0.25]], eyesRotateX: [[0.3, 0.7]] } }
          : eyeAlt({ headMove: [0.4], eyesRotateY: [[-0.5, 0.5]], eyesRotateX: [[-0.2, 0.5]] })
    ]};
    const speakEyes = { alt: [
      { p: style.studentProb, delay: [200, 5000], dt: [0, [3000, 10000, 1, 2], [2000, 5000]],
        vs: { eyeContact: [1, null], headMove: [null, 0.4, null], eyesRotateY: [null, [-0.5, 0.5]], eyesRotateX: [null, [-0.2, 0.5]] } },
      eyeAlt({ headMove: [0.4, null], eyesRotateY: [[-0.5, 0.5]], eyesRotateX: [[-0.2, 0.5]] })
    ]};
    const blink = style.blinkFast
      ? { name: 'blink', delay: [300, 2200, 1, 2], dt: [50, [100, 200], 100], vs: { eyeBlinkLeft: [1, 1, 0], eyeBlinkRight: [1, 1, 0] } }
      : this.head.animTemplateBlink;
    const move = emotion === 'withdrawn' ? 0.4 : 1; // withdrawn = little movement

    return {
      baseline,
      speech: { deltaRate: 0, deltaPitch: 0, deltaVolume: 0 },
      anims: [
        { name: 'breathing', delay: 1500, dt: [1200 - 300 * k * (tense ? 1 : 0), 500, 1000], vs: { chestInhale: [0.5, 0.5, 0] } },
        { name: 'head',
          idle: { delay: [0, 1000], dt: [[200, 5000]], vs: { bodyRotateX: [[-0.02 * move, 0.05 * move]], bodyRotateY: [[-0.12 * move, 0.12 * move]], bodyRotateZ: [[-0.04 * move, 0.04 * move]] } },
          speaking: { dt: [[0, 1000, 0]], vs: { bodyRotateX: [[-0.03, 0.08, 1, 2]], bodyRotateY: [[-0.06, 0.06]], bodyRotateZ: [[-0.05, 0.05]] } } },
        { name: 'eyes', idle: idleEyes, speaking: speakEyes },
        blink
      ]
    };
  }

  // ---- body language (seated pose + emotion deltas) ------------------------------------
  _makeBasePose() {
    const straight = this.head.poseTemplates['straight'].props;
    const base = {};
    for (const [k, v] of Object.entries(straight)) base[k] = { x: v.x, y: v.y, z: v.z };
    this.applySeatedOverrides(base, SEATED_POSE);
    return base;
  }

  applySeatedOverrides(base, overrides) {
    for (const [k, v] of Object.entries(overrides)) base[k] = { ...v };
    return base;
  }

  /** Rebuild the base pose from edited SEATED_POSE values (used for live tuning). */
  setSeatedOverrides(overrides) {
    Object.assign(SEATED_POSE, overrides);
    this.basePose = this._makeBasePose();
    this._applyPose(80);
  }

  _applyPose(ms = 700) {
    const { emotion, intensity } = this.state;
    const props = {};
    for (const [k, v] of Object.entries(this.basePose)) props[k] = { ...v };
    for (const [k, d] of Object.entries(BODY_DELTAS[emotion] || {})) {
      const p = props[k] || (props[k] = { x: 0, y: 0, z: 0 });
      p.x += d.x * intensity; p.y += d.y * intensity; p.z += d.z * intensity;
    }
    // TalkingHead mirrors a *new* pose template when weight is not "on the left foot";
    // our seated pose is its own thing, so keep it from flipping left/right.
    this.head.poseWeightOnLeft = true;
    this.head.poseName = 'patient_seated';
    this.head.setPoseFromTemplate({ props }, ms);
  }

  // ---- gaze + gestures -----------------------------------------------------------------
  _applyGaze(gaze) {
    if (!gaze) return;
    const h = this.head;
    // Remove any previous explicit gaze override
    const i = h.animQueue.findIndex((a) => a.template.name === 'gaze_override');
    if (i !== -1) h.animQueue.splice(i, 1);
    if (gaze === 'student') {
      h.lookAtCamera(3000);
    } else if (gaze === 'away') {
      h.lookAhead(3000);
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
        name: 'gesture_nod', dt: [250, 250, 250, 300],
        vs: { bodyRotateX: [0.2, 0.02, 0.17, 0] }
      }));
    }
  }
}
