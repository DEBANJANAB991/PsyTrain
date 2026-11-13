import { createScene } from './scene.js';
import { createPatient } from './patient.js';
import { Affect } from './affect.js';
import { BodyLanguage } from './bodylang.js';
import { Gaze } from './gaze.js';
import { createDebugPanel } from './debug.js';
import * as THREE from 'three';
import * as cfg from './config.js';

const status = document.getElementById('status');
const app = document.getElementById('app');
const { renderer, scene, camera, patientAnchor, controls } = createScene(app);

let head = null, affect = null, body = null, gaze = null;

(async () => {
  try {
    head = await createPatient({
      scene, camera, anchor: patientAnchor,
      onProgress: (e) => { if (e?.lengthComputable) status.textContent = `Loading patient… ${Math.round((e.loaded / e.total) * 100)}%`; }
    });
    affect = new Affect(head);
    body = new BodyLanguage(head, affect);
    // the student = the camera (desktop) or the headset (XR): she looks at where you really are
    gaze = new Gaze(head, affect, (v) => {
      const c = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
      c.updateWorldMatrix(true, false);
      c.getWorldPosition(v);
    });
    affect.gaze = gaze;
    createDebugPanel(document.getElementById('debug'), affect);
    affect.setAffect({ emotion: 'neutral', intensity: 0.7, gaze: 'student' });
    status.textContent = 'Ready';
    setTimeout(() => (status.style.display = 'none'), 1500);

    // Public handle for console tuning, tests and the later ElevenLabs bridge (track B).
    window.patient = { cfg, head, affect, body, gaze, setAffect: (a) => affect.setAffect(a), THREE, scene, camera, controls };
  } catch (err) {
    console.error(err);
    status.textContent = 'Failed to load patient: ' + err.message;
  }
})();

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = clock.getDelta() * 1000;
  if (head) { body?.update(dt); head.animate(dt); gaze?.update(dt); }
  if (!renderer.xr.isPresenting) controls.update();
  renderer.render(scene, camera);
});
