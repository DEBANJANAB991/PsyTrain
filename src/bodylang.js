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
    affect.bodyLang = this;
  }

  _d(key) { return this.head.poseDelta.props[key + '.quaternion']; }

  update(dtMs) {
    if (!this.enabled || !this.head.armature) return;
    this.affect.purgePoseAnims();
    const dt = dtMs / 1000;
    this.t += dt;
    const t = this.t, sd = this.seed;
    const b = this.affect.getBehavior();

    // reset my channels
    for (const k of KEYS) { const d = this.head.poseDelta.props[k]; if (d) { d.x = 0; d.y = 0; d.z = 0; } }

    // ---- breathing (rib cage + shoulders) ----
    const bHz = 0.24 * b.breath;
    const breath = Math.sin(t * TAU * bHz);
    this._d('Spine2').x += 0.014 * breath * (0.8 + 0.5 * b.breath);
    this._d('LeftShoulder').z += 0.012 * breath;
    this._d('RightShoulder').z -= 0.012 * breath;

    // ---- fidgeting hands / fingers ----
    const f = b.fidget;
    if (f > 0.01) {
      for (const [side, sgn, s2] of [['Left', 1, 0], ['Right', -1, 5]]) {
        const hand = this._d(side + 'Hand');
        hand.x += f * 0.28 * noise(t * 1.4, sd + s2);
        hand.z += f * 0.22 * noise(t * 1.1, sd + s2 + 1);
        const fore = this._d(side + 'ForeArm');
        fore.x += f * 0.10 * noise(t * 0.9, sd + s2 + 2);
        fore.z += sgn * f * 0.08 * noise(t * 0.7, sd + s2 + 3);
        const arm = this._d(side + 'Arm');
        arm.y += f * 0.05 * noise(t * 0.6, sd + s2 + 4);
        // finger picking / thumb rubbing: bursts with rapid oscillation
        const pick = burst(t, sd + s2 + 6, 0.35 + 0.5 * f, 11);
        const osc = 0.5 + 0.5 * Math.sin(t * TAU * (1.6 + 0.8 * noise(t * 0.3, s2)));
        this._d(side + 'HandThumb1').x += f * 0.35 * pick * osc + f * 0.1 * noise(t * 2, s2);
        this._d(side + 'HandThumb2').x += f * 0.25 * pick * osc;
        this._d(side + 'HandIndex1').x += f * 0.30 * (0.3 + 0.7 * pick) * (0.5 + 0.5 * noise(t * 2.2, s2 + 8));
        this._d(side + 'HandIndex2').x += f * 0.22 * pick * osc;
        this._d(side + 'HandMiddle1').x += f * 0.15 * noise(t * 1.7, s2 + 9);
        this._d(side + 'HandRing2').x += f * 0.12 * noise(t * 1.9, s2 + 10);
      }
      // wringing: forearms rock against each other in bursts
      const wring = burst(t, sd + 20, f * 0.7, 18) * Math.sin(t * TAU * 0.9);
      this._d('LeftForeArm').z += f * 0.10 * wring;
      this._d('RightForeArm').z -= f * 0.10 * wring;
      this._d('LeftHand').z += f * 0.2 * wring;
      this._d('RightHand').z -= f * 0.2 * wring;
    }

    // ---- foot tap & knee bounce ----
    if (b.footTap > 0.01) {
      const g = burst(t, sd + 30, b.footTap * 0.8, 12);
      const tap = Math.max(0, Math.sin(t * TAU * 2.1));
      this._d(this.footSide + 'Foot').x -= 0.30 * g * tap;     // heel up, ball of foot down
      this._d(this.footSide + 'ToeBase').x += 0.1 * g * tap;
    }
    if (b.legBounce > 0.01) {
      const g = burst(t, sd + 40, b.legBounce * 0.9, 16);
      const bounce = Math.sin(t * TAU * 3.6);
      for (const side of ['Left', 'Right']) {
        const ph = side === 'Left' ? 0 : 0.6;
        this._d(side + 'UpLeg').x += 0.045 * g * Math.sin(t * TAU * 3.6 + ph) * (0.5 + 0.5 * b.legBounce);
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
    const h = this.head, a = this.affect, b = a.getBehavior();
    const targets = [
      { yaw: 0.55, pitch: 0.0 }, { yaw: -0.55, pitch: 0.0 },     // left / right
      { yaw: 0.8, pitch: -0.05 }, { yaw: -0.8, pitch: -0.05 },   // door / window, further round
      { yaw: 0.2, pitch: 0.25 }, { yaw: -0.2, pitch: 0.3 },      // floor
      { yaw: 0.3, pitch: -0.25 }                                  // ceiling
    ];
    const tg = pick(targets);
    const dur = rand(1100, 2800) * (b.lookAround > 0.5 ? 0.6 : 1);
    a._removeAnim('look_around');
    h.animQueue.push(h.animFactory({
      name: 'look_around',
      dt: [rand(350, 600), dur, rand(450, 700)],
      vs: {
        bodyRotateY: [tg.yaw * 0.7, tg.yaw * 0.7, 0], bodyRotateX: [tg.pitch * 0.4, tg.pitch * 0.4, 0],
        eyesRotateY: [tg.yaw * 0.7, tg.yaw * 0.7, 0], eyesRotateX: [tg.pitch, tg.pitch, 0],
        eyeContact: [0, 0, 0], headMove: [0.9, 0.9, 0]
      }
    }));
    // anxious patients often glance twice
    if (b.lookAround > 0.55 && Math.random() < 0.5) {
      setTimeout(() => {
        a._removeAnim('look_around');
        h.animQueue.push(h.animFactory({
          name: 'look_around', dt: [300, rand(500, 1000), 400],
          vs: { bodyRotateY: [-tg.yaw * 0.5, -tg.yaw * 0.5, 0], eyesRotateY: [-tg.yaw * 0.5, -tg.yaw * 0.5, 0], eyeContact: [0, 0, 0], headMove: [0.9, 0.9, 0] }
        }));
      }, dur + 900);
    }
  }

  shrug() { this.shrugT = 0; }
}
