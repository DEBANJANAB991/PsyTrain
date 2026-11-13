import { EMOTIONS, GAZES } from './config.js';

/** Debug panel: 4 emotion buttons + intensity slider + gaze + nod. All call affect.setAffect(). */
export function createDebugPanel(root, affect) {
  root.hidden = false;
  root.innerHTML = `
    <h3>Patient affect</h3>
    <div id="emo" style="display:flex;flex-direction:column;gap:6px"></div>
    <label>Intensity <span id="ival"></span><input id="intensity" type="range" min="0" max="1" step="0.05"></label>
    <h3>Gaze</h3>
    <div class="row" id="gz"></div>
    <h3>Gesture</h3>
    <div class="row"><button id="nod">Nod</button></div>`;
  const emo = root.querySelector('#emo');
  const gz = root.querySelector('#gz');
  const slider = root.querySelector('#intensity');
  const ival = root.querySelector('#ival');

  for (const e of EMOTIONS) {
    const b = document.createElement('button');
    b.textContent = e[0].toUpperCase() + e.slice(1);
    b.dataset.emotion = e;
    b.onclick = () => affect.setAffect({ emotion: e });
    emo.appendChild(b);
  }
  for (const g of GAZES) {
    const b = document.createElement('button');
    b.textContent = g;
    b.dataset.gaze = g;
    b.onclick = () => affect.setAffect({ gaze: g });
    gz.appendChild(b);
  }
  slider.oninput = () => affect.setAffect({ intensity: parseFloat(slider.value) });
  root.querySelector('#nod').onclick = () => affect.setAffect({ gesture: 'nod' });

  const refresh = (s) => {
    root.querySelectorAll('[data-emotion]').forEach((b) => b.classList.toggle('active', b.dataset.emotion === s.emotion));
    root.querySelectorAll('[data-gaze]').forEach((b) => b.classList.toggle('active', b.dataset.gaze === s.gaze));
    slider.value = s.intensity;
    ival.textContent = s.intensity.toFixed(2);
  };
  affect.onChange(refresh);
  refresh(affect.state);
}
