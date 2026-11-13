import * as THREE from 'three';

/**
 * Keeps her hands and fingers on top of her thighs instead of inside them.
 *
 * Set-up (once, about a second after loading): the thighs' real surface is measured from the avatar's own skinned
 * vertices (skin and clothes) as a table of radius by position along the thigh and angle around it, in the thigh
 * bone's local space, so it moves with the leg.
 *
 * Every frame, after TalkingHead has posed the skeleton (head.animate), ONE pass per hand:
 *   1. re-apply the lift of the last frame (a small rotation of the upper arm at the shoulder, kept per hand),
 *   2. test 11 points (palm, finger middle joints, fingertips) against both thighs,
 *   3. if the deepest point is inside, add exactly the extra rotation that brings it back onto the surface;
 *      if the hand is clearly above the leg, let the lift fade out slowly (hysteresis, so it never chatters).
 * The lift follows the hand continuously, so it needs no easing and cannot pop. TalkingHead rebuilds the bones from
 * the pose every frame, so nothing accumulates. No objects are created per frame (no garbage collection stutter).
 *
 * `measure = true` additionally records, per frame, how deep the hands were inside the thighs before and after
 * the lift (costs two more tests per hand; off by default).
 */
const FINGERS = ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'];
const AXIAL_BINS = 16, ANGLE_BINS = 24;
const TAU = Math.PI * 2;
const SKIP_MESH = /head|eye|teeth|tongue|lash|hair|brow/i;
const MAX_LIFT = 0.42;                   // rad, total correction at one elbow
const MAX_STEP = 0.055;                  // rad, largest extra lift in one frame
const UP_BIAS = 0.55;                    // prefer a small upward correction without throwing the arm outward

const _v = new THREE.Vector3(), _l = new THREE.Vector3(), _n = new THREE.Vector3(), _a = new THREE.Vector3();
const _q = new THREE.Quaternion(), _dq = new THREE.Quaternion(), _loc = new THREE.Quaternion();
const _m = new THREE.Matrix4(), _I = new THREE.Quaternion();
const hit = { x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0 };

export class Contacts {
  constructor(head, { margin = 0.008, releaseClear = 0.012, fall = 0.4 } = {}) {
    this.head = head;
    this.margin = margin;           // m above the surface the hand should stay
    this.releaseClear = releaseClear;  // m of clearance before a lift starts to fade out
    this.fall = fall;               // s, time constant of that fade
    this.enabled = true;
    this.measure = false;
    this.ready = false;
    this.t = 0;
    this.resetStats();
  }

  resetStats() {
    this.stats = { frames: 0, contactFrames: 0, leftFrames: 0, maxBefore: 0, maxAfter: 0, sumBefore: 0, sumAfter: 0 };
  }

  /** Measure the thighs (called once the seated pose is on). */
  build() {
    const arm = this.head.armature;
    if (!arm) return false;
    arm.updateMatrixWorld(true);
    const bone = (n) => arm.getObjectByName(n);
    this.legs = [];
    for (const s of ['Left', 'Right']) {
      const up = bone(s + 'UpLeg'), knee = bone(s + 'Leg');
      if (!up || !knee) continue;
      const axis = knee.position.clone().normalize(), len = knee.position.length();
      // two directions perpendicular to the thigh axis, for the angle around it
      const u = new THREE.Vector3(1, 0, 0); if (Math.abs(u.dot(axis)) > 0.9) u.set(0, 1, 0);
      u.sub(_v.copy(axis).multiplyScalar(u.dot(axis))).normalize();
      const w = new THREE.Vector3().crossVectors(axis, u);
      this.legs.push({
        up, len, table: new Float32Array(AXIAL_BINS * ANGLE_BINS), inv: new THREE.Matrix4(),
        ax: axis.x, ay: axis.y, az: axis.z, ux: u.x, uy: u.y, uz: u.z, wx: w.x, wy: w.y, wz: w.z
      });
    }
    if (!this.legs.length) return false;

    // every vertex mostly bound to a thigh bone, skinned in the current pose, into that bone's space
    const inv = this.legs.map((l) => new THREE.Matrix4().copy(l.up.matrixWorld).invert());
    let used = 0;
    arm.traverse((mesh) => {
      if (!mesh.isSkinnedMesh || SKIP_MESH.test(mesh.name)) return;
      const g = mesh.geometry, si = g.attributes.skinIndex, sw = g.attributes.skinWeight, pos = g.attributes.position;
      if (!si || !sw) return;
      const legBone = this.legs.map((l) => mesh.skeleton.bones.indexOf(l.up));
      for (let i = 0; i < pos.count; i++) {
        for (let k = 0; k < this.legs.length; k++) {
          if (legBone[k] < 0) continue;
          let wsum = 0;
          for (let j = 0; j < 4; j++) if (si.getComponent(i, j) === legBone[k]) wsum += sw.getComponent(i, j);
          if (wsum < 0.55) continue;
          mesh.getVertexPosition(i, _v);
          _v.applyMatrix4(mesh.matrixWorld).applyMatrix4(inv[k]);
          this._addToTable(this.legs[k], _v);
          used++;
        }
      }
    });
    for (const l of this.legs) this._fillTable(l);
    this.ready = used > 50;
    this.vertexCount = used;

    // the test points of each hand: palm, middle joint and tip of every finger
    this.hands = [];
    for (const s of ['Left', 'Right']) {
      const hand = bone(s + 'Hand'), upper = bone(s + 'Arm'), fore = bone(s + 'ForeArm');
      if (!hand || !upper || !fore || !fore.parent) continue;
      const defs = [{ a: hand, b: null }];
      for (const f of FINGERS) {
        const j = [1, 2, 3].map((n) => bone(`${s}Hand${f}${n}`));
        if (j[1]) defs.push({ a: j[1], b: null });                     // middle joint
        if (j[2] && j[1]) defs.push({ a: j[2], b: j[1] });             // fingertip: past the last joint
      }
      this.hands.push({ side: s, upper, fore, defs, q: new THREE.Quaternion(), clear: -1, pq: new THREE.Quaternion(), lifted: false });
    }
    return this.ready;
  }

  _addToTable(leg, p) {
    const a = p.x * leg.ax + p.y * leg.ay + p.z * leg.az;
    const x = p.x * leg.ux + p.y * leg.uy + p.z * leg.uz, y = p.x * leg.wx + p.y * leg.wy + p.z * leg.wz;
    const ai = Math.floor(((a / leg.len) + 0.1) / 1.2 * AXIAL_BINS);
    if (ai < 0 || ai >= AXIAL_BINS) return;
    const gi = Math.floor(((Math.atan2(y, x) + Math.PI) / TAU) * ANGLE_BINS) % ANGLE_BINS;
    const idx = ai * ANGLE_BINS + gi, r = Math.hypot(x, y);
    if (r > leg.table[idx]) leg.table[idx] = r;
  }

  /** Empty bins take the largest neighbour (around the thigh first, then along it). */
  _fillTable(leg) {
    const t = leg.table;
    for (let pass = 0; pass < 3; pass++) {
      const copy = t.slice();
      for (let ai = 0; ai < AXIAL_BINS; ai++) for (let gi = 0; gi < ANGLE_BINS; gi++) {
        const idx = ai * ANGLE_BINS + gi;
        if (copy[idx] > 0) continue;
        let best = 0;
        for (const [da, dg] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
          const a2 = ai + da, g2 = (gi + dg + ANGLE_BINS) % ANGLE_BINS;
          if (a2 >= 0 && a2 < AXIAL_BINS) best = Math.max(best, copy[a2 * ANGLE_BINS + g2]);
        }
        t[idx] = best;
      }
    }
  }

  /**
   * Depth of the deepest hand point inside either thigh (negative = clear by that much; -1 if nowhere near).
   * The deepest point and the outward direction there are left in `hit` (world space).
   */
  _probe(h) {
    let best = -1;
    for (const leg of this.legs) {
      const e = leg.inv.elements, M = leg.up.matrixWorld.elements;
      for (const d of h.defs) {
        const ae = d.a.matrixWorld.elements;
        let x = ae[12], y = ae[13], z = ae[14];
        if (d.b) { const be = d.b.matrixWorld.elements; x += 0.8 * (x - be[12]); y += 0.8 * (y - be[13]); z += 0.8 * (z - be[14]); }
        const lx = e[0] * x + e[4] * y + e[8] * z + e[12];
        const ly = e[1] * x + e[5] * y + e[9] * z + e[13];
        const lz = e[2] * x + e[6] * y + e[10] * z + e[14];
        const ai = Math.floor(((lx * leg.ax + ly * leg.ay + lz * leg.az) / leg.len + 0.1) / 1.2 * AXIAL_BINS);
        if (ai < 0 || ai >= AXIAL_BINS) continue;
        const cx = lx * leg.ux + ly * leg.uy + lz * leg.uz, cy = lx * leg.wx + ly * leg.wy + lz * leg.wz;
        const r = Math.hypot(cx, cy);
        const surface = leg.table[ai * ANGLE_BINS + (Math.floor(((Math.atan2(cy, cx) + Math.PI) / TAU) * ANGLE_BINS) % ANGLE_BINS)];
        if (!surface) continue;
        const depth = surface + this.margin - r;
        if (depth > best) {
          best = depth;
          hit.x = x; hit.y = y; hit.z = z;
          if (r > 1e-6) {          // outward from the thigh axis, rotated into world space
            const nlx = (cx * leg.ux + cy * leg.wx) / r, nly = (cx * leg.uy + cy * leg.wy) / r, nlz = (cx * leg.uz + cy * leg.wz) / r;
            hit.nx = M[0] * nlx + M[4] * nly + M[8] * nlz; hit.ny = M[1] * nlx + M[5] * nly + M[9] * nlz; hit.nz = M[2] * nlx + M[6] * nly + M[10] * nlz;
          }
        }
      }
    }
    return best;
  }

  /** Apply the world-space rotation `qw` to the upper arm (through the shoulder). */
  _lift(h, qw) {
    _loc.copy(h.pq).invert().multiply(qw).multiply(h.pq);        // the same rotation in the parent's frame
    h.upper.quaternion.premultiply(_loc);
    h.upper.updateMatrixWorld(true);                              // this arm only
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
    this.head.armature.updateMatrixWorld(true);
    for (const leg of this.legs) leg.inv.copy(leg.up.matrixWorld).invert();

    let before = 0, after = 0;
    for (const h of this.hands) {
      h.upper.parent.matrixWorld.decompose(_v, h.pq, _l);          // the shoulder's world rotation (does not change)
      if (this.measure) before = Math.max(before, this._probe(h));
      // 1. last frame's lift; fade it out slowly only while the hand is clearly above the leg
      if (h.lifted) {
        if (h.clear < -this.releaseClear) h.q.slerp(_I, 1 - Math.exp(-dt / this.fall));
        if (h.q.angleTo(_I) < 1e-4) { h.q.identity(); h.lifted = false; }
        else this._lift(h, h.q);
      }
      // 2. one test; if inside, the exact extra lift that brings the deepest point back onto the surface
      const depth = this._probe(h);
      if (depth > 0) {
        _l.set(hit.x, hit.y, hit.z).sub(h.upper.getWorldPosition(_v));       // shoulder -> contact point
        // a resting hand should come UP onto the thigh, not slide off its side: push along "outward + up"
        _n.set(hit.nx, hit.ny + UP_BIAS, hit.nz).normalize();
        const along = Math.max(0.35, hit.nx * _n.x + hit.ny * _n.y + hit.nz * _n.z);   // how much of that push is outward
        _a.crossVectors(_l, _n);
        const arm = _a.length();                                              // |l x n|: how far a turn moves the point along n
        if (arm > 0.06) {
          const angle = Math.min(MAX_STEP, (depth / along * 1.1) / arm);
          if (h.q.angleTo(_I) + angle < MAX_LIFT) {
            _dq.setFromAxisAngle(_a.divideScalar(arm), angle);
            h.q.premultiply(_dq);
            h.lifted = true;
            this._lift(h, _dq);
          }
        }
        h.clear = 0;
      } else h.clear = depth;
      if (this.measure) after = Math.max(after, this._probe(h));
    }
    if (this.measure) {
      const S = this.stats;
      S.frames++;
      if (before > 0.003) S.contactFrames++;
      if (after > 0.003) S.leftFrames++;
      S.maxBefore = Math.max(S.maxBefore, before); S.maxAfter = Math.max(S.maxAfter, after);
      S.sumBefore += Math.max(0, before); S.sumAfter += Math.max(0, after);
    }
  }
}
