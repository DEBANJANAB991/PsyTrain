import * as THREE from 'three';
import { CSS3DRenderer, CSS3DObject } from 'three/addons/renderers/CSS3DRenderer.js';
import { ROOM } from './config.js';

/**
 * SKID (SCID-5) note-taking form, placed front-right of the student (see PANEL), next to the patient.
 *
 * The form is a normal HTML form positioned in the room with CSS3DRenderer. It is not a WebGL texture,
 * so typing, scrolling and checkboxes are native and cost no GPU memory or texture uploads. The CSS
 * renderer has its own one-object scene and only runs while the panel is in view. Elsewhere it is display:none.
 * Limitation: CSS3D is not drawn inside WebXR, so the form is visible on desktop only.
 *
 * Items are short paraphrases ordered like the SCID-5-CV sections, not the licensed interview text.
 * Ratings follow the SCID convention: ? = not enough information, 1 = absent, 2 = subthreshold, 3 = present.
 */

// Front-right, like a tablet on a stand: turning ~25° right shows the patient (left) and the whole form (right).
// Facing the patient, its left edge peeks in at the right of the view.
const PANEL = {
  px: [560, 640],                   // form size in CSS pixels (styled in consult.html, #skid)
  width: 0.42,                      // m, on the room's scale
  yaw: 40 * Math.PI / 180,          // direction from the student's eyes, right of straight ahead (towards the patient)
  distance: 0.72,                   // m from the eyes
  drop: 0.1                         // m below eye level; the form is tilted so it faces the eyes
};

// Framing on desktop: the view starts turned right just enough that the patient (left) and the whole form (right)
// fit side by side. If the window is too narrow for both, the patient stays fully in view.
const PATIENT_HALF_WIDTH = 0.34;    // m, half the width of the seated patient with her arms and chair
const FRAME_MARGIN = 3 * Math.PI / 180;

const RATINGS = [['?', 'Not enough information'], ['1', 'Absent / false'], ['2', 'Subthreshold'], ['3', 'Present / threshold']];

const SECTIONS = [
  { id: 'overview', title: 'Overview', open: true, fields: [
    ['complaint', 'Reason for visit / chief complaint'],
    ['course', 'Onset and course of the current problems'],
    ['history', 'Past episodes and treatment'],
    ['context', 'Medical, medication and social context']
  ] },
  { id: 'mde', title: 'Major depressive episode', hint: '≥ 5 symptoms (incl. one of the first two), most of the day, nearly every day, ≥ 2 weeks.', items: [
    ['mood', 'Depressed mood'],
    ['interest', 'Markedly less interest or pleasure'],
    ['appetite', 'Change in appetite or weight'],
    ['sleep', 'Insomnia or hypersomnia'],
    ['psychomotor', 'Psychomotor agitation or slowing'],
    ['energy', 'Fatigue or loss of energy'],
    ['worth', 'Worthlessness or excessive guilt'],
    ['concentration', 'Poor concentration or indecisiveness'],
    ['death', 'Thoughts of death, suicidal ideation, plan or attempt'],
    ['distress', 'Clinically significant distress or impairment']
  ] },
  { id: 'mania', title: 'Manic / hypomanic episode', items: [
    ['mood', 'Elevated, expansive or irritable mood with more energy'],
    ['esteem', 'Inflated self-esteem or grandiosity'],
    ['sleep', 'Less need for sleep'],
    ['talk', 'More talkative, pressured speech'],
    ['thoughts', 'Flight of ideas or racing thoughts'],
    ['distract', 'Distractibility'],
    ['activity', 'More goal-directed activity or agitation'],
    ['risk', 'Risky activities (spending, sex, business)']
  ] },
  { id: 'psychosis', title: 'Psychotic symptoms', items: [
    ['delusions', 'Delusions'],
    ['hallucinations', 'Hallucinations'],
    ['speech', 'Disorganised speech'],
    ['behaviour', 'Grossly disorganised or catatonic behaviour'],
    ['negative', 'Negative symptoms (flat affect, avolition)']
  ] },
  { id: 'substance', title: 'Substance use (past 12 months)', items: [
    ['alcohol', 'Alcohol'],
    ['cannabis', 'Cannabis'],
    ['drugs', 'Stimulants or other drugs'],
    ['meds', 'Misuse of prescribed medication']
  ] },
  { id: 'panic', title: 'Panic disorder / agoraphobia', items: [
    ['attacks', 'Recurrent unexpected panic attacks'],
    ['worry', 'Persistent worry about attacks or avoidance because of them'],
    ['agoraphobia', 'Fear or avoidance of crowds, transport, being out alone']
  ] },
  { id: 'social', title: 'Social anxiety disorder', items: [
    ['fear', 'Marked fear of social situations where others may judge'],
    ['evaluation', 'Fears acting in a way that is negatively evaluated'],
    ['provoke', 'Situations almost always provoke fear'],
    ['avoid', 'Avoided or endured with intense fear'],
    ['proportion', 'Out of proportion to the actual threat'],
    ['duration', 'Lasts 6 months or more'],
    ['distress', 'Clinically significant distress or impairment']
  ] },
  { id: 'gad', title: 'Generalised anxiety disorder', items: [
    ['worry', 'Excessive worry about several topics, ≥ 6 months'],
    ['control', 'Worry is hard to control'],
    ['symptoms', 'Restless, tired, poor concentration, irritable, tense, poor sleep']
  ] },
  { id: 'ocd', title: 'Obsessive-compulsive disorder', items: [
    ['obsessions', 'Obsessions'],
    ['compulsions', 'Compulsions'],
    ['time', 'Time-consuming (> 1 h/day) or impairing']
  ] },
  { id: 'ptsd', title: 'Trauma / PTSD', items: [
    ['event', 'Exposure to a traumatic event'],
    ['intrusions', 'Intrusive memories, nightmares, flashbacks'],
    ['avoidance', 'Avoidance of reminders'],
    ['cognition', 'Negative changes in thoughts and mood'],
    ['arousal', 'Hyperarousal (startle, irritability, sleep)']
  ] },
  { id: 'risk', title: 'Risk', items: [
    ['ideation', 'Current suicidal thoughts'],
    ['plan', 'Plan or preparation'],
    ['attempts', 'Previous attempts'],
    ['harm', 'Self-harm'],
    ['others', 'Risk to others']
  ] },
  { id: 'summary', title: 'Summary', fields: [
    ['diagnoses', 'Provisional diagnoses'],
    ['open', 'Open questions / explore next']
  ] }
];

const rating = (name) => RATINGS.map(([v, t]) =>
  `<label title="${t}"><input type="radio" name="${name}" value="${v}"><span>${v}</span></label>`).join('');

const section = (s) => {
  const body = s.items
    ? s.items.map(([id, label]) => `<div class="item"><span>${label}</span><span class="rate">${rating(`${s.id}.${id}`)}</span></div>`).join('')
      + `<textarea name="${s.id}.notes" rows="2" placeholder="Notes"></textarea>`
    : s.fields.map(([id, label]) => `<label class="field">${label}<textarea name="${s.id}.${id}" rows="2"></textarea></label>`).join('');
  return `<details${s.open ? ' open' : ''}><summary>${s.title}${s.items ? `<span class="count" data-of="${s.items.length}"></span>` : ''}</summary>`
    + `${s.hint ? `<p class="hint">${s.hint}</p>` : ''}${body}</details>`;
};

const markup = () =>
  `<header><h2>SKID notes</h2><span class="actions"><button type="button" data-clear title="Delete all notes for this case">Clear</button>`
  + `<button type="button" data-hide title="Hide the notes (the Notes button brings them back)">Hide</button></span></header>`
  + `<div class="body"><p class="hint">? not enough information · 1 absent · 2 subthreshold · 3 present</p>`
  + SECTIONS.map(section).join('') + `</div>`;

/**
 * @param {object} o
 * @param {THREE.WebGLRenderer} o.renderer
 * @param {THREE.Camera} o.camera       the desktop camera (inside the rig)
 * @param {HTMLElement} o.container     element holding the WebGL canvas
 * @param {string} o.storageKey         localStorage key; notes autosave so a reload doesn't lose them
 * @returns {{ update(): void, form: HTMLFormElement, isOpen: boolean, open(): void, close(): void,
 *            onToggle(fn): void, fitYaw(camera): number }} call update() after renderer.render() every frame
 */
export function createSkidPanel({ renderer, camera, container, storageKey = 'psytrain.skid' }) {
  const [pw, ph] = PANEL.px;
  const css = new CSS3DRenderer();
  css.setSize(container.clientWidth, container.clientHeight);
  // the layer covers the canvas but lets drags through to the camera controls; only the form takes pointer input
  Object.assign(css.domElement.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
  container.appendChild(css.domElement);

  const form = document.createElement('form');
  form.id = 'skid';
  form.autocomplete = 'off';
  form.innerHTML = markup();
  form.addEventListener('submit', (e) => e.preventDefault());

  // The CSS world has its own camera that copies the real camera's pose, in millimetres (MM css px per metre,
  // so the form isn't scaled down to 0.001) and turned left by PANEL.yaw (TURN). In that frame the panel sits
  // straight ahead and the CSS camera is nearly unrotated while the student looks at it. Chrome draws a
  // strongly yawed camera element fine, but its hit testing fails and clicks fall through to the canvas.
  const MM = 1000;
  const TURN = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), PANEL.yaw);   // panel direction -> -z
  const cssCamera = new THREE.PerspectiveCamera();
  const obj = new CSS3DObject(form);
  form.style.userSelect = 'text';   // CSS3DObject sets 'none'; notes should be selectable
  obj.scale.setScalar(PANEL.width / pw * MM);
  obj.position.set(0, ROOM.eyeHeight - PANEL.drop, -PANEL.distance).multiplyScalar(MM);
  obj.rotation.set(-Math.atan2(PANEL.drop, PANEL.distance), 0, 0);   // faces the eyes
  const cssScene = new THREE.Scene();
  cssScene.add(obj);
  cssScene.updateMatrixWorld();

  // ---- autosave ------------------------------------------------------------------------------------
  const counts = [...form.querySelectorAll('.count')];
  const updateCounts = () => counts.forEach((c) => {
    c.textContent = `${c.closest('details').querySelectorAll('input[value="3"]:checked').length}/${c.dataset.of}`;
  });
  const save = () => {
    const data = {};
    for (const el of form.elements) {
      if (!el.name || (el.type === 'radio' && !el.checked) || el.value === '') continue;
      data[el.name] = el.value;
    }
    try { localStorage.setItem(storageKey, JSON.stringify(data)); } catch { /* private mode / quota: keep in memory only */ }
  };
  try {
    const data = JSON.parse(localStorage.getItem(storageKey) ?? '{}');
    for (const el of form.elements) {
      if (!el.name || !(el.name in data)) continue;
      if (el.type === 'radio') el.checked = el.value === data[el.name];
      else el.value = data[el.name];
    }
  } catch { /* corrupt entry: start empty */ }
  updateCounts();
  let saveTimer = 0;
  form.addEventListener('input', () => {
    updateCounts();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 400);
  });
  form.querySelector('[data-clear]').addEventListener('click', () => {
    if (!confirm('Delete all SKID notes for this case?')) return;
    form.reset();
    clearTimeout(saveTimer);
    try { localStorage.removeItem(storageKey); } catch { /* ignore */ }
    updateCounts();
  });

  // ---- rendering -----------------------------------------------------------------------------------
  // Drawn only while all four corners are in front of the camera: that skips the work when the student
  // faces the patient, and avoids the distorted CSS projection of an element that is partly behind the eye.
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]]
    .map(([x, y]) => new THREE.Vector3(x * pw / 2, y * ph / 2, 0).applyMatrix4(obj.matrixWorld));
  const v = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  const syncCamera = () => {   // camera.matrixWorld is current: renderer.render() ran first
    camera.matrixWorld.decompose(cssCamera.position, q, s);
    cssCamera.position.applyQuaternion(TURN).multiplyScalar(MM);
    cssCamera.quaternion.copy(q).premultiply(TURN);
    cssCamera.updateMatrixWorld();
    cssCamera.projectionMatrix.copy(camera.projectionMatrix);
  };
  const inView = () => corners.every((c) => v.copy(c).applyMatrix4(cssCamera.matrixWorldInverse).z < -0.05 * MM);

  let shown = false, dirty = false, isOpen = true;
  const toggled = new Set();
  const setOpen = (open) => {
    if (open === isOpen) return;
    isOpen = open; dirty = true;
    toggled.forEach((fn) => fn(open));
  };
  form.querySelector('[data-hide]').addEventListener('click', () => setOpen(false));

  window.addEventListener('resize', () => {
    css.setSize(container.clientWidth, container.clientHeight);
    dirty = true;
  });

  // The camera's damping keeps nudging it by tiny amounts long after a drag; rendering then would rewrite the
  // form's CSS transform (style recalc + compositing) every frame for sub-pixel changes.
  const last = new THREE.Matrix4();
  const moved = () => camera.matrixWorld.elements.some((e, i) => Math.abs(e - last.elements[i]) > 1e-5);

  return {
    form,
    get isOpen() { return isOpen; },
    open: () => setOpen(true),
    close: () => setOpen(false),
    /** fn(open) after the student hides or reopens the notes */
    onToggle: (fn) => toggled.add(fn),
    /** Yaw (radians, + = right) that shows the patient and the whole form side by side in `cam`'s field of view. */
    fitYaw(cam) {
      const half = Math.atan(Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2) * cam.aspect);
      const need = PANEL.yaw + Math.atan(PANEL.width / 2 / PANEL.distance) + FRAME_MARGIN - half;   // form's right edge in view
      const max = half - Math.atan(PATIENT_HALF_WIDTH / ROOM.patientDistance) - FRAME_MARGIN;        // patient's left edge in view
      return Math.max(0, Math.min(need, max));
    },
    update() {
      if (renderer.xr.isPresenting) return;   // CSS3D can't be drawn in the headset
      if (!dirty && !moved()) return;
      last.copy(camera.matrixWorld);
      syncCamera();
      const visible = isOpen && inView();
      if (!visible && !shown && !dirty) return;
      obj.visible = shown = visible;
      dirty = false;
      css.render(cssScene, cssCamera);
    }
  };
}
