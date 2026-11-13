import * as THREE from 'three';

/**
 * Visible patient conditions painted into the avatar's own textures after load. No extra meshes:
 * paint stays glued to the skin through every expression, blink and lip-sync morph, costs nothing
 * per frame and works the same in WebXR.
 *
 *   applyFacePaint(head, preset)   red paint / fake blood on the face (FACE_PAINT presets below)
 *   coverLogos(head, covers)       hide vendor logos on clothes by copying plain fabric over them
 */

// Splats are placed in a face frame measured from the avatar's eyes, in metres:
//   x = towards HER left, y = up, both relative to the point midway between the eyes.
// Each splat is projected onto the head mesh, so the same preset fits every avatar.
//   r      radius (m)            drip   length of a run downwards (m), 0 = none
//   a      opacity 0..1          core   darker clotted centre      smear  wide, faint wipe
export const FACE_PAINT = {
  // cut above the LEFT brow (side-swept fringes usually cover the right forehead), blood run down
  // towards the brow, and a faint wiped smear on the same cheek
  'forehead-wound': {
    color: '#7d0b0b', dark: '#3d0505', smear: '#a3221b',
    splats: [
      { x: 0.024, y: 0.052, r: 0.012, a: 0.95, drip: 0.0, core: true },
      { x: 0.034, y: 0.056, r: 0.008, a: 0.85, drip: 0.0 },
      { x: 0.016, y: 0.046, r: 0.007, a: 0.85, drip: 0.03 },
      { x: 0.030, y: 0.045, r: 0.006, a: 0.8, drip: 0.026 },
      { x: 0.023, y: 0.040, r: 0.005, a: 0.75, drip: 0.018 },
      { x: 0.048, y: -0.032, r: 0.013, a: 0.22, drip: 0.0, smear: true }
    ]
  },
  // dried blood under the left nostril and on the upper lip (nosebleed)
  nosebleed: {
    color: '#6e0909', dark: '#360404', smear: '#9a1f19',
    splats: [
      { x: 0.006, y: -0.058, r: 0.005, a: 0.9, drip: 0.012, core: true },
      { x: 0.004, y: -0.066, r: 0.006, a: 0.8, drip: 0.0 },
      { x: 0.012, y: -0.07, r: 0.008, a: 0.35, drip: 0.0, smear: true }
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

  const { canvas, ctx, W, H } = textureCanvas(mesh.material.map);
  const rand = rng(17);
  const k = frame.scale;
  const report = [];
  for (const s of P.splats) {
    const target = frame.origin.clone().addScaledVector(frame.right, s.x * k).addScaledVector(frame.up, s.y * k);
    const hit = projectToSurface(mesh, target, frame);
    report.push(hit ? { u: +hit.u.toFixed(3), v: +hit.v.toFixed(3) } : null);
    if (!hit) continue;
    const { u, v, du, dv } = hit;           // UV centre + UV change per preset-metre along right / up
    const px = u * W, py = v * H;
    const axisR = [du.x * W * k, du.y * H * k], axisU = [dv.x * W * k, dv.y * H * k];
    // irregular blob = a few jittered ellipses in the local surface frame
    const lumps = s.smear ? 9 : 6;
    for (let i = 0; i < lumps; i++) {
      const ang = rand() * Math.PI * 2, d = s.r * (s.smear ? 0.9 : 0.45) * rand();
      const ox = Math.cos(ang) * d * (s.smear ? 1.8 : 1), oy = Math.sin(ang) * d * 0.7;
      const rr = s.r * (0.45 + 0.5 * rand());
      blob(ctx, px + axisR[0] * ox + axisU[0] * oy, py + axisR[1] * ox + axisU[1] * oy, axisR, axisU, rr * (s.smear ? 1.6 : 1), rr, P.color, s.a * (s.smear ? 0.6 : 0.85));
    }
    if (s.core) blob(ctx, px, py, axisR, axisU, s.r * 0.35, s.r * 0.25, P.dark, 0.9);
    // drip: tapered run straight down the surface, slightly wobbly
    if (s.drip > 0) {
      const steps = 14;
      for (let k = 1; k <= steps; k++) {
        const f = k / steps, wob = Math.sin(f * 5 + rand() * 2) * 0.0015;
        const ox = wob, oy = -s.drip * f;
        const rr = s.r * 0.32 * (1 - 0.65 * f);
        blob(ctx, px + axisR[0] * ox + axisU[0] * oy, py + axisR[1] * ox + axisU[1] * oy, axisR, axisU, rr, rr * 1.3, P.color, s.a * 0.9);
      }
      const ox = 0, oy = -s.drip;                                   // drop at the end of the run
      blob(ctx, px + axisR[0] * ox + axisU[0] * oy, py + axisR[1] * ox + axisU[1] * oy, axisR, axisU, s.r * 0.22, s.r * 0.28, P.dark, 0.85);
    }
  }
  replaceMap(mesh.material, canvas);
  return { mesh: mesh.name, texture: `${W}x${H}`, splats: report };
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
  mesh.skeleton.update();                      // raycasting a skinned mesh uses the bone matrices
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

function blob(ctx, x, y, axisR, axisU, rx, ry, color, alpha) {
  ctx.save();
  ctx.setTransform(axisR[0] * rx, axisR[1] * rx, axisU[0] * ry, axisU[1] * ry, x, y);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  const c = new THREE.Color(color);
  const rgb = `${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)}`;
  g.addColorStop(0, `rgba(${rgb},${alpha})`);
  g.addColorStop(0.65, `rgba(${rgb},${alpha * 0.85})`);
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
