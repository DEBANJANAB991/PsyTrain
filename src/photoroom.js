import * as THREE from 'three';
import { GroundedSkybox } from 'three/addons/objects/GroundedSkybox.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { ROOM, PHOTO_ROOM } from './config.js';
import { buildWheelchair } from './room.js';

/**
 * A real room instead of the modelled one: a 360° photo of a sitting room (Poly Haven "Reading Room",
 * CC0) projected onto a dome with a flat floor (three.js GroundedSkybox), so the patient and her chair
 * stand on the photo's floor. The same room's HDR lights the avatar, so skin and clothes pick up the
 * photo's real light colours. The chair is a scanned-quality model (Poly Haven "Dining Chair 02", CC0).
 *
 * WebXR cost: one textured dome (6K photo, no lighting), one prefiltered environment map, one shadow-casting
 * light whose shadow falls on an invisible ShadowMaterial floor.
 *
 * World layout (see scene.js): student at the origin looking down -z, patient at z = patientZ.
 * Returns the same shape as buildRoom() plus `ready`, a promise that resolves when the photo, HDR and chair
 * are loaded.
 */
export function buildPhotoRoom(scene, renderer, patientZ, { seat = 'chair' } = {}) {
  const P = PHOTO_ROOM;
  const room = new THREE.Group();
  room.name = 'photo-room';
  scene.add(room);
  const add = (mesh, { cast = false, receive = true, parent = room } = {}) => {
    mesh.castShadow = cast; mesh.receiveShadow = receive; parent.add(mesh); return mesh;
  };

  // ---- floor that only shows shadows + soft contact shadow under the chair ---------------------------
  const shadowFloor = add(new THREE.Mesh(new THREE.PlaneGeometry(8, 8), new THREE.ShadowMaterial({ opacity: P.shadow })));
  shadowFloor.rotation.x = -Math.PI / 2;
  shadowFloor.position.set(0, 0.001, patientZ);
  const blobTex = contactTexture();
  const contact = add(new THREE.Mesh(new THREE.PlaneGeometry(0.85, 0.85),
    new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, toneMapped: false })), { receive: false });
  contact.rotation.x = -Math.PI / 2;
  contact.position.set(0, 0.002, patientZ + 0.02);

  // ---- patient seat ---------------------------------------------------------------------------------
  const chair = new THREE.Group();
  chair.position.set(0, 0, patientZ);
  room.add(chair);
  const wheelchair = seat === 'wheelchair'
    ? buildWheelchair(chair, add, { brushed: new THREE.MeshStandardMaterial({ color: 0xc8c8c8, metalness: 1, roughness: 0.3 }) }, ROOM.seatHeight)
    : null;

  // ---- loading ----------------------------------------------------------------------------------------
  const photo = new THREE.TextureLoader().loadAsync(P.photo).then((tex) => {
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    const sky = new GroundedSkybox(tex, P.cameraHeight, P.radius);
    sky.material.toneMapped = false;            // the photo is already tonemapped: show it as shot
    sky.position.y = P.cameraHeight;            // floor of the photo at y = 0
    // a sphere-UV u of 0.25 points down -z; turn the photo so backU sits behind the patient
    sky.rotation.y = 2 * Math.PI * (P.backU - 0.25);
    sky.renderOrder = -1;
    sky.name = 'room-photo';
    room.add(sky);
  });

  const light = new HDRLoader().loadAsync(P.hdr).then((hdr) => {
    hdr.mapping = THREE.EquirectangularReflectionMapping;
    const pmrem = new THREE.PMREMGenerator(renderer);
    const env = pmrem.fromEquirectangular(hdr).texture;
    hdr.dispose(); pmrem.dispose();
    scene.environment = env;
    scene.environmentIntensity = P.environment;
    // match the photo's turn so the light comes from where the windows are in the picture
    scene.environmentRotation.y = 2 * Math.PI * (P.backU - 0.25);
  });

  const chairModel = wheelchair ? Promise.resolve() : new GLTFLoader().loadAsync(P.chair.url).then((gltf) => {
    const m = gltf.scene;
    m.scale.setScalar(ROOM.seatHeight / P.chair.seatTop);     // its seat top at our seat height
    m.position.z = P.chair.z;
    m.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true; o.receiveShadow = true;
      if (o.material.map) o.material.map.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    });
    chair.add(m);
  });

  const ready = Promise.all([photo, light, chairModel]).catch((e) => {
    console.error('[photoroom] failed to load the room', e);
    throw e;
  });

  // where the key light comes from: behind the student, a little right and above (soft "ceiling" light)
  const keyFrom = new THREE.Vector3(0.9, 2.6, 1.2);

  return {
    room, chair, ready, keyFrom,
    fitToPatient: (head) => wheelchair?.fitToPatient(head)
  };
}

function contactTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g2 = c.getContext('2d');
  const g = g2.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(0,0,0,0.45)');
  g.addColorStop(0.5, 'rgba(0,0,0,0.22)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  g2.fillStyle = g; g2.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
