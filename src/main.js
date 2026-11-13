import { createScene } from './scene.js';
import { createPatient } from './patient.js';
import { Affect } from './affect.js';
import { BodyLanguage } from './bodylang.js';
import { Gaze } from './gaze.js';
import { Voice } from './voice.js';
import { Personality } from './personality.js';
import { createAgent, Director, LiveDirector } from './agent.js';
import { LiveConversation } from './conversation.js';
import { createDebugPanel } from './debug.js';
import { createTalkUI } from './talk-ui.js';
import { selectedCase } from './cases.js';
import * as THREE from 'three';
import * as cfg from './config.js';

const status = document.getElementById('status');
const app = document.getElementById('app');
const { renderer, scene, camera, patientAnchor, controls, fitToPatient, roomReady } = createScene(app);
// patient + behaviour chosen on the landing page (index.html), e.g. ?case=extrovert&behavior=shy
const selection = selectedCase();

let head = null, affect = null, body = null, gaze = null, voice = null, personality = null, agent = null, director = null;
let conversation = null, liveDirector = null;

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
    voice = new Voice(head, affect);
    personality = new Personality(affect);
    agent = createAgent({ affect, personality });
    director = new Director(agent);
    affect.setAffect({ emotion: 'neutral', intensity: 0.7, gaze: 'student' });
    if (selection) {
      // registered as a custom personality, so it also shows in the debug panel and to the director agent
      const name = personality.define({ name: `${selection.caseDef.key}_${selection.behaviorKey}`, ...selection.behavior.personality });
      personality.setPreset(name, { applyEmotion: true });
    }
    // live voice conversation: the ElevenLabs patient agent talks, the live director moves her body to match
    conversation = new LiveConversation(head);
    liveDirector = new LiveDirector(agent, director, { profile: selection?.behavior.profile || selection?.behavior.personality?.description || '' });
    conversation.on('student', (t) => liveDirector.addStudent(t));
    conversation.on('patient', (t) => liveDirector.addPatient(t));
    conversation.on('correction', (t) => liveDirector.correctPatient(t));
    conversation.on('interruption', () => liveDirector.noteInterruption());
    conversation.on('status', (s) => { if (s === 'connecting') liveDirector.reset(); });
    // the page is just the room and a Talk button; the full control panel is at ?debug=1
    if (new URLSearchParams(location.search).has('debug')) {
      createDebugPanel(document.getElementById('debug'), affect, voice, { personality, agent, director, conversation, liveDirector, liveFirst: Boolean(selection?.behavior.voiceAgent) });
    } else {
      createTalkUI(document.getElementById('talkbar'), { conversation, liveDirector, voice });
    }
    affect.snapToPose();
    await roomReady;
    fitToPatient(head);   // wheelchair footrests under her feet (no-op for the normal chair)
    status.textContent = 'Ready';
    setTimeout(() => (status.style.display = 'none'), 1500);

    // Public handle for console tuning, tests and the later ElevenLabs bridge (track B).
    window.patient = { cfg, head, affect, body, gaze, voice, personality, agent, director, conversation, liveDirector, say: (t, o) => voice.speak(t, o), setAffect: (a) => affect.setAffect(a), THREE, scene, camera, controls };
  } catch (err) {
    console.error(err);
    status.textContent = 'Failed to load patient: ' + err.message;
  }
})();

const timer = new THREE.Timer();
timer.connect(document);   // no huge delta after the tab was hidden
renderer.setAnimationLoop((time) => {
  timer.update(time);
  const dt = Math.min(timer.getDelta() * 1000, 100);
  if (head) { personality?.update(dt); body?.update(dt); head.animate(dt); gaze?.update(dt); }
  if (!renderer.xr.isPresenting) controls.update();
  renderer.render(scene, camera);
});
