import * as THREE from 'three';

/**
 * Visible patient conditions painted into the avatar's own textures after load. No extra meshes:
 * paint stays glued to the skin through every expression, blink and lip-sync morph, costs nothing
 * per frame and works the same in WebXR.
 *
 *   applyFacePaint(head, preset)   red paint / fake blood on the face (FACE_PAINT presets below)
 *   coverLogos(head, covers)       hide vendor logos on clothes by copying plain fabric over them
 */

// Marks are placed in a face frame measured from the avatar's eyes, in metres:
//   x = towards HER left, y = up, both relative to the point midway between the eyes
//   (eyebrows ~ y 0.025, nose tip ~ y -0.045, cheekbones ~ x ±0.05).
// Every point is projected onto the head mesh, so the same preset fits every avatar.
//
//   splat   { x, y, r, a, color, lumps?, spread?, stretch?, hard? }
//           r radius, a opacity 0..1; lumps > 1 = irregular cluster of jittered ellipses
//   stroke  { path: [[x, y], ...], w | [w0, w1], a, color, hard?, streaks?, dry?, wobble? }
//           smooth curve through path, width tapering w0 -> w1; streaks = n finger/bristle lines
//           across the width; dry = broken, faded ends; wobble = sideways waver (m)
// color is a key of the preset's colors or any CSS colour.
export const FACE_PAINT = {
  // red paint finger-smeared across the face (e.g. agitated / psychotic presentation)
  'red-paint': {
    colors: { paint: '#c0121a' },
    marks: [
      // three finger streaks across her left cheek
      { path: [[0.02, -0.022], [0.042, -0.027], [0.066, -0.021]], w: [0.008, 0.006], a: 0.92, color: 'paint', hard: true, streaks: 3, dry: true },
      { path: [[0.022, -0.036], [0.044, -0.042], [0.067, -0.036]], w: [0.008, 0.006], a: 0.9, color: 'paint', hard: true, streaks: 3, dry: true },
      { path: [[0.026, -0.05], [0.046, -0.056], [0.066, -0.051]], w: [0.007, 0.005], a: 0.85, color: 'paint', hard: true, streaks: 3, dry: true },
      // one smudged streak on the right cheek
      { path: [[-0.022, -0.03], [-0.045, -0.036], [-0.064, -0.031]], w: [0.009, 0.005], a: 0.7, color: 'paint', streaks: 4, dry: true },
      // swipe across the left forehead (clear of side-swept fringes)
      { path: [[-0.01, 0.036], [0.018, 0.043], [0.048, 0.038]], w: [0.01, 0.007], a: 0.85, color: 'paint', hard: true, streaks: 4, dry: true }
    ]
  },
  // cut above the LEFT brow (side-swept fringes usually cover the right forehead), blood running
  // down towards the brow, and blood wiped across the same cheek
  'forehead-wound': {
    colors: { blood: '#8e1212', dark: '#520808', bruise: '#6e3640', smear: '#a3271f' },
    marks: [
      // swollen, bruised skin around the cut
      { x: 0.027, y: 0.052, r: 0.018, a: 0.35, color: 'bruise', lumps: 6, spread: 0.5, stretch: 1.3 },
      // dried blood crusted around the cut
      { x: 0.026, y: 0.051, r: 0.007, a: 0.95, color: 'blood', lumps: 8, spread: 0.8, stretch: 1.7 },
      // the cut itself: a short, slightly diagonal gaping line, wider in the middle
      { path: [[0.018, 0.049], [0.026, 0.0515], [0.035, 0.0535]], w: [0.0012, 0.0012], a: 0.9, color: 'dark', hard: true },
      { path: [[0.022, 0.0502], [0.026, 0.0515], [0.031, 0.0527]], w: [0.0024, 0.0018], a: 0.9, color: 'dark', hard: true },
      // runs of blood towards the brow, each ending in a small bead
      { path: [[0.018, 0.049], [0.0185, 0.04], [0.017, 0.03]], w: [0.0034, 0.0018], a: 0.85, color: 'blood', wobble: 0.0006 },
      { path: [[0.027, 0.051], [0.028, 0.043], [0.0275, 0.037]], w: [0.0028, 0.0016], a: 0.8, color: 'blood', wobble: 0.0005 },
      { path: [[0.035, 0.053], [0.0355, 0.046]], w: [0.0022, 0.0012], a: 0.75, color: 'blood' },
      { x: 0.017, y: 0.03, r: 0.0018, a: 0.85, color: 'blood' },
      { x: 0.0275, y: 0.037, r: 0.0015, a: 0.8, color: 'blood' },
      // blood wiped across the cheek with the back of a hand
      { path: [[0.03, -0.022], [0.048, -0.032], [0.064, -0.046]], w: [0.012, 0.007], a: 0.45, color: 'smear', streaks: 4, dry: true }
    ]
  },
  // dried blood under the left nostril and on the upper lip
  nosebleed: {
    colors: { blood: '#6e0909', dark: '#360404', smear: '#9a1f19' },
    marks: [
      { x: 0.006, y: -0.056, r: 0.004, a: 0.85, color: 'blood', lumps: 4, spread: 0.6 },
      { path: [[0.006, -0.056], [0.007, -0.066], [0.006, -0.072]], w: [0.004, 0.002], a: 0.8, color: 'blood', wobble: 0.0005 },
      { path: [[0.0, -0.066], [0.02, -0.074]], w: 0.008, a: 0.25, color: 'smear', streaks: 3, dry: true }
    ]
  }
};

/** Paint a FACE_PAINT preset (key or object) into the head mesh's base colour texture. */
export function applyFacePaint(head, preset) {
  const P = typeof preset === 'string' ? FACE_PAINT[preset] : preset;
  if (!P) { console.warn('[conditions] unknown face paint', preset); return; }
  const mesh = findHeadMesh(head.armature);
  if (!mesh?.material?.map?.image) { console.warn('[conditions] no head texture to paint on'); return; }

  const frame = faceFrame(mesh, head.armature);
  if (!frame) { console.warn('[conditions] no eye bones, cannot place face paint'); return; }
  const proxy = posedProxy(mesh);      // raycasting a skinned mesh re-skins every vertex per ray

  const { canvas, ctx, W, H } = textureCanvas(mesh.material.map);
  const rand = rng(17);
  const k = frame.scale;
  const col = (c) => P.colors?.[c] ?? c;
  let missed = 0;
  // face-frame point -> texture pixel + pixel axes per preset-metre along right / up
  const at = (x, y) => {
    const target = frame.origin.clone().addScaledVector(frame.right, x * k).addScaledVector(frame.up, y * k);
    const hit = projectToSurface(proxy, target, frame);
    if (!hit) { missed++; return null; }
    return { px: hit.u * W, py: hit.v * H, aR: [hit.du.x * W * k, hit.du.y * H * k], aU: [hit.dv.x * W * k, hit.dv.y * H * k] };
  };

  for (const m of P.marks) {
    if (m.path) { stroke(ctx, m, at, col(m.color), rand); continue; }
    const s = at(m.x, m.y);
    if (!s) continue;
    const lumps = m.lumps ?? 1, spread = m.spread ?? 0.4, st = m.stretch ?? 1;
    // overlapping lumps accumulate, so each gets a share of the target opacity
    const a = lumps > 1 ? 1 - (1 - m.a) ** (1 / Math.max(1, lumps * 0.5)) : m.a;
    for (let i = 0; i < lumps; i++) {
      const ang = rand() * Math.PI * 2, d = lumps > 1 ? m.r * spread * rand() : 0;
      const ox = Math.cos(ang) * d * st, oy = Math.sin(ang) * d;
      const rr = lumps > 1 ? m.r * (0.5 + 0.5 * rand()) : m.r;
      dab(ctx, s.px + s.aR[0] * ox + s.aU[0] * oy, s.py + s.aR[1] * ox + s.aU[1] * oy, s.aR, s.aU, rr * st, rr, col(m.color), a, m.hard);
    }
  }
  replaceMap(mesh.material, canvas);
  proxy.geometry.dispose();
  return { mesh: mesh.name, texture: `${W}x${H}`, marks: P.marks.length, missed };
}

/** Dense dabs along a smooth curve, each projected onto the face so the stroke follows its shape. */
function stroke(ctx, m, at, color, rand) {
  const curve = new THREE.CatmullRomCurve3(m.path.map(([x, y]) => new THREE.Vector3(x, y, 0)));
  const len = curve.getLength();
  const [w0, w1] = Array.isArray(m.w) ? m.w : [m.w, m.w];
  const n = m.streaks ?? 1;
  for (let j = 0; j < n; j++) {
    const off = n === 1 ? 0 : (j / (n - 1) - 0.5) * 0.75;           // lateral position, fraction of width
    const end = n === 1 ? 1 : 0.72 + 0.28 * rand();                  // streaks run out at different points
    const sa = m.a * (n === 1 ? 1 : 0.7 + 0.3 * rand());
    const phase = rand() * 10;
    for (let f = 0; f <= end;) {
      const p = curve.getPointAt(Math.min(f, 1)), t = curve.getTangentAt(Math.min(f, 1));
      const full = w0 + (w1 - w0) * f;
      const w = (n === 1 ? full : full / (n * 0.6)) * (1 + 0.12 * Math.sin(f * len * 900 + phase));
      const lat = off * full + (m.wobble ?? 0) * Math.sin(f * len * 300 + phase);
      const step = Math.max(w * 0.35, 0.0005);
      f += step / len;
      // dry brush: towards the end the paint fades and breaks up
      const fade = m.dry ? Math.min(1, Math.max(0, (end - f) / 0.25)) : 1;
      if (fade <= 0 || (m.dry && rand() > fade + 0.15)) continue;
      const s = at(p.x - t.y * lat, p.y + t.x * lat);
      if (!s) continue;
      const a = 1 - (1 - sa * fade) ** (1 / Math.max(1, w / step));  // per-dab share of the opacity
      dab(ctx, s.px, s.py, s.aR, s.aU, w / 2, w / 2, color, a, m.hard);
    }
  }
}

/**
 * covers: [{ material: 'outfit_top', rect: [u0, v0, u1, v1], from: [du, dv] }]
 * Copies the texture patch at rect + from over rect (plain fabric over a printed logo).
 */
export function coverLogos(head, covers = []) {
  for (const c of covers) {
    let mat = null;
    head.armature.traverse((o) => { if (o.isMesh && [o.material].flat().some((m) => m.name === c.material)) mat = [o.material].flat().find((m) => m.name === c.material); });
    if (!mat?.map?.image) continue;
    const { canvas, ctx, W, H } = textureCanvas(mat.map);
    const [u0, v0, u1, v1] = c.rect, [du, dv] = c.from;
    const x = u0 * W, y = v0 * H, w = (u1 - u0) * W, h = (v1 - v0) * H;
    // feathered copy so no hard seam shows
    const patch = document.createElement('canvas');
    patch.width = Math.ceil(w); patch.height = Math.ceil(h);
    const pc = patch.getContext('2d');
    pc.drawImage(canvas, x + du * W, y + dv * H, w, h, 0, 0, w, h);
    pc.globalCompositeOperation = 'destination-in';
    const f = Math.min(w, h) * 0.18;
    for (const [gx0, gy0, gx1, gy1] of [[0, 0, f, 0], [w, 0, w - f, 0], [0, 0, 0, f], [0, h, 0, h - f]]) {
      const g = pc.createLinearGradient(gx0, gy0, gx1, gy1);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,1)');
      pc.fillStyle = g; pc.fillRect(0, 0, w, h);
    }
    ctx.drawImage(patch, x, y);
    replaceMap(mat, canvas);
    // the logo is often embossed in the normal map too
    if (mat.normalMap?.image) {
      const n = textureCanvas(mat.normalMap);
      n.ctx.drawImage(n.canvas, (u0 + du) * n.W, (v0 + dv) * n.H, w / W * n.W, h / H * n.H, u0 * n.W, v0 * n.H, w / W * n.W, h / H * n.H);
      replaceMap(mat, n.canvas, 'normalMap');
    }
  }
}

// ---- helpers ------------------------------------------------------------------------------------

function findHeadMesh(root) {
  let best = null;
  root.traverse((o) => {
    if (!o.isSkinnedMesh || !o.morphTargetDictionary || !o.material?.map) return;
    if (!('jawOpen' in o.morphTargetDictionary)) return;
    if (/teeth|tongue|lash|brow|eye/i.test(o.name)) return;
    if (!best || o.geometry.attributes.position.count > best.geometry.attributes.position.count) best = o;
  });
  return best;
}

/**
 * Eye-centred frame in WORLD space for the current pose. (Bind matrices are not usable: TalkingHead's
 * retarget re-binds the skeleton, so bind-pose bone positions no longer match the geometry.)
 */
function faceFrame(mesh, root) {
  root.updateMatrixWorld(true);
  mesh.skeleton.update();                      // getVertexPosition on a skinned mesh uses the bone matrices
  const eye = (name) => root.getObjectByName(name)?.getWorldPosition(new THREE.Vector3());
  const L = eye('LeftEye'), R = eye('RightEye');
  if (!L || !R) return null;
  const origin = L.clone().add(R).multiplyScalar(0.5);
  const right = L.clone().sub(R).normalize();                      // towards her left
  const up = new THREE.Vector3(0, 1, 0).addScaledVector(right, -right.y).normalize();
  const forward = new THREE.Vector3().crossVectors(right, up).normalize();
  // presets are written for a 63 mm eye distance; this also absorbs cm-vs-m geometry units
  const scale = L.distanceTo(R) / 0.063;
  return { origin, right, up, forward, scale };
}

/**
 * Cast a ray from in front of the face back along -forward through `target` and return the UV hit
 * plus the local UV derivatives (per metre along the frame's right/up axes) for that triangle.
 */
function projectToSurface(mesh, target, { forward, right, up, scale }) {
  const rc = new THREE.Raycaster(target.clone().addScaledVector(forward, 0.25 * scale), forward.clone().negate());
  const hit = rc.intersectObject(mesh, false)[0];     // nearest = the front of the face
  if (!hit?.face || !hit.uv) return null;
  const uv = mesh.geometry.attributes.uv;
  const { a: ia, b: ib, c: ic } = hit.face;
  // posed (skinned + morphed) triangle corners in world space
  const corner = (i) => mesh.getVertexPosition(i, new THREE.Vector3()).applyMatrix4(mesh.matrixWorld);
  const A = corner(ia), B = corner(ib), C = corner(ic);
  const ua = new THREE.Vector2().fromBufferAttribute(uv, ia);
  const ub = new THREE.Vector2().fromBufferAttribute(uv, ib);
  const uc = new THREE.Vector2().fromBufferAttribute(uv, ic);
  const { x: u, y: v } = hit.uv;
  // Jacobian: triangle edges expressed in the face's right/up plane -> their UV deltas
  const e1 = B.clone().sub(A), e2 = C.clone().sub(A);
  const x1 = e1.dot(right), y1 = e1.dot(up), x2 = e2.dot(right), y2 = e2.dot(up);
  const det = x1 * y2 - x2 * y1;
  if (Math.abs(det) < 1e-12) return null;
  const t1 = ub.clone().sub(ua), t2 = uc.clone().sub(ua);
  // dUV/dx and dUV/dy
  const du = new THREE.Vector2((t1.x * y2 - t2.x * y1) / det, (t1.y * y2 - t2.y * y1) / det);
  const dv = new THREE.Vector2((t2.x * x1 - t1.x * x2) / det, (t2.y * x1 - t1.y * x2) / det);
  return { u, v, du, dv };
}

/** Static world-space copy of the skinned + morphed head in its current pose, for cheap raycasts. */
function posedProxy(mesh) {
  const src = mesh.geometry, n = src.attributes.position.count;
  const pos = new Float32Array(n * 3), v = new THREE.Vector3();
  for (let i = 0; i < n; i++) mesh.getVertexPosition(i, v).applyMatrix4(mesh.matrixWorld).toArray(pos, i * 3);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', src.attributes.uv);
  if (src.index) g.setIndex(src.index);
  const proxy = new THREE.Mesh(g, mesh.material);
  proxy.updateMatrixWorld(true);
  return proxy;
}

function dab(ctx, x, y, axisR, axisU, rx, ry, color, alpha, hard = false) {
  ctx.save();
  ctx.setTransform(axisR[0] * rx, axisR[1] * rx, axisU[0] * ry, axisU[1] * ry, x, y);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  const c = new THREE.Color(color);
  const rgb = `${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)}`;
  g.addColorStop(0, `rgba(${rgb},${alpha})`);
  g.addColorStop(hard ? 0.8 : 0.5, `rgba(${rgb},${alpha * (hard ? 1 : 0.8)})`);
  g.addColorStop(1, `rgba(${rgb},0)`);
  ctx.globalCompositeOperation = 'source-atop';   // keep the texture's alpha (masked heads)
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(0, 0, 1, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function textureCanvas(tex) {
  const img = tex.image;
  const W = img.width, H = img.height;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  return { canvas, ctx, W, H };
}

function replaceMap(mat, canvas, slot = 'map') {
  const old = mat[slot];
  const t = new THREE.CanvasTexture(canvas);
  for (const k of ['flipY', 'colorSpace', 'wrapS', 'wrapT', 'channel', 'anisotropy', 'magFilter', 'minFilter']) t[k] = old[k];
  t.offset.copy(old.offset); t.repeat.copy(old.repeat); t.rotation = old.rotation; t.center.copy(old.center);
  t.needsUpdate = true;
  mat[slot] = t;
  mat.needsUpdate = true;
  old.dispose();
}

function rng(seed) {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}
