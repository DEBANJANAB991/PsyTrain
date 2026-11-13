import { createScene } from './scene.js';
import { createPatient } from './patient.js';
import { Affect } from './affect.js';
import { BodyLanguage } from './bodylang.js';
import { Contacts } from './contacts.js';
import { Gaze } from './gaze.js';
import { Voice } from './voice.js';
import { Personality } from './personality.js';
import { createAgent, Director, LiveDirector } from './agent.js';
import { LiveConversation } from './conversation.js';
import { ModeWatcher } from './orchestrator-client.js';
import { createDebugPanel } from './debug.js';
import { createTalkUI } from './talk-ui.js';
import { createSkidPanel } from './skid.js';
import { selectedSession, sessionPersona, sessionPersonality, sessionProfile } from './cases.js';
import * as THREE from 'three';
import * as cfg from './config.js';

const status = document.getElementById('status');
const app = document.getElementById('app');
const { renderer, scene, camera, patientAnchor, patientZ, controls, fitToPatient, roomReady, turnTo, vr } = createScene(app);
const params = new URLSearchParams(location.search);
// session switches from the landing page: ?hints=1 shows hints on a board behind the patient (src/hints.js),
// ?debug=1 adds the control panel and the orchestrator's mode label
const HINTS_ON = params.has('hints');
const DEBUG = params.has('debug');
// SKID note form front-right of the student, next to the patient; notes are kept per case (URL without the switches)
const caseParams = new URLSearchParams(params);
caseParams.delete('hints');
caseParams.delete('debug');
const skid = createSkidPanel({ renderer, camera, container: app, storageKey: 'psytrain.skid' + (caseParams.size ? '?' + caseParams : '') });
// The notes are part of the default view: start turned right so the patient and the whole form fit side by side.
// Hiding the notes turns the view back to the patient; Notes (talk dock) brings them back.
turnTo(skid.fitYaw(camera), 0);
skid.onToggle((open) => turnTo(open ? skid.fitYaw(camera) : 0));
let lookedAround = false;
controls.addEventListener('start', () => { lookedAround = true; });
window.addEventListener('resize', () => { if (!lookedAround && skid.isOpen) turnTo(skid.fitYaw(camera), 0); });
// patient + Big Five + situation chosen on the landing page (index.html),
// e.g. ?patient=young-woman&extraversion=high&situation=distracted
const session = selectedSession();

let head = null, affect = null, body = null, gaze = null, voice = null, personality = null, agent = null, director = null;
let contacts = null;      // hands stay on top of the thighs (contacts.js)
let conversation = null, liveDirector = null, modeWatcher = null, hints = null, hintBoard = null;

(async () => {
  try {
    head = await createPatient({
      scene, camera, anchor: patientAnchor,
      onProgress: (e) => { if (e?.lengthComputable) status.textContent = `Loading patient… ${Math.round((e.loaded / e.total) * 100)}%`; }
    });
    affect = new Affect(head);
    body = new BodyLanguage(head, affect);
    contacts = new Contacts(head);
    if (new URLSearchParams(location.search).has('nocontacts')) contacts.enabled = false;
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
    if (session) {
      // registered as a custom personality, so it also shows in the debug panel and to the director agent
      const name = personality.define(sessionPersonality(session));
      personality.setPreset(name, { applyEmotion: true });
    }
    // live voice conversation: the ElevenLabs patient agent talks, the live director moves her body to match
    conversation = new LiveConversation(head, { patient: session?.patient, situation: session?.situation });
    liveDirector = new LiveDirector(agent, director, { profile: session ? sessionProfile(session) : '', situation: session?.situation });
    conversation.on('student', (t) => liveDirector.addStudent(t));
    conversation.on('patient', (t) => liveDirector.addPatient(t));
    conversation.on('correction', (t) => liveDirector.correctPatient(t));
    conversation.on('interruption', () => liveDirector.noteInterruption());
    conversation.on('status', (s) => { if (s === 'connecting') liveDirector.reset(); });
    // the orchestrator's mode (normal / distracted) sets her body before she answers
    modeWatcher = new ModeWatcher(conversation);
    conversation.on('session', () => liveDirector.setConversationMode('normal', 'conversation start'));
    modeWatcher.on('mode', ({ mode, reason }) => liveDirector.setConversationMode(mode, reason));
    // the answer's own body cue (state + gesture), decided with the words: the gesture lands with the first word
    modeWatcher.on('cue', (cue) => liveDirector.applyCue(cue));
    conversation.on('speechstart', ({ delayMs }) => liveDirector.onSpeechStart(delayMs));
    conversation.on('interruption', () => { liveDirector.pendingCue = null; });
    if (HINTS_ON) {
      // hints.trigger is the state flag ('distracted' | 'aggressive' | null); the board shows the matching hint
      const { HintTrigger, hintsFor, createHintBoard } = await import('./hints.js');
      hintBoard = createHintBoard({ scene, patientZ });
      hints = new HintTrigger({ conversation, modeWatcher });
      hints.on('change', ({ trigger }) => hintBoard.show(trigger ? hintsFor(trigger) : null));
    }
    // the page is the room, the SKID notes and the talk dock; a debug session adds the control panel
    // (its own Talk button is hidden: the dock's starts the same conversation) and the mode label in the dock
    const persona = session ? sessionPersona(session) : null;
    createTalkUI(document.getElementById('talkbar'), {
      conversation, liveDirector, voice, modeWatcher, vr, skid, showMode: DEBUG,
      who: persona ? { name: persona.name, firstName: persona.first_name || persona.name } : null
    });
    if (DEBUG) {
      createDebugPanel(document.getElementById('debug'), affect, voice, { personality, agent, director, conversation, liveDirector, modeWatcher, liveFirst: true, talkButton: false });
    }
    affect.snapToPose();
    await roomReady;
    fitToPatient(head);   // wheelchair footrests under her feet (no-op for the normal chair)
    status.textContent = 'Ready';
    setTimeout(() => (status.style.display = 'none'), 1500);

    // Public handle for console tuning, tests and the later ElevenLabs bridge (track B).
    window.patient = { cfg, head, affect, body, contacts, gaze, voice, personality, agent, director, conversation, liveDirector, modeWatcher, hints, hintBoard, say: (t, o) => voice.speak(t, o), setAffect: (a) => affect.setAffect(a), THREE, scene, camera, controls };
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
  if (head) { personality?.update(dt); body?.update(dt); head.animate(dt); gaze?.update(dt); contacts?.update(dt); }
  hintBoard?.update(dt);
  if (!renderer.xr.isPresenting) controls.update();
  renderer.render(scene, camera);
  skid.update();
});
