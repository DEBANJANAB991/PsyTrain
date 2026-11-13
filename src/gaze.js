import * as THREE from 'three';
import { EYE_STYLE, AVATAR } from './config.js';

const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const smooth = (dt, tc) => 1 - Math.exp(-dt / tc);

// Eyeball range per morph value 1 (radians), measured per avatar from its eyeLook* morph targets.
const EYE = AVATAR.eyeRange;

/**
 * Gaze controller: she looks at the student's REAL position (camera / headset) and keeps following
 * as you move. TalkingHead's own eye contact only compensates head rotation for a camera straight
 * ahead, so it is bypassed: this class runs AFTER head.animate() every frame and
 *   1. turns neck + head a share of the way towards the target (smoothed, so eyes lead, head follows),
 *   2. aims each eye exactly (own position -> target, so the eyes converge) by writing the eyeLook*
 *      morph influences directly (value 1 = ~36 deg sideways, 25 deg up, 31 deg down).
 * Looking away is an angular offset around the student direction, scheduled per emotion (EYE_STYLE).
 *
 * Face frame: the avatar's bind pose faces +z with +y up and her left on +x. The head's rotation
 * relative to bind = headWorldQuat * inverse(bind), taken from the skinned mesh's boneInverses.
 */
export class Gaze {
  constructor(head, affect, getTarget) {
    this.head = head;
    this.affect = affect;
    this.getTarget = getTarget;       // (Vector3) => void, fills the student's eye position
    this.enabled = true;

    const a = head.armature;
    this.headBone = a.getObjectByName('Head');
    this.neckBone = a.getObjectByName('Neck');
    this.leftEye = a.getObjectByName('LeftEye');
    this.rightEye = a.getObjectByName('RightEye');

    // bind rotation of the head bone (mesh space)
    let invBind = new THREE.Quaternion();
    a.traverse((o) => {
      if (o.isSkinnedMesh && o.skeleton) {
        const i = o.skeleton.bones.indexOf(this.headBone);
        if (i >= 0 && invBind.w === 1 && invBind.x === 0) {
          const p = new THREE.Vector3(), s = new THREE.Vector3();
          o.skeleton.boneInverses[i].decompose(p, invBind, s);
        }
      }
    });
    this.invBind = invBind;

    // morph influence writers for the eye morphs (TalkingHead's own lookup: meshes + indices)
    const names = ['eyeLookInLeft', 'eyeLookOutLeft', 'eyeLookUpLeft', 'eyeLookDownLeft',
      'eyeLookInRight', 'eyeLookOutRight', 'eyeLookUpRight', 'eyeLookDownRight', 'eyesLookDown', 'eyesLookUp'];
    this.morphs = {};
    for (const n of names) this.morphs[n] = head.mtAvatar[n] || null;

    // state
    this.off = { yaw: 0, pitch: 0 };            // current (smoothed) look-away offset
    this.offTarget = { yaw: 0, pitch: 0 };
    this.jit = { yaw: 0, pitch: 0 };
    this.jitTarget = { yaw: 0, pitch: 0 };
    this.turn = { yaw: 0, pitch: 0 };           // current head turn (smoothed)
    this.mode = 'contact';                      // 'contact' | 'away'
    this.timer = rand(1, 3);
    this.jitTimer = 0;
    this.event = null;                          // forced look-away {yaw, pitch, t, head}
    this.hold = false;                          // true: ignore everything, just look at the student
    this._v = new THREE.Vector3(); this._w = new THREE.Vector3(); this._T = new THREE.Vector3();
    this.debug = {};
  }

  /** Look somewhere for `seconds` (yaw: + = her left, pitch: + = up), head takes `headShare` of it. */
  lookAt(yaw, pitch, seconds = 2, headShare = 0.6) {
    this.event = { yaw, pitch, t: seconds, head: headShare };
  }

  /** Look at the student again right now (cancels look-aways). */
  lookAtStudent() {
    this.event = null;
    this.mode = 'contact';
    this.offTarget.yaw = 0; this.offTarget.pitch = 0;
    this.timer = rand(2, 5);
  }

  // ---- scheduling of look-aways and micro-saccades ----------------------------------------
  _schedule(dt) {
    const emo = this.affect.state.emotion;
    const st = EYE_STYLE[emo] || EYE_STYLE.neutral;
    const pStudent = this.affect.getBehavior().gazeStudent;

    if (this.event) {
      this.event.t -= dt;
      this.offTarget.yaw = this.event.yaw; this.offTarget.pitch = this.event.pitch;
      this.headShare = this.event.head;
      if (this.event.t <= 0) { this.event = null; this.mode = 'contact'; this.timer = rand(1.5, 4); this.offTarget.yaw = 0; this.offTarget.pitch = 0; }
      return;
    }
    this.headShare = st.head;
    this.timer -= dt;
    if (this.timer <= 0) {
      if (this.mode === 'contact' && Math.random() > pStudent) {
        this.mode = 'away';
        this.offTarget.yaw = rand(st.yaw[0], st.yaw[1]);
        this.offTarget.pitch = rand(st.pitch[0], st.pitch[1]);
        this.timer = rand(st.away[0], st.away[1]);
      } else {
        this.mode = 'contact';
        this.offTarget.yaw = 0; this.offTarget.pitch = 0;
        this.timer = rand(st.contact[0], st.contact[1]);
        // a little less contact if she rarely looks at you, more if she always does
        if (pStudent < 0.25) this.timer *= 0.5;
      }
    }
    // micro-saccades while holding eye contact
    this.jitTimer -= dt;
    if (this.jitTimer <= 0) {
      this.jitTimer = rand(0.25, 1.2);
      this.jitTarget.yaw = rand(-st.jitter, st.jitter);
      this.jitTarget.pitch = rand(-st.jitter, st.jitter) * 0.7;
    }
  }

  update(dtMs) {
    if (!this.enabled || !this.head.armature) return;
    const dt = Math.min(dtMs / 1000, 0.1);
    this._schedule(dt);

    // eyes jump fast (saccade), head follows slowly
    const ke = smooth(dt, this.event || this.mode === 'away' ? 0.07 : 0.09);
    this.off.yaw += (this.offTarget.yaw - this.off.yaw) * ke;
    this.off.pitch += (this.offTarget.pitch - this.off.pitch) * ke;
    const kj = smooth(dt, 0.05);
    this.jit.yaw += (this.jitTarget.yaw - this.jit.yaw) * kj;
    this.jit.pitch += (this.jitTarget.pitch - this.jit.pitch) * kj;

    const hb = this.headBone, T = this._T, v = this._v, w = this._w;
    this.getTarget(T);
    hb.updateWorldMatrix(true, true);

    // eye centre
    this.leftEye.getWorldPosition(v); this.rightEye.getWorldPosition(w);
    const P = v.clone().add(w).multiplyScalar(0.5);
    const toT = T.clone().sub(P);
    const dist = Math.max(0.3, toT.length());
    toT.normalize();
    const yawS = Math.atan2(toT.x, toT.z), pitchS = Math.asin(clamp(toT.y, -1, 1));
    const Dyaw = yawS + this.off.yaw + this.jit.yaw;
    const Dpitch = clamp(pitchS + this.off.pitch + this.jit.pitch, -1.2, 1.2);

    // face rotation and forward
    const hq = new THREE.Quaternion(); hb.getWorldQuaternion(hq);
    let R = hq.clone().multiply(this.invBind);
    const F = new THREE.Vector3(0, 0, 1).applyQuaternion(R);
    const Fyaw = Math.atan2(F.x, F.z), Fp = Math.asin(clamp(F.y, -1, 1));

    // head turn: a share of the remaining angle, smoothed
    const sh = this.headShare ?? 0.45;
    const tYaw = clamp(sh * wrap(Dyaw - Fyaw), -0.75, 0.75);
    const tPit = clamp(sh * 0.8 * (Dpitch - Fp), -0.4, 0.4);
    const kh = smooth(dt, 0.28);
    this.turn.yaw += (tYaw - this.turn.yaw) * kh;
    this.turn.pitch += (tPit - this.turn.pitch) * kh;

    const cp = Math.cos(Fp + this.turn.pitch);
    const Ft = new THREE.Vector3(cp * Math.sin(Fyaw + this.turn.yaw), Math.sin(Fp + this.turn.pitch), cp * Math.cos(Fyaw + this.turn.yaw));
    const Rw = new THREE.Quaternion().setFromUnitVectors(F, Ft.normalize());
    const qNeck = new THREE.Quaternion().slerp(Rw, 0.35);          // identity -> Rw
    const qHead = Rw.clone().multiply(qNeck.clone().invert());     // remainder, applied after the neck
    this._rotateWorld(this.neckBone, qNeck);
    this._rotateWorld(this.headBone, qHead);

    // eyes: exact aim from each eye to the (offset) target point
    hb.updateWorldMatrix(true, true);
    hb.getWorldQuaternion(hq);
    R = hq.clone().multiply(this.invBind);
    const Rinv = R.clone().invert();
    const cd = Math.cos(Dpitch);
    this.leftEye.getWorldPosition(v); this.rightEye.getWorldPosition(w);
    const P2 = v.clone().add(w).multiplyScalar(0.5);
    const point = P2.clone().add(new THREE.Vector3(cd * Math.sin(Dyaw), Math.sin(Dpitch), cd * Math.cos(Dyaw)).multiplyScalar(dist));
    const aim = (eyePos) => {
      const d = point.clone().sub(eyePos).normalize().applyQuaternion(Rinv);
      return { yaw: clamp(Math.atan2(d.x, d.z), -0.62, 0.62), pitch: clamp(Math.asin(clamp(d.y, -1, 1)), -0.5, 0.4) };
    };
    const L = aim(v), Rr = aim(w);
    this._setEye('Left', L.yaw, L.pitch);
    this._setEye('Right', Rr.yaw, Rr.pitch);
    this._set('eyesLookDown', 0); this._set('eyesLookUp', 0);

    this.debug = { Dyaw, Dpitch, turn: { ...this.turn }, L, R: Rr, mode: this.mode, F: F.toArray() };
  }

  /** rotate a bone by a world-space rotation (applied on top of its current world orientation) */
  _rotateWorld(bone, q) {
    const pq = new THREE.Quaternion(), bq = new THREE.Quaternion();
    bone.parent.getWorldQuaternion(pq);
    bone.getWorldQuaternion(bq);
    bone.quaternion.copy(pq.clone().invert().multiply(q).multiply(bq));
    bone.updateWorldMatrix(false, true);
  }

  _set(name, val) {
    const o = this.morphs[name];
    if (!o) return;
    const x = clamp(val, 0, 1);
    for (let i = 0; i < o.ms.length; i++) o.ms[i][o.is[i]] = x;
    o.value = x; o.applied = x;
  }

  _setEye(side, yaw, pitch) {
    if (side === 'Left') {
      this._set('eyeLookOutLeft', yaw > 0 ? yaw / EYE.leftOut : 0);
      this._set('eyeLookInLeft', yaw < 0 ? -yaw / EYE.leftIn : 0);
    } else {
      this._set('eyeLookInRight', yaw > 0 ? yaw / EYE.rightIn : 0);
      this._set('eyeLookOutRight', yaw < 0 ? -yaw / EYE.rightOut : 0);
    }
    this._set('eyeLookUp' + side, pitch > 0 ? pitch / EYE.up : 0);
    this._set('eyeLookDown' + side, pitch < 0 ? -pitch / EYE.down : 0);
  }
}
