import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ROOM } from './config.js';

/**
 * Virtual consultation room + camera rig.
 * World layout: student at origin (eye height ROOM.eyeHeight), patient at z = -patientDistance
 * facing +z (towards the student). XR uses the 'local' reference space and the rig is lifted
 * to ROOM.eyeHeight, so the student's eyes are always at seated height, however they sit.
 */
export function createScene(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.xr.enabled = true;
  renderer.xr.setReferenceSpaceType('local');
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x20242a);

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.55;

  const camera = new THREE.PerspectiveCamera(50, container.clientWidth / container.clientHeight, 0.05, 50);
  const rig = new THREE.Group();
  rig.add(camera);
  scene.add(rig);

  const patientZ = -ROOM.patientDistance;
  const patientAnchor = new THREE.Group();
  patientAnchor.position.set(0, 0, patientZ);
  scene.add(patientAnchor);

  buildRoom(scene, patientZ);

  // Lights
  const key = new THREE.DirectionalLight(0xfff1e0, 1.6);
  key.position.set(1.5, 2.5, 0.5);
  key.target.position.set(0, 1, patientZ);
  scene.add(key, key.target);
  scene.add(new THREE.HemisphereLight(0xdde6ff, 0x806f5a, 0.5));

  // Desktop camera: orbit around the patient's head for debugging
  const desktopPos = new THREE.Vector3(0, ROOM.eyeHeight, 0);
  const controls = new OrbitControls(camera, renderer.domElement);
  const target = new THREE.Vector3(0, 1.15, patientZ);
  controls.target.copy(target);
  controls.enableDamping = true;
  camera.position.copy(desktopPos);
  controls.update();

  renderer.xr.addEventListener('sessionstart', () => {
    controls.enabled = false;
    camera.position.set(0, 0, 0);
    camera.rotation.set(0, 0, 0);
    rig.position.set(0, ROOM.eyeHeight, 0);
  });
  renderer.xr.addEventListener('sessionend', () => {
    rig.position.set(0, 0, 0);
    camera.position.copy(desktopPos);
    controls.enabled = true;
    controls.update();
  });

  const vrButton = VRButton.createButton(renderer);
  vrButton.style.zIndex = '10';
  document.body.appendChild(vrButton);

  window.addEventListener('resize', () => {
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
  });

  return { THREE, renderer, scene, camera, rig, controls, patientAnchor, patientZ };
}

function mat(color, rough = 0.85) {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0 });
}

function buildRoom(scene, patientZ) {
  const { width: W, depth: D, height: H, seatHeight } = ROOM;
  const zc = -D / 2 + 1; // room extends from z=+1 behind student to z=-(D-1)

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), mat(0x8a8277, 0.9));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0, zc);
  scene.add(floor);

  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(W, D), mat(0xe9e7e2));
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.set(0, H, zc);
  scene.add(ceiling);

  // slightly taller than the room so floor/ceiling planes don't z-fight with the box faces
  const walls = new THREE.Mesh(new THREE.BoxGeometry(W, H + 0.04, D), mat(0xd8d4cc));
  walls.material.side = THREE.BackSide;
  walls.position.set(0, H / 2, zc);
  scene.add(walls);

  // Chair for the patient
  const wood = mat(0x5a4636, 0.7);
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.05, 0.48), wood);
  seat.position.set(0, seatHeight - 0.025, patientZ);
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.04), wood);
  back.position.set(0, seatHeight + 0.25, patientZ - 0.22);
  scene.add(seat, back);
  for (const [dx, dz] of [[-0.22, -0.2], [0.22, -0.2], [-0.22, 0.2], [0.22, 0.2]]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.04, seatHeight - 0.05, 0.04), wood);
    leg.position.set(dx, (seatHeight - 0.05) / 2, patientZ + dz);
    scene.add(leg);
  }

  // Small side table with a plant-ish block, so the room has some depth cues
  const table = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.5, 0.4), mat(0x9b8b78));
  table.position.set(1.4, 0.25, patientZ - 0.6);
  scene.add(table);
}
