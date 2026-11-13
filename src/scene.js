import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ROOM, LIGHTING, PATIENT } from './config.js';
import { buildRoom } from './room.js';

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
  // Khronos PBR Neutral keeps skin and fabric colours close to their textures (ACES shifts skin
  // towards orange and crushes the highlights on a pale face).
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = LIGHTING.exposure;
  renderer.xr.enabled = true;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.xr.setReferenceSpaceType('local');
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x20242a);

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = LIGHTING.environment;

  const camera = new THREE.PerspectiveCamera(50, container.clientWidth / container.clientHeight, 0.05, 50);
  const rig = new THREE.Group();
  rig.add(camera);
  scene.add(rig);

  const patientZ = -ROOM.patientDistance;
  const patientAnchor = new THREE.Group();
  patientAnchor.position.set(0, 0, patientZ);
  scene.add(patientAnchor);

  const { window: win, fitToPatient } = buildRoom(scene, renderer, patientZ, { seat: PATIENT.seat });

  // Lights. Key = daylight through the window on the right wall, front-right of the patient's face
  // (the only shadow caster). Ceiling panel = warm top light. Rim from behind separates hair from the
  // wall. Hemisphere + environment map do the soft bounce.
  const L = LIGHTING;
  const key = new THREE.DirectionalLight(0xfff6ee, L.key);
  key.position.set(ROOM.width / 2 + 0.6, win.y + 0.9, win.z + 0.5);
  key.target.position.set(0, 1.0, patientZ);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -1.4, right: 1.4, top: 1.6, bottom: -1.2, near: 0.5, far: 8 });
  key.shadow.bias = -0.0003;
  key.shadow.normalBias = 0.02;
  key.shadow.radius = 5;
  const ceiling = new THREE.PointLight(0xffe6c8, L.ceiling, 0, 2);
  ceiling.position.set(0, ROOM.height - 0.15, patientZ + 0.4);
  const rim = new THREE.DirectionalLight(0xfff2e2, L.rim);
  rim.position.set(-1.0, 2.4, patientZ - 2.2);
  rim.target.position.set(0, 1.2, patientZ);
  scene.add(key, key.target, ceiling, rim, rim.target);
  scene.add(new THREE.HemisphereLight(0xf2f0ec, 0x7a6550, L.hemisphere));

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

  return { THREE, renderer, scene, camera, rig, controls, patientAnchor, patientZ, fitToPatient };
}
