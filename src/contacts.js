import * as THREE from 'three';

/**
 * Keeps hands and fingers outside the patient's thighs and torso without replacing the authored pose.
 *
 * The avatar's own skinned surface is sampled once into small radial profiles attached to the leg and
 * spine bones. Each frame, after TalkingHead has posed the skeleton, a penetrating point is freed by the
 * most local joint first: a fingertip by straightening its finger, then the wrist, then (by under 3 degrees)
 * the elbow. The shoulder / upper arm is never moved, so the authored rest, clasped and crossed poses keep
 * the same arm posture they had before this file existed.
 */
const FINGERS = ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'];
const AXIAL_BINS = 16, ANGLE_BINS = 24;
const TAU = Math.PI * 2;
const SKIP_MESH = /head|eye|teeth|tongue|lash|hair|brow/i;
const MAX_STEP = 0.03;                  // rad per solver pass at the wrist / elbow
const FINGER_STEP = 0.07;               // rad per solver pass at a finger joint
// rad, total correction per joint. Fingers may straighten only a little (so the relaxed curl stays),
// the wrist a little, and the elbow may bend a bit more when a resting hand is pushed down (as a real elbow
// does when you lean on your thighs). The shoulder is never moved.
const JOINT_LIMITS = { finger1: 0.18, finger2: 0.22, hand: 0.15, fore: 0.22 };

const _v = new THREE.Vector3(), _l = new THREE.Vector3(), _n = new THREE.Vector3(), _a = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _q = new THREE.Quaternion(), _dq = new THREE.Quaternion(), _loc = new THREE.Quaternion();
const _scale = new THREE.Vector3(), _I = new THREE.Quaternion();
const _chain = new THREE.Quaternion(), _lean = new THREE.Quaternion(), _e = new THREE.Euler();
const hit = { x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, sample: null, proxy: null };

export class Contacts {
  constructor(head, affect = null, { margin = 0.0015, releaseClear = 0.007, fall = 0.28 } = {}) {
    this.head = head;
    this.affect = affect;
    this.margin = margin;
    this.releaseClear = releaseClear;
    this.fall = fall;
    this.enabled = true;
    this.measure = false;
    this.ready = false;
    this.t = 0;
    this.armMode = null;
    this.lapWeight = 1;
    this.resetStats();
  }

  resetStats() {
    this.stats = { frames: 0, contactFrames: 0, leftFrames: 0, maxBefore: 0, maxAfter: 0, sumBefore: 0, sumAfter: 0 };
  }

  _proxy(bone, child, kind, side, sources, threshold) {
    if (!bone || !child) return null;
    const axis = child.position.clone();
    const len = axis.length();
    if (len < 0.02) return null;
    axis.divideScalar(len);
    const u = new THREE.Vector3(1, 0, 0);
    if (Math.abs(u.dot(axis)) > 0.9) u.set(0, 1, 0);
    u.sub(_v.copy(axis).multiplyScalar(u.dot(axis))).normalize();
    const w = new THREE.Vector3().crossVectors(axis, u);
    return {
      bone, kind, side, sources: sources.filter(Boolean), threshold, len,
      table: new Float32Array(AXIAL_BINS * ANGLE_BINS), inv: new THREE.Matrix4(), normal: new THREE.Matrix3(), used: 0,
      ax: axis.x, ay: axis.y, az: axis.z,
      ux: u.x, uy: u.y, uz: u.z, wx: w.x, wy: w.y, wz: w.z
    };
  }

  /** Measure body surfaces after the initial seated pose has settled. */
  build() {
    const arm = this.head.armature;
    if (!arm) return false;
    arm.updateMatrixWorld(true);
    const bone = (n) => arm.getObjectByName(n);

    this.proxies = [];
    for (const side of ['Left', 'Right']) {
      const up = bone(side + 'UpLeg');
      const p = this._proxy(up, bone(side + 'Leg'), 'thigh', side, [up], 0.5);
      if (p) this.proxies.push(p);
    }
    // Several short profiles follow bends of the abdomen and chest better than one large torso cylinder.
    for (const [a, b] of [['Hips', 'Spine'], ['Spine', 'Spine1'], ['Spine1', 'Spine2'], ['Spine2', 'Neck']]) {
      const parent = bone(a), child = bone(b);
      // Use vertices chiefly controlled by this segment's parent. Including child-weighted vertices makes
      // the sampled surface drift away from the live mesh when the spine bends or breathes.
      const p = this._proxy(parent, child, 'torso', null, [parent], 0.45);
      if (p) this.proxies.push(p);
    }
    if (!this.proxies.length) return false;

    const inv = this.proxies.map((p) => new THREE.Matrix4().copy(p.bone.matrixWorld).invert());
    arm.traverse((mesh) => {
      if (!mesh.isSkinnedMesh || SKIP_MESH.test(mesh.name)) return;
      const g = mesh.geometry, si = g.attributes.skinIndex, sw = g.attributes.skinWeight, pos = g.attributes.position;
      if (!si || !sw || !pos) return;
      const sourceIndices = this.proxies.map((p) => p.sources.map((b) => mesh.skeleton.bones.indexOf(b)).filter((i) => i >= 0));
      for (let i = 0; i < pos.count; i++) {
        for (let k = 0; k < this.proxies.length; k++) {
          const indices = sourceIndices[k];
          if (!indices.length) continue;
          let weight = 0;
          for (let j = 0; j < 4; j++) if (indices.includes(si.getComponent(i, j))) weight += sw.getComponent(i, j);
          if (weight < this.proxies[k].threshold) continue;
          mesh.getVertexPosition(i, _v);
          _v.applyMatrix4(mesh.matrixWorld).applyMatrix4(inv[k]);
          if (this._addToTable(this.proxies[k], _v)) this.proxies[k].used++;
        }
      }
    });
    this.proxies = this.proxies.filter((p) => p.used > 20);
    for (const p of this.proxies) this._fillTable(p);

    this.hands = [];
    for (const side of ['Left', 'Right']) {
      const hand = bone(side + 'Hand'), upper = bone(side + 'Arm'), fore = bone(side + 'ForeArm');
      if (!hand || !upper || !fore) continue;
      // Corrections, ordered from parent to child so they are re-applied in a valid order each frame.
      // The upper arm is never touched: the authored arm silhouette stays exactly as designed.
      const fore_ = { name: 'fore', bone: fore, q: new THREE.Quaternion(), max: JOINT_LIMITS.fore, step: MAX_STEP, minArm: 0.025 };
      const hand_ = { name: 'hand', bone: hand, q: new THREE.Quaternion(), max: JOINT_LIMITS.hand, step: MAX_STEP, minArm: 0.025 };
      const corrections = [fore_, hand_];
      // Radius is the skin around each skeletal sample, not extra clearance. Small values preserve contact.
      // `chain` lists what may move to free the sample, most local first: a fingertip is freed by
      // straightening that finger before the wrist bends, and the elbow is the last resort.
      const samples = [{ a: hand, b: null, kind: 'palm', radius: 0.006, chain: [hand_, fore_] }];
      for (const finger of FINGERS) {
        const joints = [1, 2, 3].map((n) => bone(`${side}Hand${finger}${n}`));
        // Constrain collision correction to each finger's actual flexion axis. Rotating around the
        // unconstrained world-space optimum can push a knuckle sideways and produce a dislocated look.
        const flexAxis = finger === 'Thumb' ? 'z' : 'x';
        // Positive X closes the four fingers. Thumb curl is mirrored, so extension is +Z on the
        // left and -Z on the right.
        const extensionSign = finger === 'Thumb' ? (side === 'Left' ? 1 : -1) : -1;
        const f1 = joints[0] && { name: finger + '1', bone: joints[0], q: new THREE.Quaternion(), max: JOINT_LIMITS.finger1, step: FINGER_STEP, minArm: 0.008, flexAxis, extensionSign };
        const f2 = joints[1] && { name: finger + '2', bone: joints[1], q: new THREE.Quaternion(), max: JOINT_LIMITS.finger2, step: FINGER_STEP, minArm: 0.006, flexAxis, extensionSign };
        if (f1) corrections.push(f1);
        if (f2) corrections.push(f2);
        if (joints[0]) samples.push({ a: joints[0], b: null, kind: 'knuckle', radius: 0.0045, chain: [hand_, fore_] });
        if (joints[1]) samples.push({ a: joints[1], b: null, kind: 'joint', radius: 0.004, chain: [f1, hand_, fore_].filter(Boolean) });
        if (joints[2] && joints[1]) samples.push({ a: joints[2], b: joints[1], kind: 'tip', radius: 0.0035, chain: [f2, f1, hand_, fore_].filter(Boolean) });
      }
      this.hands.push({ side, upper, fore, hand, samples, corrections, clear: -1 });
    }
    this.spine = ['Spine', 'Spine1', 'Spine2'].map(bone);
    this.lapRef = this._authoredSpine();
    this.ready = this.proxies.length > 0 && this.hands.length > 0 && this.spine.every(Boolean);
    this.vertexCount = this.proxies.reduce((sum, p) => sum + p.used, 0);
    return this.ready;
  }

  /** Spine1-Spine2 chain of the authored seated pose (no emotion lean, no posture shift), relative to the hips. */
  _authoredSpine() {
    const props = this.affect?._basePose ? this.affect._basePose('rest') : {};
    const q = new THREE.Quaternion();
    for (const name of ['Spine', 'Spine1', 'Spine2']) {
      const r = props[name + '.rotation'];
      if (r) q.multiply(_q.setFromEuler(_e.set(r.x, r.y, r.z, 'XYZ')));
    }
    return q;
  }

  /**
   * Hands that rest in the lap belong to the lap, not to the chest. When an emotion or a posture shift leans
   * the spine, turn each upper arm back by that extra lean, so the arm keeps its authored direction relative
   * to the hips: leaning forward slides the hands along the thighs (as a person does) instead of pressing
   * them into the legs. Crossed arms belong to the chest and move with it (weight 0).
   */
  _followLap(dt) {
    const target = this.armMode === 'crossed' ? 0 : 1;
    this.lapWeight += (target - this.lapWeight) * (1 - Math.exp(-dt / 0.35));
    if (this.lapWeight < 1e-3) return;
    _chain.identity();
    for (const b of this.spine) _chain.multiply(b.quaternion);
    _lean.copy(_chain).invert().multiply(this.lapRef);                     // C^-1 * R, in the chest frame
    if (this.lapWeight < 0.999) _lean.slerp(_I, 1 - this.lapWeight);
    for (const hand of this.hands) {
      const shoulder = hand.upper.parent;                                    // LeftShoulder / RightShoulder
      // Arm' = Sh^-1 * (C^-1 R) * Sh * Arm keeps the arm's orientation in the hips' frame
      _loc.copy(shoulder.quaternion).invert().multiply(_lean).multiply(shoulder.quaternion);
      hand.upper.quaternion.premultiply(_loc);
      hand.upper.updateMatrixWorld(true);
    }
  }

  _addToTable(proxy, p) {
    const axial = p.x * proxy.ax + p.y * proxy.ay + p.z * proxy.az;
    const ai = Math.floor(((axial / proxy.len) + 0.1) / 1.2 * AXIAL_BINS);
    if (ai < 0 || ai >= AXIAL_BINS) return false;
    const x = p.x * proxy.ux + p.y * proxy.uy + p.z * proxy.uz;
    const y = p.x * proxy.wx + p.y * proxy.wy + p.z * proxy.wz;
    const gi = Math.floor(((Math.atan2(y, x) + Math.PI) / TAU) * ANGLE_BINS) % ANGLE_BINS;
    const idx = ai * ANGLE_BINS + gi, radius = Math.hypot(x, y);
    if (radius > proxy.table[idx]) proxy.table[idx] = radius;
    return true;
  }

  /** Fill only small sampling gaps, averaging neighbours instead of inflating them to the largest one. */
  _fillTable(proxy) {
    const table = proxy.table;
    for (let pass = 0; pass < 2; pass++) {
      const copy = table.slice();
      for (let ai = 0; ai < AXIAL_BINS; ai++) for (let gi = 0; gi < ANGLE_BINS; gi++) {
        const idx = ai * ANGLE_BINS + gi;
        if (copy[idx] > 0) continue;
        let sum = 0, count = 0;
        for (const [da, dg] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
          const a2 = ai + da, g2 = (gi + dg + ANGLE_BINS) % ANGLE_BINS;
          if (a2 < 0 || a2 >= AXIAL_BINS) continue;
          const r = copy[a2 * ANGLE_BINS + g2];
          if (r > 0) { sum += r; count++; }
        }
        if (count >= 2) table[idx] = sum / count;
      }
    }
  }

  _surface(proxy, axial, angle) {
    const af = ((axial / proxy.len) + 0.1) / 1.2 * AXIAL_BINS - 0.5;
    const a0 = Math.floor(af), at = af - a0;
    if (a0 < -1 || a0 >= AXIAL_BINS) return 0;
    const gf = ((angle + Math.PI) / TAU) * ANGLE_BINS - 0.5;
    const g0 = Math.floor(gf), gt = gf - g0;
    let sum = 0, weights = 0;
    for (const [ai, aw] of [[a0, 1 - at], [a0 + 1, at]]) {
      if (ai < 0 || ai >= AXIAL_BINS || aw <= 0) continue;
      for (const [gi0, gw] of [[g0, 1 - gt], [g0 + 1, gt]]) {
        if (gw <= 0) continue;
        const gi = (gi0 + ANGLE_BINS) % ANGLE_BINS;
        const radius = proxy.table[ai * ANGLE_BINS + gi];
        if (radius > 0) { const weight = aw * gw; sum += radius * weight; weights += weight; }
      }
    }
    return weights > 0 ? sum / weights : 0;
  }

  _usesProxy(hand, proxy, mode) {
    if (proxy.kind === 'torso') return true;
    const usesThigh = (armMode) => armMode !== 'crossed' && (armMode === 'clasped' || proxy.side === hand.side);
    // During a pose blend, protect both the old and new paths. This avoids a brief collision gap when
    // a rest/clasped hand is still beside a thigh on its way into the crossed pose.
    return usesThigh(mode) || (this.transitionLeft > 0 && usesThigh(this.previousArmMode));
  }

  /** Return deepest penetration; `hit` receives its point, normal, sample and body proxy. */
  _probe(hand, mode) {
    let best = -1;
    for (const proxy of this.proxies) {
      if (!this._usesProxy(hand, proxy, mode)) continue;
      const e = proxy.inv.elements, normal = proxy.normal.elements;
      for (const sample of hand.samples) {
        const ae = sample.a.matrixWorld.elements;
        let x = ae[12], y = ae[13], z = ae[14];
        if (sample.b) {
          const be = sample.b.matrixWorld.elements;
          x += 0.72 * (x - be[12]); y += 0.72 * (y - be[13]); z += 0.72 * (z - be[14]);
        }
        const lx = e[0] * x + e[4] * y + e[8] * z + e[12];
        const ly = e[1] * x + e[5] * y + e[9] * z + e[13];
        const lz = e[2] * x + e[6] * y + e[10] * z + e[14];
        const axial = lx * proxy.ax + ly * proxy.ay + lz * proxy.az;
        const cx = lx * proxy.ux + ly * proxy.uy + lz * proxy.uz;
        const cy = lx * proxy.wx + ly * proxy.wy + lz * proxy.wz;
        const radius = Math.hypot(cx, cy);
        const surface = this._surface(proxy, axial, Math.atan2(cy, cx));
        if (!surface) continue;
        const depth = surface + sample.radius + this.margin - radius;
        if (depth <= best || radius < 1e-6) continue;
        best = depth;
        hit.x = x; hit.y = y; hit.z = z; hit.sample = sample; hit.proxy = proxy;
        const nlx = (cx * proxy.ux + cy * proxy.wx) / radius;
        const nly = (cx * proxy.uy + cy * proxy.wy) / radius;
        const nlz = (cx * proxy.uz + cy * proxy.wz) / radius;
        _n.set(
          normal[0] * nlx + normal[3] * nly + normal[6] * nlz,
          normal[1] * nlx + normal[4] * nly + normal[7] * nlz,
          normal[2] * nlx + normal[5] * nly + normal[8] * nlz
        ).normalize();
        hit.nx = _n.x; hit.ny = _n.y; hit.nz = _n.z;
      }
    }
    return best;
  }

  _applyWorldRotation(entry, rotation) {
    entry.bone.parent.matrixWorld.decompose(_v, _q, _scale);
    _loc.copy(_q).invert().multiply(rotation).multiply(_q);
    entry.bone.quaternion.premultiply(_loc);
    entry.bone.updateMatrixWorld(true);
  }

  _fadeAndApply(hand, dt, raw) {
    const transitioning = this.transitionLeft > 0;
    const fade = transitioning || hand.clear < -this.releaseClear || raw < -this.releaseClear
      ? 1 - Math.exp(-dt / (transitioning ? 0.2 : this.fall))
      : 0;
    for (const entry of hand.corrections) {
      if (fade) entry.q.slerp(_I, fade);
      if (entry.q.angleTo(_I) < 1e-4) entry.q.identity();
      else this._applyWorldRotation(entry, entry.q);
    }
  }

  _correctAt(entry, depth) {
    const used = entry.q.angleTo(_I);
    const remaining = entry.max - used;
    if (remaining <= 1e-4) return false;
    entry.bone.getWorldPosition(_v);
    _l.set(hit.x, hit.y, hit.z).sub(_v);
    _n.set(hit.nx, hit.ny, hit.nz);
    _a.crossVectors(_l, _n);

    let axis = _a;
    let arm = _a.length();
    if (entry.flexAxis) {
      entry.bone.getWorldQuaternion(_q);
      _axis.set(entry.flexAxis === 'x' ? 1 : 0, 0, entry.flexAxis === 'z' ? 1 : 0)
        .applyQuaternion(_q).multiplyScalar(entry.extensionSign).normalize();
      const signedArm = _axis.dot(_a);
      // Extension cannot resolve this contact, so leave the finger alone and let the wrist or
      // elbow handle it. Never curl a fingertip farther into the body just to gain clearance.
      if (signedArm <= entry.minArm) return false;
      arm = signedArm;
      axis = _axis;
    }
    if (arm < entry.minArm) return false;
    const angle = Math.min(entry.step, remaining, depth * 1.06 / arm);
    if (angle <= 1e-5) return false;
    _dq.setFromAxisAngle(axis.normalize(), angle);
    entry.q.premultiply(_dq).normalize();
    this._applyWorldRotation(entry, _dq);
    return true;
  }

  /** Free the deepest point with the most local joint that still has budget (finger, then wrist, then elbow). */
  _solve(hand, mode) {
    let depth = this._probe(hand, mode);
    for (let pass = 0; pass < 8 && depth > 0.0002; pass++) {
      let changed = false;
      for (const entry of hit.sample?.chain || []) {
        if (this._correctAt(entry, depth)) { changed = true; break; }
      }
      if (!changed) break;
      depth = this._probe(hand, mode);
    }
    return depth;
  }

  /** Call every frame after head.animate(). */
  update(dtMs) {
    if (!this.enabled) return;
    const dt = Math.min(0.1, dtMs / 1000);
    this.t += dt;
    if (!this.ready) {
      if (this.t > 1.2 && !this.tried) { this.tried = true; this.build(); }
      return;
    }

    const mode = this.affect?.getBehavior().arms || 'rest';
    if (this.armMode === null) this.armMode = mode;
    else if (mode !== this.armMode) {
      this.previousArmMode = this.armMode;
      this.armMode = mode;
      this.transitionLeft = 1.0;
    }

    this.head.armature.updateMatrixWorld(true);
    for (const proxy of this.proxies) {
      proxy.inv.copy(proxy.bone.matrixWorld).invert();
      proxy.normal.getNormalMatrix(proxy.bone.matrixWorld);
    }
    this._followLap(dt);

    let before = 0, after = 0;
    for (const hand of this.hands) {
      // depth of the pose as animated, without any correction: when the hand is clear by itself, let go
      const raw = this._probe(hand, mode);
      if (this.measure) before = Math.max(before, raw);
      this._fadeAndApply(hand, dt, raw);
      let depth = this._probe(hand, mode);
      if (depth > 0) depth = this._solve(hand, mode);
      // corrections that do not actually help (deeper than the untouched pose) are released, never kept bent
      hand.clear = raw > 0 && depth > raw - 0.001 ? -1 : depth;
      if (this.measure) after = Math.max(after, this._probe(hand, mode));
    }
    if (this.transitionLeft > 0) this.transitionLeft = Math.max(0, this.transitionLeft - dt);
    if (this.measure) {
      const stats = this.stats;
      stats.frames++;
      if (before > 0.003) stats.contactFrames++;
      if (after > 0.003) stats.leftFrames++;
      stats.maxBefore = Math.max(stats.maxBefore, before); stats.maxAfter = Math.max(stats.maxAfter, after);
      stats.sumBefore += Math.max(0, before); stats.sumAfter += Math.max(0, after);
    }
  }
}
