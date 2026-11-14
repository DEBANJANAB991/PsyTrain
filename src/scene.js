import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ROOM, LIGHTING, PATIENT, ROOM_STYLE, PHOTO_ROOM } from './config.js';
import { buildRoom } from './room.js';
import { buildPhotoRoom } from './photoroom.js';

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

  const photo = ROOM_STYLE === 'photo';
  const built = photo
    ? buildPhotoRoom(scene, renderer, patientZ, { seat: PATIENT.seat })
    : buildRoom(scene, renderer, patientZ, { seat: PATIENT.seat });
  const { fitToPatient } = built;
  const roomReady = built.ready ?? Promise.resolve();

  // Chair tint is opt-in so the source model keeps its original materials until the user chooses a
  // colour. Clone materials before editing in case the room model shares one elsewhere.
  let chairColor = null;
  const applyChairColor = () => {
    if (!chairColor || !built.chair) return;
    built.chair.traverse((o) => {
      if (!o.isMesh) return;
      if (!o.userData.psytrainChairMaterial) {
        o.material = Array.isArray(o.material) ? o.material.map((m) => m.clone()) : o.material.clone();
        o.userData.psytrainChairMaterial = true;
      }
      for (const material of [o.material].flat()) {
        if (!material.color) continue;
        material.color.set(chairColor);
        material.needsUpdate = true;
      }
    });
  };
  const setChairColor = (value) => {
    chairColor = new THREE.Color(value).getStyle();
    applyChairColor();
  };
  roomReady.then(applyChairColor).catch(() => {}); // the caller reports room-loading failures

  const L = LIGHTING;
  const key = new THREE.DirectionalLight(0xfff6ee, photo ? PHOTO_ROOM.key : L.key);
  key.target.position.set(0, 1.0, patientZ);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -1.4, right: 1.4, top: 1.6, bottom: -1.2, near: 0.5, far: 8 });
  key.shadow.bias = -0.0003;
  key.shadow.normalBias = 0.02;
  key.shadow.radius = 5;
  scene.add(key, key.target);
  if (photo) {
    // The room's HDR does most of the lighting (set in photoroom.js). The key light adds a soft, shadow-casting
    // top-front light so the face reads clearly and she casts a shadow onto the photo's floor.
    key.position.copy(built.keyFrom).add(new THREE.Vector3(0, 0, patientZ));
  } else {
    // Key = daylight through the window on the right wall, front-right of the patient's face (the only
    // shadow caster). Ceiling panel = warm top light. Rim from behind separates hair from the wall.
    // Hemisphere + environment map do the soft bounce.
    const win = built.window;
    key.position.set(ROOM.width / 2 + 0.6, win.y + 0.9, win.z + 0.5);
    const ceiling = new THREE.PointLight(0xffe6c8, L.ceiling, 0, 2);
    ceiling.position.set(0, ROOM.height - 0.15, patientZ + 0.4);
    const rim = new THREE.DirectionalLight(0xfff2e2, L.rim);
    rim.position.set(-1.0, 2.4, patientZ - 2.2);
    rim.target.position.set(0, 1.2, patientZ);
    scene.add(ceiling, rim, rim.target);
    scene.add(new THREE.HemisphereLight(0xf2f0ec, 0x7a6550, L.hemisphere));
  }

  // Desktop camera has two modes. Consultation mode turns in place from the student's chair. Inspection
  // mode is a normal orbit camera for checking seat contact and taking pictures from any angle.
  const desktopPos = new THREE.Vector3(0, ROOM.eyeHeight, 0);
  const patientCentre = new THREE.Vector3(0, 0.9, patientZ);
  const inspectionHome = new THREE.Vector3(0, 1.15, 0.35);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.screenSpacePanning = true;
  let inspectionMode = new URLSearchParams(location.search).has('orbit');

  const resetCamera = () => {
    if (inspectionMode) {
      camera.position.copy(inspectionHome);
      controls.target.copy(patientCentre);
    } else {
      camera.position.copy(desktopPos);
      // Orbiting a point 1 cm in front of the eyes turns the view in place.
      controls.target.copy(patientCentre).sub(desktopPos).setLength(0.01).add(desktopPos);
    }
    controls.update();
  };

  const configureCamera = (reset = true) => {
    controls.enableZoom = inspectionMode;
    controls.enablePan = inspectionMode;
    controls.rotateSpeed = inspectionMode ? 0.65 : -0.5;
    controls.panSpeed = 0.8;
    controls.zoomSpeed = 0.9;
    controls.minDistance = inspectionMode ? 0.25 : 0;
    controls.maxDistance = inspectionMode ? 7 : Infinity;
    controls.minPolarAngle = inspectionMode ? 0.08 : Math.PI / 2 - 1.0;
    controls.maxPolarAngle = inspectionMode ? Math.PI - 0.08 : Math.PI / 2 + 1.0;
    if (reset) resetCamera();
  };
  const setInspectionMode = (enabled) => {
    inspectionMode = Boolean(enabled);
    configureCamera(true);
    return inspectionMode;
  };
  configureCamera(true);

  renderer.xr.addEventListener('sessionstart', () => {
    controls.enabled = false;
    camera.position.set(0, 0, 0);
    camera.rotation.set(0, 0, 0);
    rig.position.set(0, ROOM.eyeHeight, 0);
  });
  renderer.xr.addEventListener('sessionend', () => {
    rig.position.set(0, 0, 0);
    controls.enabled = true;
    resetCamera();
  });

  // Seated view: turn the head to `yaw` (radians, + = right) over `ms`, keeping the current pitch. Used to frame the
  // patient and the SKID notes side by side. A drag by the student cancels a running turn.
  let turning = 0;
  controls.addEventListener('start', () => cancelAnimationFrame(turning));
  const lookYaw = (yaw) => {
    const dir = controls.target.clone().sub(camera.position);
    const pitch = Math.atan2(dir.y, Math.hypot(dir.x, dir.z));
    controls.target.copy(camera.position).add(new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)).multiplyScalar(0.01));
    controls.update();
  };
  const currentYaw = () => { const d = controls.target.clone().sub(camera.position); return Math.atan2(d.x, -d.z); };
  function turnTo(yaw, ms = 600) {
    if (inspectionMode || renderer.xr.isPresenting) return;
    cancelAnimationFrame(turning);
    const from = currentYaw(), t0 = performance.now();
    if (ms <= 0) return lookYaw(yaw);
    const step = (now) => {
      const k = Math.min(1, (now - t0) / ms), e = k * k * (3 - 2 * k);   // smoothstep
      lookYaw(from + (yaw - from) * e);
      if (k < 1) turning = requestAnimationFrame(step);
    };
    turning = requestAnimationFrame(step);
  }

  // three.js' VR button, only where immersive VR is possible (no "VR NOT SUPPORTED" on a desktop browser).
  // Not added to the page here: the talk dock (talk-ui.js) places it next to its own buttons.
  const vrButton = VRButton.createButton(renderer);
  vrButton.classList.add('vr-button');
  const vrSupported = navigator.xr?.isSessionSupported?.('immersive-vr').catch(() => false) ?? Promise.resolve(false);

  window.addEventListener('resize', () => {
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
  });

  const savePhoto = () => {
    if (renderer.xr.isPresenting) return Promise.reject(new Error('Exit VR before saving a photo.'));
    renderer.render(scene, camera);
    return new Promise((resolve, reject) => {
      renderer.domElement.toBlob((blob) => {
        if (!blob) return reject(new Error('The browser could not capture the canvas.'));
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `psytrain-patient-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        resolve();
      }, 'image/png');
    });
  };

  return {
    THREE, renderer, scene, camera, rig, controls, patientAnchor, patientZ, fitToPatient, roomReady, turnTo,
    cameraTools: {
      get enabled() { return inspectionMode; },
      setInspectionMode,
      reset: resetCamera,
      savePhoto
    },
    chairTools: { setColor: setChairColor },
    vr: { button: vrButton, supported: vrSupported }
  };
}
