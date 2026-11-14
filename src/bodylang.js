/**
 * Procedural body language on top of TalkingHead's pose system.
 *
 * Continuous motion (hands, fingers, forearms, shoulders, feet, knees, breathing) is written every
 * frame as small euler deltas into `head.poseDelta` (bones TalkingHead's own morphs never touch,
 * see the PSYTRAIN PATCH in the vendored file). Slow whole-body changes (leaning, shifting weight)
 * go through the pose system via affect.setShiftOffset(). Look-around events use TalkingHead
 * animations (head + eyes), so lip-sync and moods stay untouched.
 *
 * Everything is driven by affect.getBehavior(): fidget, footTap, legBounce, shift, lookAround, breath.
 */

const TAU = Math.PI * 2;
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

/** Smooth pseudo-noise in [-1, 1]. */
const noise = (t, seed) =>
  (Math.sin(t + seed * 12.9898) + 0.5 * Math.sin(2.31 * t + seed * 4.1) + 0.25 * Math.sin(3.77 * t + seed * 7.3)) / 1.75;

/** Burst gate: smooth 0..1 envelope that is "on" for roughly `duty` of the time, in bursts. */
function burst(t, seed, duty, period = 14) {
  if (duty <= 0.001) return 0;
  const x = 0.5 + 0.5 * noise((t / period) * TAU, seed);          // 0..1 slow wave
  const thr = 1 - Math.min(0.95, duty);                             // higher duty -> lower threshold
  const v = (x - thr) / 0.12;
  return Math.max(0, Math.min(1, v));
}

const KEYS = [
  'Spine2', 'LeftShoulder', 'RightShoulder',
  'LeftArm', 'RightArm', 'LeftForeArm', 'RightForeArm', 'LeftHand', 'RightHand',
  'LeftUpLeg', 'RightUpLeg', 'LeftLeg', 'RightLeg', 'LeftFoot', 'RightFoot', 'LeftToeBase', 'RightToeBase',
  ...['Left', 'Right'].flatMap((s) => ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'].flatMap((f) => [1, 2, 3].map((n) => `${s}Hand${f}${n}`)))
].map((k) => k + '.quaternion');

export class BodyLanguage {
  constructor(head, affect) {
    this.head = head;
    this.affect = affect;
    this.enabled = true;
    this.t = 0;                       // seconds
    this.shiftTimer = rand(4, 9) * 1000;
    this.shiftHold = 0;
    this.lookTimer = rand(5, 12) * 1000;
    this.footSide = Math.random() < 0.5 ? 'Left' : 'Right';
    this.shrugT = -1;                 // seconds since shrug started (-1 = idle)
    this.seed = Math.random() * 100;
    this.target = {};                 // this frame's wanted deltas, smoothed into head.poseDelta
    this.phase = {};                  // integrated oscillator phases
    this.smooth = {};                 // eased behaviour values
    affect.bodyLang = this;
  }

  /** This frame's target delta for a bone (smoothed into head.poseDelta at the end of update()). */
  _d(key) { return this.target[key + '.quaternion'] || (this.target[key + '.quaternion'] = { x: 0, y: 0, z: 0 }); }

  /**
   * Phase of an oscillator whose frequency may change: integrated, so a new rate continues smoothly.
   * (sin(t * hz) with a changing hz jumps, and gets faster the longer the session runs.)
   */
  _osc(name, hz, dt) {
    this.phase[name] = ((this.phase[name] || 0) + TAU * hz * dt) % (TAU * 1000);
    return this.phase[name];
  }

  update(dtMs) {
    if (!this.enabled || !this.head.armature) return;
    this.affect.purgePoseAnims();
    const dt = Math.min(0.1, dtMs / 1000);
    this.t += dt;
    const t = this.t, sd = this.seed;
    // behaviour values ease towards their new level (~0.6 s), so a mood change does not make the hands jump
    const raw = this.affect.getBehavior();
    const kb = 1 - Math.exp(-dt / 0.6);
    for (const [k, v] of Object.entries(raw)) {
      if (typeof v !== 'number') continue;
      this.smooth[k] = this.smooth[k] === undefined ? v : this.smooth[k] + (v - this.smooth[k]) * kb;
    }
    const b = { ...raw, ...this.smooth };

    // reset this frame's targets
    for (const k of KEYS) { const d = this.target[k]; if (d) { d.x = 0; d.y = 0; d.z = 0; } }

    // ---- breathing (rib cage + shoulders) ----
    const bHz = 0.24 * b.breath;
    const breath = Math.sin(this._osc('breath', bHz, dt));
    this._d('Spine2').x += 0.014 * breath * (0.8 + 0.5 * b.breath);
    this._d('LeftShoulder').z += 0.012 * breath;
    this._d('RightShoulder').z -= 0.012 * breath;

    // ---- fidgeting hands / fingers ----
    const f = b.fidget;
    if (f > 0.01) {
      for (const [side, sgn, s2] of [['Left', 1, 0], ['Right', -1, 5]]) {
        const hand = this._d(side + 'Hand');
        // Keep the hand supported by the thigh. Tension should read as a small weight shift at the
        // wrist, not as a large bend that makes the fingers hover or spear into the leg.
        hand.x += f * 0.12 * (0.6 * noise(t * 1.4, sd + s2) - 0.4);
        hand.z += f * 0.08 * noise(t * 1.1, sd + s2 + 1);
        const fore = this._d(side + 'ForeArm');
        fore.x += f * 0.04 * (0.6 * noise(t * 0.9, sd + s2 + 2) - 0.4);
        fore.z += sgn * f * 0.035 * noise(t * 0.7, sd + s2 + 3);
        const arm = this._d(side + 'Arm');
        arm.y += f * 0.02 * noise(t * 0.6, sd + s2 + 4);
        // Finger picking / thumb rubbing. The base pose already has a natural curl, so these are
        // deliberately small and affect adjacent joints together rather than making claw shapes.
        const pick = burst(t, sd + s2 + 6, 0.28 + 0.35 * f, 11);
        const osc = 0.5 + 0.5 * Math.sin(this._osc('pick' + side, 1.4 + 0.3 * noise(t * 0.3, s2), dt));
        this._d(side + 'HandThumb1').x += f * 0.10 * pick * osc + f * 0.025 * noise(t * 2, s2);
        this._d(side + 'HandThumb2').x += f * 0.07 * pick * osc;
        this._d(side + 'HandIndex1').x += f * 0.08 * (0.3 + 0.7 * pick) * (0.5 + 0.5 * noise(t * 2.2, s2 + 8));
        this._d(side + 'HandIndex2').x += f * 0.06 * pick * osc;
        this._d(side + 'HandMiddle1').x += f * 0.035 * noise(t * 1.7, s2 + 9);
        this._d(side + 'HandRing2').x += f * 0.025 * noise(t * 1.9, s2 + 10);
      }
      // Only clasped hands can wring against one another. Resting hands make smaller independent
      // movements above; applying this motion while they are apart unnaturally rolls both wrists.
      if (b.arms === 'clasped') {
        const wring = burst(t, sd + 20, f * 0.55, 18) * Math.sin(this._osc('wring', 0.8, dt));
        this._d('LeftForeArm').z += f * 0.04 * wring;
        this._d('RightForeArm').z -= f * 0.04 * wring;
        this._d('LeftHand').z += f * 0.06 * wring;
        this._d('RightHand').z -= f * 0.06 * wring;
      }
    }

    // ---- foot tap & knee bounce ----
    if (b.footTap > 0.01) {
      const g = burst(t, sd + 30, b.footTap * 0.8, 12);
      const tap = Math.max(0, Math.sin(this._osc('tap', 2.1, dt)));
      this._d(this.footSide + 'Foot').x -= 0.30 * g * tap;     // heel up, ball of foot down
      this._d(this.footSide + 'ToeBase').x += 0.1 * g * tap;
    }
    if (b.legBounce > 0.01) {
      const g = burst(t, sd + 40, b.legBounce * 0.9, 16);
      const ph0 = this._osc('bounce', 3.6, dt);
      const bounce = Math.sin(ph0);
      for (const side of ['Left', 'Right']) {
        const ph = side === 'Left' ? 0 : 0.6;
        this._d(side + 'UpLeg').x += 0.045 * g * Math.sin(ph0 + ph) * (0.5 + 0.5 * b.legBounce);
      }
      this._d('Spine2').x += 0.01 * g * bounce;
    }

    // ---- tension twitch of the shoulders (small random hitches) ----
    const hitch = Math.max(0, noise(t * 0.5, sd + 50) - 0.55) * 2;
    this._d('LeftShoulder').z += 0.10 * hitch * (0.3 + b.headMotion);
    this._d('RightShoulder').z -= 0.10 * hitch * (0.3 + b.headMotion);

    // ---- shrug (gesture) ----
    if (this.shrugT >= 0) {
      this.shrugT += dt;
      const e = Math.sin(Math.min(1, this.shrugT / 1.4) * Math.PI);
      this._d('LeftShoulder').z += 0.38 * e;
      this._d('RightShoulder').z -= 0.38 * e;
      this._d('LeftForeArm').z += 0.15 * e;
      this._d('RightForeArm').z -= 0.15 * e;
      if (this.shrugT > 1.4) this.shrugT = -1;
    }

    // ---- this frame's targets -> the bones, through a light low-pass (~70 ms) ----
    // removes the last steps and jerks (bursts switching on, gestures starting) without making her sluggish;
    // fast rhythms like the knee bounce keep most of their size
    const ko = 1 - Math.exp(-dt / 0.07);
    for (const k of KEYS) {
      const d = this.head.poseDelta.props[k], tg = this.target[k];
      if (!d) continue;
      const x = tg ? tg.x : 0, y = tg ? tg.y : 0, z = tg ? tg.z : 0;
      d.x += (x - d.x) * ko; d.y += (y - d.y) * ko; d.z += (z - d.z) * ko;
      if (Math.abs(d.x) < 1e-6) d.x = 0; if (Math.abs(d.y) < 1e-6) d.y = 0; if (Math.abs(d.z) < 1e-6) d.z = 0;
    }

    // ---- schedulers ----
    this.shiftTimer -= dtMs;
    if (this.shiftTimer <= 0) this._shift(b);
    this.lookTimer -= dtMs;
    if (this.lookTimer <= 0) this._lookTick(b);
  }

  // ---- posture shifts: lean / weight change, then settle back ----
  _shift(b) {
    if (this.shiftHold > 0) {      // return to neutral posture
      this.shiftHold = 0;
      this.affect.setShiftOffset({}, 1800);
      this.shiftTimer = rand(5, 14) * 1000 / Math.max(0.15, b.shift);
      return;
    }
    if (b.shift < 0.05) { this.shiftTimer = 5000; return; }
    const a = 0.35 + 0.9 * b.shift;
    const kinds = [
      // lean forward
      { 'Spine.rotation': { x: 0.06 * a, y: 0, z: 0 }, 'Spine1.rotation': { x: 0.06 * a, y: 0, z: 0 }, 'Head.rotation': { x: -0.03 * a, y: 0, z: 0 } },
      // lean back
      { 'Spine.rotation': { x: -0.05 * a, y: 0, z: 0 }, 'Spine1.rotation': { x: -0.05 * a, y: 0, z: 0 } },
      // weight to one side
      (() => { const s = pick([-1, 1]); return { 'Hips.rotation': { x: 0, y: 0, z: 0.03 * a * s }, 'Spine.rotation': { x: 0, y: 0, z: -0.05 * a * s }, 'Spine1.rotation': { x: 0, y: 0, z: -0.04 * a * s }, 'Head.rotation': { x: 0, y: 0, z: 0.05 * a * s } }; })(),
      // twist toward one side
      (() => { const s = pick([-1, 1]); return { 'Spine.rotation': { x: 0, y: 0.08 * a * s, z: 0 }, 'Spine1.rotation': { x: 0, y: 0.08 * a * s, z: 0 }, 'Hips.rotation': { x: 0, y: -0.04 * a * s, z: 0 } }; })(),
      // slump a little
      { 'Spine.rotation': { x: 0.08 * a, y: 0, z: 0 }, 'Spine1.rotation': { x: 0.06 * a, y: 0, z: 0 }, 'Neck.rotation': { x: 0.06 * a, y: 0, z: 0 } }
    ];
    this.shiftHold = 1;
    this.affect.setShiftOffset(pick(kinds), rand(1200, 2200));
    this.shiftTimer = rand(3.5, 9) * 1000;
  }

  // ---- looking around ----
  _lookTick(b) {
    const rate = b.lookAround;
    this.lookTimer = rand(6, 16) * 1000 / Math.max(0.05, rate);
    if (rate < 0.03) return;
    if (Math.random() < 0.15 + 0.85 * rate) this.lookAround();
  }

  /** Look somewhere else in the room for a moment (door, window, floor, ceiling, aside). */
  lookAround() {
    const g = this.affect.gaze, b = this.affect.getBehavior();
    if (!g) return;
    const targets = [
      { yaw: 0.7, pitch: 0.0 }, { yaw: -0.7, pitch: 0.0 },       // left / right
      { yaw: 1.1, pitch: -0.05 }, { yaw: -1.1, pitch: -0.05 },   // door / window, further round
      { yaw: 0.3, pitch: -0.45 }, { yaw: -0.3, pitch: -0.5 },    // floor
      { yaw: 0.4, pitch: 0.5 }                                    // ceiling
    ];
    const tg = pick(targets);
    const dur = rand(1.2, 3.0) * (b.lookAround > 0.5 ? 0.6 : 1);
    g.lookAt(tg.yaw, tg.pitch, dur, 0.6);
    // anxious patients often glance twice
    if (b.lookAround > 0.55 && Math.random() < 0.5) {
      setTimeout(() => g.lookAt(-tg.yaw * 0.7, tg.pitch * 0.5, rand(0.5, 1.0), 0.5), (dur + 0.9) * 1000);
    }
  }

  shrug() { this.shrugT = 0; }
}
