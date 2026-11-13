import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { ROOM } from './config.js';

/**
 * Consultation room: wood floor, plaster walls with an accent wall behind the patient, a daylight
 * window (matches the key light direction in scene.js), rug, upholstered chair, side table
 * with tissues + water, desk, bookshelf, plant, door, picture and a ceiling light.
 *
 * Everything is procedural (canvas textures, primitive geometry) so there are no extra assets to load,
 * and it is cheap enough for WebXR: one shadow-casting light, simple standard materials, instancing for
 * books and leaves, and soft "contact shadow" decals instead of screen-space AO.
 *
 * World layout (see scene.js): student at the origin looking down -z, patient at z = patientZ.
 */
export function buildRoom(scene, renderer, patientZ, { seat = 'chair' } = {}) {
  const { width: W, depth: D, height: H, seatHeight } = ROOM;
  const zFront = 1, zBack = 1 - D, zc = (zFront + zBack) / 2;
  const xL = -W / 2, xR = W / 2;
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const rand = rng(7);
  const room = new THREE.Group();
  room.name = 'room';
  scene.add(room);

  const add = (mesh, { cast = false, receive = true, parent = room } = {}) => {
    mesh.castShadow = cast; mesh.receiveShadow = receive; parent.add(mesh); return mesh;
  };
  const box = (w, h, d, material, r = 0) =>
    new THREE.Mesh(r > 0 ? new RoundedBoxGeometry(w, h, d, 3, r) : new THREE.BoxGeometry(w, h, d), material);

  // ---- textures -------------------------------------------------------------------------------
  const tex = (w, h, draw, repeat = [1, 1], srgb = true) => canvasTexture(w, h, draw, { repeat, srgb, aniso });
  const floorTex = tex(1024, 1024, (c, w, h) => drawWoodPlanks(c, w, h, rng(11)), [W / 1.6, D / 1.6]);
  const plaster = tex(512, 512, (c, w, h) => drawNoise(c, w, h, rng(3), '#f2f2f2', 0.035), [3, 2]);
  const fabricTex = tex(256, 256, (c, w, h) => drawWeave(c, w, h, rng(5)), [6, 6]);
  const doorWood = tex(512, 1024, (c, w, h) => drawGrain(c, w, h, rng(13), '#c9b49a'));
  const lightWood = tex(512, 512, (c, w, h) => drawGrain(c, w, h, rng(17), '#d8c3a3'), [1, 1]);

  // ---- materials ------------------------------------------------------------------------------
  const std = (o) => new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0, ...o });
  const M = {
    floor: std({ map: floorTex, roughness: 0.5 }),
    wall: std({ map: plaster, color: 0xece6dc, roughness: 0.95 }),
    accent: std({ map: plaster, color: 0xa7b39f, roughness: 0.95 }),   // muted sage behind the patient
    // a little self-light stands in for the bounce light a real ceiling gets from the floor and walls
    ceiling: std({ map: plaster, color: 0xf4f2ee, roughness: 1, emissive: 0xf4f2ee, emissiveIntensity: 0.3 }),
    trim: std({ color: 0xf5f3ee, roughness: 0.55 }),
    oak: std({ map: lightWood, roughness: 0.55 }),
    walnut: std({ map: lightWood, color: 0x8a6448, roughness: 0.5 }),
    door: std({ map: doorWood, roughness: 0.6 }),
    fabric: new THREE.MeshPhysicalMaterial({ map: fabricTex, color: 0x5d7c78, roughness: 0.95, sheen: 0.6, sheenRoughness: 0.7, sheenColor: 0x9fbdb8 }),
    metal: std({ color: 0x2b2d30, metalness: 0.8, roughness: 0.35 }),
    brushed: std({ color: 0xc8c8c8, metalness: 1, roughness: 0.3 }),
    ceramic: std({ color: 0xf1eee8, roughness: 0.35 }),
    soil: std({ color: 0x3b2c22, roughness: 1 })
  };

  // ---- shell ----------------------------------------------------------------------------------
  const plane = (w, h, material) => new THREE.Mesh(new THREE.PlaneGeometry(w, h), material);
  const floor = add(plane(W, D, M.floor));
  floor.rotation.x = -Math.PI / 2; floor.position.set(0, 0, zc);
  const ceiling = add(plane(W, D, M.ceiling), { receive: false });
  ceiling.rotation.x = Math.PI / 2; ceiling.position.set(0, H, zc);
  const back = add(plane(W, H, M.accent)); back.position.set(0, H / 2, zBack);
  const front = add(plane(W, H, M.wall)); front.position.set(0, H / 2, zFront); front.rotation.y = Math.PI;
  const left = add(plane(D, H, M.wall)); left.position.set(xL, H / 2, zc); left.rotation.y = Math.PI / 2;
  const right = add(plane(D, H, M.wall)); right.position.set(xR, H / 2, zc); right.rotation.y = -Math.PI / 2;

  // skirting boards + ceiling cove
  for (const [w, x, z, ry] of [[W, 0, zBack, 0], [W, 0, zFront, 0], [D, xL, zc, Math.PI / 2], [D, xR, zc, Math.PI / 2]]) {
    const sk = add(box(w, 0.09, 0.016, M.trim)); sk.position.set(x, 0.045, z); sk.rotation.y = ry;
    const cove = add(box(w, 0.05, 0.03, M.trim), { receive: false }); cove.position.set(x, H - 0.025, z); cove.rotation.y = ry;
  }

  // ---- window on the right wall (daylight; the key light in scene.js comes from here) -----------
  const win = { z: -1.0, y: 1.5, w: 1.5, h: 1.35 };
  const sky = new THREE.MeshBasicMaterial({ map: tex(512, 512, (c, w, h) => drawWindowView(c, w, h, rng(23))), toneMapped: false });
  const glass = add(plane(win.w, win.h, sky), { receive: false });
  glass.position.set(xR - 0.004, win.y, win.z); glass.rotation.y = -Math.PI / 2;
  const fr = 0.06;
  for (const [w, h, dy, dz] of [
    [win.w + 2 * fr, fr, win.h / 2 + fr / 2, 0], [win.w + 2 * fr, fr, -win.h / 2 - fr / 2, 0],
    [fr, win.h, 0, win.w / 2 + fr / 2], [fr, win.h, 0, -win.w / 2 - fr / 2],
    [0.035, win.h, 0, 0], [win.w, 0.035, 0.12, 0]
  ]) {
    const f = add(box(0.07, h, w, M.trim)); f.position.set(xR - 0.03, win.y + dy, win.z + dz);
  }
  const sill = add(box(0.2, 0.03, win.w + 0.24, M.trim)); sill.position.set(xR - 0.09, win.y - win.h / 2 - fr - 0.015, win.z);

  // ---- ceiling light panel ------------------------------------------------------------------------
  const panel = add(box(0.62, 0.03, 0.62, new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff1de, emissiveIntensity: 1.6 }), 0.008), { receive: false });
  panel.position.set(0, H - 0.015, patientZ + 0.4);

  // ---- rug between student and patient ------------------------------------------------------------
  const rugTex = tex(1024, 768, (c, w, h) => drawRug(c, w, h, rng(29)));
  const rug = add(plane(2.2, 1.6, std({ map: rugTex, roughness: 1 })));
  rug.rotation.x = -Math.PI / 2; rug.position.set(0, 0.003, patientZ + 0.55);

  // ---- patient seat: wheelchair or upholstered chair (armless so the hands are free) ---------------
  const chair = new THREE.Group();
  chair.position.set(0, 0, patientZ);
  room.add(chair);
  const wheelchair = seat === 'wheelchair' ? buildWheelchair(chair, add, M, seatHeight) : null;
  if (!wheelchair) {
  const cushion = add(box(0.52, 0.09, 0.5, M.fabric, 0.03), { cast: true, parent: chair });
  cushion.position.set(0, seatHeight - 0.045, 0);
  const seatFrame = add(box(0.5, 0.04, 0.47, M.walnut, 0.01), { cast: true, parent: chair });
  seatFrame.position.set(0, seatHeight - 0.11, 0);
  const legH = seatHeight - 0.13;
  for (const [x, z] of [[-0.21, 0.19], [0.21, 0.19], [-0.21, -0.19], [0.21, -0.19]]) {
    const leg = add(new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.014, legH, 12), M.walnut), { cast: true, parent: chair });
    leg.position.set(x * 1.04, legH / 2, z * 1.04);
    leg.rotation.set(z > 0 ? 0.06 : -0.06, 0, x > 0 ? -0.06 : 0.06);   // slight splay
  }
  const backrest = add(box(0.5, 0.44, 0.08, M.fabric, 0.03), { cast: true, parent: chair });
  backrest.position.set(0, seatHeight + 0.33, -0.27);
  backrest.rotation.x = -0.12;
  // side uprights from the seat frame to the top of the backrest
  for (const x of [-0.266, 0.266]) {
    const post = add(new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.017, 0.66, 10), M.walnut), { cast: true, parent: chair });
    post.position.set(x, seatHeight + 0.22, -0.258); post.rotation.x = -0.12;
  }
  }

  // ---- side table with tissues and a glass of water (patient's left) ------------------------------
  const st = new THREE.Group();
  st.position.set(0.68, 0, patientZ - 0.05);
  room.add(st);
  const top = add(new THREE.Mesh(new THREE.CylinderGeometry(0.21, 0.21, 0.025, 40), M.oak), { cast: true, parent: st });
  top.position.y = 0.56;
  const stem = add(new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.54, 12), M.metal), { cast: true, parent: st });
  stem.position.y = 0.28;
  const foot = add(new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.16, 0.015, 32), M.metal), { parent: st });
  foot.position.y = 0.008;
  const tissueBox = add(box(0.23, 0.09, 0.12, std({ color: 0xc9d6df, roughness: 0.7 }), 0.006), { cast: true, parent: st });
  tissueBox.position.set(-0.03, 0.618, -0.05); tissueBox.rotation.y = 0.35;
  const tissue = add(new THREE.Mesh(new THREE.SphereGeometry(0.04, 12, 8), std({ color: 0xffffff, roughness: 1 })), { parent: st });
  tissue.scale.set(1, 0.9, 0.5); tissue.position.set(-0.03, 0.675, -0.05); tissue.rotation.y = 0.35;
  const glassMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.22, depthWrite: false });
  const cup = add(new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.03, 0.11, 24, 1, true), glassMat), { receive: false, parent: st });
  cup.position.set(0.1, 0.628, 0.08); cup.renderOrder = 2;
  const water = add(new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.029, 0.07, 24), new THREE.MeshStandardMaterial({ color: 0xcfe4ea, roughness: 0.05, transparent: true, opacity: 0.35, depthWrite: false })), { receive: false, parent: st });
  water.position.set(0.1, 0.608, 0.08); water.renderOrder = 1;

  // ---- desk on the student's left, with laptop, notepad and mug -----------------------------------
  const desk = new THREE.Group();
  desk.position.set(xL + 0.6, 0, -0.55);
  desk.rotation.y = Math.PI / 2;
  room.add(desk);
  const deskTop = add(box(1.4, 0.035, 0.7, M.oak, 0.008), { cast: true, parent: desk });
  deskTop.position.y = 0.74;
  for (const [x, z] of [[-0.64, -0.29], [0.64, -0.29], [-0.64, 0.29], [0.64, 0.29]]) {
    const leg = add(box(0.035, 0.725, 0.035, M.metal), { cast: true, parent: desk });
    leg.position.set(x, 0.3625, z);
  }
  const apron = add(box(1.24, 0.06, 0.02, M.oak), { parent: desk });
  apron.position.set(0, 0.69, -0.29);
  const laptop = new THREE.Group(); laptop.position.set(0.15, 0.758, 0.05); laptop.rotation.y = -0.25; desk.add(laptop);
  add(box(0.32, 0.014, 0.22, M.brushed, 0.004), { cast: true, parent: laptop });
  const lid = new THREE.Group(); lid.position.set(0, 0.007, -0.11); lid.rotation.x = -0.3; laptop.add(lid);
  const lidBox = add(box(0.32, 0.21, 0.006, M.brushed, 0.003), { cast: true, parent: lid }); lidBox.position.y = 0.105;
  const screen = add(plane(0.3, 0.19, new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0x9fb6d0, emissiveIntensity: 0.35, roughness: 0.2 })), { parent: lid });
  screen.position.set(0, 0.105, 0.004);
  const pad = add(box(0.15, 0.008, 0.21, std({ color: 0xfaf8f2, roughness: 0.9 })), { parent: desk });
  pad.position.set(-0.3, 0.761, 0.12); pad.rotation.y = 0.15;
  const pen = add(new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.14, 8), M.metal), { parent: desk });
  pen.rotation.set(Math.PI / 2, 0, 0.5); pen.position.set(-0.2, 0.768, 0.12);
  const mug = add(new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.038, 0.095, 24), std({ color: 0x3f5f7a, roughness: 0.3 })), { cast: true, parent: desk });
  mug.position.set(-0.5, 0.805, -0.12);

  // ---- bookshelf against the back wall ----------------------------------------------------------
  const shelf = new THREE.Group();
  shelf.position.set(-1.25, 0, zBack + 0.17);
  room.add(shelf);
  const sw = 1.0, sh = 1.85, sd = 0.32, t = 0.022;
  for (const x of [-sw / 2 + t / 2, sw / 2 - t / 2]) { const s = add(box(t, sh, sd, M.oak), { cast: true, parent: shelf }); s.position.set(x, sh / 2, 0); }
  const levels = [0.05, 0.42, 0.79, 1.16, 1.53, sh - t / 2];
  for (const y of levels) { const s = add(box(sw, t, sd, M.oak), { parent: shelf }); s.position.set(0, y, 0); }
  const backPanel = add(box(sw, sh, 0.008, M.oak), { parent: shelf }); backPanel.position.set(0, sh / 2, -sd / 2 + 0.004);
  const palette = [0x7b2e2e, 0x2f4858, 0xc8b88a, 0x4a6b5a, 0x8c6d4f, 0xe6dccb, 0x384454, 0x9a4f3c, 0x6a7f8f, 0x2b2b2b];
  const books = [];
  for (let l = 0; l < levels.length - 1; l++) {
    let x = -sw / 2 + t + 0.01;
    const end = sw / 2 - t - 0.02 - (rand() < 0.5 ? rand() * 0.3 : 0);
    while (x < end) {
      const bw = 0.018 + rand() * 0.035, bh = 0.2 + rand() * 0.11, bd = 0.17 + rand() * 0.08;
      if (x + bw > end) break;
      books.push({ x: x + bw / 2, y: levels[l] + t / 2 + bh / 2, w: bw, h: bh, d: bd, c: palette[Math.floor(rand() * palette.length)] });
      x += bw + 0.002;
      if (rand() < 0.06) x += 0.06 + rand() * 0.1;   // gaps
    }
  }
  const bookMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), std({ roughness: 0.75 }), books.length);
  const dummy = new THREE.Object3D(), col = new THREE.Color();
  books.forEach((b, i) => {
    dummy.position.set(b.x, b.y, -sd / 2 + 0.01 + b.d / 2); dummy.rotation.set(0, 0, 0); dummy.scale.set(b.w, b.h, b.d); dummy.updateMatrix();
    bookMesh.setMatrixAt(i, dummy.matrix);
    bookMesh.setColorAt(i, col.setHex(b.c).offsetHSL(0, 0, (rand() - 0.5) * 0.08));
  });
  add(bookMesh, { parent: shelf });

  // ---- plant (snake plant) in the window-side corner -------------------------------------------
  const plant = new THREE.Group();
  plant.position.set(xR - 0.42, 0, zBack + 0.45);
  room.add(plant);
  const pot = add(new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.13, 0.4, 32), M.ceramic), { cast: true, parent: plant });
  pot.position.y = 0.2;
  const soil = add(new THREE.Mesh(new THREE.CircleGeometry(0.16, 24), M.soil), { parent: plant });
  soil.rotation.x = -Math.PI / 2; soil.position.y = 0.38;
  const leafCount = 28;
  const leaves = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 8), std({ color: 0xffffff, roughness: 0.6 }), leafCount);
  const up = new THREE.Vector3();
  for (let i = 0; i < leafCount; i++) {
    const a = rand() * Math.PI * 2, tilt = 0.05 + rand() * 0.45, len = 0.35 + rand() * 0.4, r0 = rand() * 0.09;
    up.set(Math.cos(a) * Math.sin(tilt), Math.cos(tilt), Math.sin(a) * Math.sin(tilt));
    // unit sphere squashed into a blade; its centre sits half a leaf length above the soil
    dummy.position.set(Math.cos(a) * r0, 0.36, Math.sin(a) * r0).addScaledVector(up, len / 2);
    dummy.scale.set(0.028 + rand() * 0.02, 0.006, len / 2);
    dummy.lookAt(dummy.position.clone().add(up));
    dummy.rotateZ(rand() * Math.PI);
    dummy.updateMatrix();
    leaves.setMatrixAt(i, dummy.matrix);
    leaves.setColorAt(i, col.setHSL(0.27 + rand() * 0.06, 0.45 + rand() * 0.2, 0.18 + rand() * 0.12));
  }
  add(leaves, { cast: true, parent: plant });

  // ---- door on the left wall --------------------------------------------------------------------
  const door = new THREE.Group();
  door.position.set(xL, 0, -2.9);
  door.rotation.y = Math.PI / 2;
  room.add(door);
  const slab = add(box(0.9, 2.05, 0.04, M.door), { parent: door }); slab.position.set(0, 1.025, 0.012);
  for (const [w, h, x, y] of [[0.08, 2.13, -0.49, 1.065], [0.08, 2.13, 0.49, 1.065], [1.06, 0.08, 0, 2.09]]) {
    const tr = add(box(w, h, 0.03, M.trim), { parent: door }); tr.position.set(x, y, 0.016);
  }
  const handle = add(new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.13, 10), M.brushed), { parent: door });
  handle.rotation.z = Math.PI / 2; handle.position.set(0.33, 1.03, 0.07);
  const rose = add(new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.012, 16), M.brushed), { parent: door });
  rose.rotation.x = Math.PI / 2; rose.position.set(0.38, 1.03, 0.04);

  // ---- picture on the accent wall, above the patient's head from the student's view ----------------
  const art = new THREE.Group();
  art.position.set(0.55, 1.9, zBack + 0.02);
  room.add(art);
  add(box(0.86, 0.64, 0.03, M.walnut), { parent: art });
  const passepartout = add(plane(0.8, 0.58, std({ color: 0xf6f3ec, roughness: 0.9 })), { parent: art });
  passepartout.position.z = 0.016;
  const painting = add(plane(0.64, 0.44, std({ map: tex(512, 352, (c, w, h) => drawLandscape(c, w, h, rng(31))), roughness: 0.9 })), { parent: art });
  painting.position.z = 0.017;

  // ---- soft contact shadows (cheap AO stand-in, also works in XR) -----------------------------------
  const blob = tex(128, 128, (c, w) => {
    const g = c.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    g.addColorStop(0, '#fff'); g.addColorStop(0.5, '#999'); g.addColorStop(1, '#000');
    c.fillStyle = g; c.fillRect(0, 0, w, w);
  }, [1, 1], false);
  blob.wrapS = blob.wrapT = THREE.ClampToEdgeWrapping;
  const blobMat = (opacity) => new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: blob, transparent: true, opacity, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  for (const [x, z, w, d, o] of [
    [0, patientZ - 0.02, 0.85, 0.8, 0.45],       // chair
    [st.position.x, st.position.z, 0.5, 0.5, 0.4],
    [plant.position.x, plant.position.z, 0.55, 0.55, 0.45],
    [shelf.position.x, shelf.position.z, 1.3, 0.55, 0.4],
    [desk.position.x, desk.position.z, 0.95, 1.6, 0.35]
  ]) {
    const s = new THREE.Mesh(new THREE.PlaneGeometry(w, d), blobMat(o));
    s.rotation.x = -Math.PI / 2; s.position.set(x, 0.005, z); s.renderOrder = 1;
    room.add(s);
  }

  // fitToPatient(head): wheelchair footrests move under the patient's feet once she is loaded
  return { room, window: win, chair, fitToPatient: (head) => wheelchair?.fitToPatient(head) };
}

// =================================================================================================
// Manual wheelchair (rigid frame, 24" rear wheels, front casters, footrests). Local space of the
// patient anchor: patient faces +z, seat centre at x = z = 0, seat surface at `seatHeight`.
// =================================================================================================
export function buildWheelchair(parent, add, M, seatHeight) {
  const wc = new THREE.Group();
  wc.name = 'wheelchair';
  parent.add(wc);
  const frame = new THREE.MeshStandardMaterial({ color: 0x1f2226, metalness: 0.6, roughness: 0.4 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.9 });
  const upholstery = new THREE.MeshPhysicalMaterial({ color: 0x24272c, roughness: 0.9, sheen: 0.4, sheenRoughness: 0.8, sheenColor: 0x555a62 });
  const up = new THREE.Vector3(0, 1, 0);
  const tube = (a, b, r = 0.0125, material = frame, p = wc) => {
    const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), d = B.clone().sub(A);
    const m = add(new THREE.Mesh(new THREE.CylinderGeometry(r, r, d.length(), 12), material), { cast: true, parent: p });
    m.position.copy(A).addScaledVector(d, 0.5);
    m.quaternion.setFromUnitVectors(up, d.normalize());
    return m;
  };
  const rail = 0.235, yRail = seatHeight - 0.075;

  // seat cushion + backrest sling
  const cushion = add(new THREE.Mesh(new RoundedBoxGeometry(0.46, 0.065, 0.44, 3, 0.02), upholstery), { cast: true, parent: wc });
  cushion.position.set(0, seatHeight - 0.032, 0.0);
  const back = add(new THREE.Mesh(new RoundedBoxGeometry(0.46, 0.38, 0.025, 3, 0.01), upholstery), { cast: true, parent: wc });
  back.position.set(0, seatHeight + 0.24, -0.255); back.rotation.x = -0.08;

  for (const s of [-1, 1]) {
    const x = s * rail;
    tube([x, yRail, -0.24], [x, yRail, 0.24]);                         // seat rail
    tube([x, yRail, 0.24], [x, 0.17, 0.33]);                           // front down-tube
    tube([x, 0.17, -0.25], [x, seatHeight + 0.47, -0.285]);            // backrest post
    tube([x, seatHeight + 0.47, -0.285], [x, seatHeight + 0.49, -0.37], 0.0125); // push handle
    tube([x, seatHeight + 0.49, -0.335], [x, seatHeight + 0.495, -0.385], 0.017, rubber); // grip
    tube([x, 0.17, -0.25], [x, 0.17, 0.33]);                           // lower rail
    tube([x, 0.17, 0.30], [x, 0.135, 0.30], 0.016);                    // caster housing
    // clothing guard above the wheel
    const guard = add(new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.09, 0.30), frame), { parent: wc });
    guard.position.set(s * (rail + 0.015), seatHeight + 0.005, -0.06);

    // rear wheel: tyre, rim, hand rim, hub, spokes (slight camber, top leans in)
    const wheel = new THREE.Group();
    wheel.position.set(s * (rail + 0.075), 0.305, -0.13);
    wheel.rotation.z = s * 0.05;
    wc.add(wheel);
    const R = 0.29;
    const tyre = add(new THREE.Mesh(new THREE.TorusGeometry(R, 0.016, 10, 64), rubber), { cast: true, parent: wheel });
    tyre.rotation.y = Math.PI / 2;
    const rim = add(new THREE.Mesh(new THREE.TorusGeometry(R - 0.018, 0.007, 8, 64), M.brushed), { parent: wheel });
    rim.rotation.y = Math.PI / 2;
    const hand = add(new THREE.Mesh(new THREE.TorusGeometry(R - 0.03, 0.0085, 8, 64), M.brushed), { cast: true, parent: wheel });
    hand.rotation.y = Math.PI / 2; hand.position.x = s * 0.035;
    const hub = add(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.06, 16), M.brushed), { parent: wheel });
    hub.rotation.z = Math.PI / 2;
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2, xo = (i % 2 ? 1 : -1) * 0.02;
      tube([xo, 0, 0], [0, Math.cos(a) * (R - 0.02), Math.sin(a) * (R - 0.02)], 0.0016, M.brushed, wheel);
    }
    for (let i = 0; i < 6; i++) {                                       // hand-rim standoffs
      const a = (i / 6) * Math.PI * 2;
      tube([0, Math.cos(a) * (R - 0.03), Math.sin(a) * (R - 0.03)], [s * 0.035, Math.cos(a) * (R - 0.03), Math.sin(a) * (R - 0.03)], 0.004, M.brushed, wheel);
    }
    tube([0, 0, 0], [-s * 0.075, 0.17 - 0.305, -0.12 + 0.13], 0.012, frame, wheel); // axle mount to lower rail

    // front caster: fork + small wheel
    const caster = new THREE.Group();
    caster.position.set(x, 0.065, 0.335);
    wc.add(caster);
    const cw = add(new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.025, 24), rubber), { cast: true, parent: caster });
    cw.rotation.z = Math.PI / 2;
    for (const fx of [-0.018, 0.018]) tube([fx, 0, -0.02], [fx, 0.075, 0.0], 0.005, frame, caster);
  }
  tube([-rail, yRail, -0.22], [rail, yRail, -0.22], 0.011);             // cross brace under the seat
  tube([-rail, 0.17, 0.1], [rail, 0.17, 0.1], 0.011);

  // footrests: hangers + plates; placed under the feet by fitToPatient()
  const footrest = new THREE.Group();
  wc.add(footrest);
  const plateMat = new THREE.MeshStandardMaterial({ color: 0x2a2c30, metalness: 0.4, roughness: 0.6 });
  const plates = [-1, 1].map(() => {
    const p = add(new THREE.Mesh(new RoundedBoxGeometry(0.15, 0.014, 0.12, 2, 0.004), plateMat), { cast: true, parent: footrest });
    p.position.set(0, 0.04, 0.42);
    return p;
  });
  const hangers = [];
  const placeFootrest = (feet) => {
    for (const h of hangers) { h.geometry.dispose(); footrest.remove(h); }
    hangers.length = 0;
    feet.forEach((f, i) => {
      const s = f.x > 0 ? 1 : -1;
      plates[i].position.set(f.x, f.y - 0.007, f.z);
      hangers.push(tube([s * rail, 0.17, 0.33], [s * rail, f.y, f.z + 0.02], 0.011, frame, footrest));
      hangers.push(tube([s * rail, f.y, f.z + 0.02], [f.x + s * 0.075, f.y - 0.004, f.z + 0.02], 0.008, frame, footrest));
    });
  };
  placeFootrest([{ x: -0.1, y: 0.05, z: 0.42 }, { x: 0.1, y: 0.05, z: 0.42 }]);

  return {
    group: wc,
    /** Move the footrest plates under the soles of the loaded avatar (local space of the anchor). */
    fitToPatient(head) {
      const arm = head.armature;
      arm.updateMatrixWorld(true);
      const toLocal = new THREE.Matrix4().copy(parent.matrixWorld).invert();
      // lowest skinned vertex of the whole body = the soles (she is seated)
      let soleY = Infinity;
      arm.traverse((o) => {
        if (!o.isSkinnedMesh) return;
        o.computeBoundingBox();
        const b = o.boundingBox.clone().applyMatrix4(o.matrixWorld).applyMatrix4(toLocal);
        soleY = Math.min(soleY, b.min.y);
      });
      const v = new THREE.Vector3(), w = new THREE.Vector3();
      const feet = ['Left', 'Right'].map((side) => {
        arm.getObjectByName(side + 'Foot').getWorldPosition(v).applyMatrix4(toLocal);
        arm.getObjectByName(side + 'ToeBase').getWorldPosition(w).applyMatrix4(toLocal);
        return { x: (v.x + w.x) / 2, y: Math.max(0.03, soleY), z: (v.z + w.z) / 2 + 0.01 };
      });
      placeFootrest(feet);
    }
  };
}

// =================================================================================================
// Procedural canvas textures (seeded so the room is identical on every load)
// =================================================================================================
function rng(seed) {
  let s = seed * 2654435761 % 2147483647 || 1;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

function canvasTexture(w, h, draw, { repeat = [1, 1], srgb = true, aniso = 8 } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = aniso;
  return t;
}

const hsl = (h, s, l, a = 1) => `hsla(${h},${s}%,${l}%,${a})`;

function grainLines(c, x, y, w, h, r, count, color) {
  c.save();
  c.beginPath(); c.rect(x, y, w, h); c.clip();
  for (let i = 0; i < count; i++) {
    const gx = x + r() * w, amp = 1 + r() * 4, freq = 0.004 + r() * 0.01, ph = r() * 6;
    c.strokeStyle = color(r());
    c.lineWidth = 0.6 + r() * 1.6;
    c.beginPath();
    for (let yy = y - 2; yy <= y + h + 2; yy += 8) {
      const xx = gx + Math.sin(yy * freq + ph) * amp;
      yy === y - 2 ? c.moveTo(xx, yy) : c.lineTo(xx, yy);
    }
    c.stroke();
  }
  c.restore();
}

function drawWoodPlanks(c, w, h, r) {
  const cols = 8, pw = w / cols;
  for (let i = 0; i < cols; i++) {
    let y = -r() * h;
    while (y < h) {
      const len = h * (0.7 + r() * 0.8);
      const hue = 30 + r() * 6, sat = 20 + r() * 8, lig = 48 + r() * 7;
      for (const oy of [y, y + h, y - h]) {            // wrap vertically so the texture tiles
        if (oy > h || oy + len < 0) continue;
        c.fillStyle = hsl(hue, sat, lig);
        c.fillRect(i * pw, oy, pw, len);
        grainLines(c, i * pw, oy, pw, len, r, 26, (k) => hsl(hue - 4, sat + 6, lig - 14 - k * 10, 0.08 + k * 0.12));
        // a knot now and then
        if (r() < 0.25) {
          const kx = i * pw + pw * (0.2 + r() * 0.6), ky = oy + len * r();
          const g = c.createRadialGradient(kx, ky, 0, kx, ky, 7 + r() * 6);
          g.addColorStop(0, hsl(hue - 6, sat, lig - 25, 0.7)); g.addColorStop(1, hsl(hue, sat, lig, 0));
          c.fillStyle = g; c.beginPath(); c.ellipse(kx, ky, 6, 14, 0, 0, Math.PI * 2); c.fill();
        }
        c.fillStyle = 'rgba(40,25,15,0.55)';          // end joint
        c.fillRect(i * pw, oy, pw, 2);
      }
      y += len;
    }
    c.fillStyle = 'rgba(40,25,15,0.6)';                // long joint
    c.fillRect(i * pw, 0, 2, h);
  }
}

function drawGrain(c, w, h, r, base) {
  c.fillStyle = base; c.fillRect(0, 0, w, h);
  grainLines(c, 0, 0, w, h, r, 90, (k) => `rgba(110,75,45,${0.05 + k * 0.1})`);
}

function drawNoise(c, w, h, r, base, amount) {
  c.fillStyle = base; c.fillRect(0, 0, w, h);
  for (let i = 0; i < w * h * 0.06; i++) {
    const v = r() < 0.5 ? 0 : 255;
    c.fillStyle = `rgba(${v},${v},${v},${amount * r()})`;
    const s = 1 + r() * 3;
    c.fillRect(r() * w, r() * h, s, s);
  }
}

function drawWeave(c, w, h, r) {
  c.fillStyle = '#d8d8d8'; c.fillRect(0, 0, w, h);
  for (let y = 0; y < h; y += 4) { c.fillStyle = `rgba(255,255,255,${0.1 + r() * 0.15})`; c.fillRect(0, y, w, 2); }
  for (let x = 0; x < w; x += 4) { c.fillStyle = `rgba(0,0,0,${0.05 + r() * 0.1})`; c.fillRect(x, 0, 2, h); }
  for (let i = 0; i < 1500; i++) { c.fillStyle = `rgba(0,0,0,${r() * 0.06})`; c.fillRect(r() * w, r() * h, 2, 2); }
}

function drawRug(c, w, h, r) {
  c.fillStyle = '#4a5363'; c.fillRect(0, 0, w, h);
  const band = (inset, color, width) => { c.strokeStyle = color; c.lineWidth = width; c.strokeRect(inset, inset, w - 2 * inset, h - 2 * inset); };
  band(18, '#d9cdb8', 10); band(40, '#8c5a4a', 6); band(60, '#d9cdb8', 3);
  // simple lattice in the field
  c.strokeStyle = 'rgba(217,205,184,0.18)'; c.lineWidth = 3;
  for (let x = 90; x < w - 80; x += 70) for (let y = 90; y < h - 80; y += 70) {
    c.beginPath(); c.moveTo(x, y + 20); c.lineTo(x + 20, y); c.lineTo(x + 40, y + 20); c.lineTo(x + 20, y + 40); c.closePath(); c.stroke();
  }
  // pile noise
  for (let i = 0; i < 40000; i++) { const v = r() < 0.5 ? 0 : 255; c.fillStyle = `rgba(${v},${v},${v},${r() * 0.07})`; c.fillRect(r() * w, r() * h, 2, 2); }
}

function drawWindowView(c, w, h, r) {
  const g = c.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#9fc1e6'); g.addColorStop(0.55, '#dbe9f4'); g.addColorStop(1, '#f3f6f6');
  c.fillStyle = g; c.fillRect(0, 0, w, h);
  // soft clouds
  for (let i = 0; i < 14; i++) {
    const x = r() * w, y = r() * h * 0.45, rad = 30 + r() * 60;
    const cg = c.createRadialGradient(x, y, 0, x, y, rad);
    cg.addColorStop(0, 'rgba(255,255,255,0.55)'); cg.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = cg; c.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  // out-of-focus tree line (soft radial blobs instead of ctx.filter, which Safari lacks)
  for (let i = 0; i < 160; i++) {
    const x = r() * w, y = h * (0.62 + r() * 0.3), rad = 18 + r() * 40;
    const tg = c.createRadialGradient(x, y, 0, x, y, rad);
    const l = 30 + r() * 18;
    tg.addColorStop(0, hsl(95 + r() * 30, 30, l, 0.55)); tg.addColorStop(1, hsl(100, 30, l, 0));
    c.fillStyle = tg; c.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
}

function drawLandscape(c, w, h, r) {
  const g = c.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#e8d9c0'); g.addColorStop(0.6, '#f1e6d2'); g.addColorStop(1, '#d9c7a8');
  c.fillStyle = g; c.fillRect(0, 0, w, h);
  c.fillStyle = 'rgba(214,140,96,0.75)'; c.beginPath(); c.arc(w * 0.68, h * 0.33, h * 0.11, 0, Math.PI * 2); c.fill();
  const layers = ['#a9b7a3', '#86977f', '#5f7262', '#3f5148'];
  layers.forEach((color, i) => {
    c.fillStyle = color;
    c.beginPath(); c.moveTo(0, h);
    const base = h * (0.5 + i * 0.12), amp = h * (0.08 - i * 0.012), ph = r() * 6, f = 1.5 + r() * 2;
    for (let x = 0; x <= w; x += 8) c.lineTo(x, base - Math.sin(x / w * Math.PI * f + ph) * amp - Math.sin(x / w * 13 + ph) * amp * 0.15);
    c.lineTo(w, h); c.closePath(); c.fill();
  });
  for (let i = 0; i < 8000; i++) { c.fillStyle = `rgba(0,0,0,${r() * 0.05})`; c.fillRect(r() * w, r() * h, 1.5, 1.5); }
}
