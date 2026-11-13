import { EMOTIONS, GAZES, GESTURES, BEHAVIOR } from './config.js';

const SLIDERS = [
  ['fidget', 'Fidgeting (hands)', 0, 1, 0.05],
  ['footTap', 'Foot tapping', 0, 1, 0.05],
  ['legBounce', 'Knee bouncing', 0, 1, 0.05],
  ['shift', 'Posture shifts', 0, 1, 0.05],
  ['lookAround', 'Looking around', 0, 1, 0.05],
  ['gazeStudent', 'Eye contact', 0, 1, 0.05],
  ['blink', 'Blink rate', 0.2, 3, 0.1],
  ['breath', 'Breathing rate', 0.5, 2.5, 0.05],
  ['headMotion', 'Head movement', 0, 1, 0.05]
];

/** Debug panel: emotion buttons, intensity, gaze, gestures and body-language sliders. */
export function createDebugPanel(root, affect) {
  root.hidden = false;
  root.innerHTML = `
    <h3>Emotion</h3>
    <div class="grid" id="emo"></div>
    <label>Intensity <span id="ival"></span><input id="intensity" type="range" min="0" max="1" step="0.05"></label>
    <h3>Gaze</h3>
    <div class="grid" id="gz"></div>
    <h3>Gesture</h3>
    <div class="grid" id="ge"></div>
    <h3>Arms</h3>
    <div class="grid" id="arms"></div>
    <h3>Body language <button id="reset" style="float:right;padding:2px 8px;font-size:11px">reset</button></h3>
    <div id="sl" style="display:flex;flex-direction:column;gap:6px"></div>`;
  const q = (s) => root.querySelector(s);
  const mk = (parent, text, attrs, onclick) => {
    const b = document.createElement('button');
    b.textContent = text; Object.assign(b.dataset, attrs); b.onclick = onclick; parent.appendChild(b); return b;
  };
  for (const e of EMOTIONS) mk(q('#emo'), e, { emotion: e }, () => affect.setAffect({ emotion: e }));
  for (const g of GAZES) mk(q('#gz'), g, { gaze: g }, () => affect.setAffect({ gaze: g }));
  for (const g of GESTURES.filter((x) => x !== 'none')) mk(q('#ge'), g, {}, () => affect.setAffect({ gesture: g }));
  for (const a of ['rest', 'clasped', 'crossed']) mk(q('#arms'), a, { arms: a }, () => affect.setAffect({ behavior: { arms: a } }));

  const slider = q('#intensity'), ival = q('#ival');
  slider.oninput = () => affect.setAffect({ intensity: parseFloat(slider.value) });
  q('#reset').onclick = () => affect.setAffect({ behavior: null });

  const sliders = {};
  for (const [key, label, min, max, step] of SLIDERS) {
    const l = document.createElement('label');
    l.innerHTML = `${label} <span></span><input type="range" min="${min}" max="${max}" step="${step}">`;
    const inp = l.querySelector('input');
    inp.oninput = () => affect.setAffect({ behavior: { [key]: parseFloat(inp.value) } });
    q('#sl').appendChild(l);
    sliders[key] = { inp, span: l.querySelector('span') };
  }

  const refresh = (s, beh) => {
    root.querySelectorAll('[data-emotion]').forEach((b) => b.classList.toggle('active', b.dataset.emotion === s.emotion));
    root.querySelectorAll('[data-arms]').forEach((b) => b.classList.toggle('active', b.dataset.arms === beh.arms));
    slider.value = s.intensity; ival.textContent = s.intensity.toFixed(2);
    for (const [k, { inp, span }] of Object.entries(sliders)) {
      if (document.activeElement !== inp) inp.value = beh[k];
      span.textContent = (+beh[k]).toFixed(2);
    }
  };
  affect.onChange(refresh);
  refresh(affect.state, affect.getBehavior());
}
