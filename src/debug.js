import { EMOTIONS, GAZES, GESTURES, BEHAVIOR, PATIENTS, PATIENT_KEY } from './config.js';

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
export function createDebugPanel(root, affect, voice = null) {
  root.hidden = false;
  root.innerHTML = `
    <h3>Patient</h3>
    <select id="patient" style="background:#22262c;color:inherit;border:1px solid #3a3f47;border-radius:6px;padding:5px">
      ${Object.entries(PATIENTS).map(([k, p]) => `<option value="${k}"${k === PATIENT_KEY ? ' selected' : ''}>${p.label}</option>`).join('')}
    </select>
    <h3>Voice <span id="vstat" style="float:right;text-transform:none;letter-spacing:0;font-size:11px;opacity:.8"></span></h3>
    <textarea id="vtext" rows="3" style="width:100%;box-sizing:border-box;border-radius:6px;border:1px solid #3a3f47;background:#22262c;color:inherit;padding:6px;font:inherit;font-size:13px">Hello doctor. I have had this pain in my chest for about three days now, and it gets worse when I climb the stairs.</textarea>
    <div class="grid"><button id="vsay">Speak text</button><button id="vstop">Stop</button></div>
    <button id="vtalk" style="width:100%">🎤 Talk (click, speak, click again)</button>
    <label style="flex-direction:row;align-items:center;gap:6px">She says it in
      <select id="vreply" style="flex:1;background:#22262c;color:inherit;border:1px solid #3a3f47;border-radius:6px;padding:4px"><option value="her">her voice</option><option value="mine">my voice</option></select></label>
    <div id="vinfo" style="font-size:11px;opacity:.75;min-height:1.2em"></div>
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
  // a different patient = a different model / room setup: reload with ?patient=<key>
  q('#patient').onchange = (e) => {
    const url = new URL(location.href);
    url.searchParams.delete('avatar');
    url.searchParams.set('patient', e.target.value);
    location.href = url.toString();
  };
  const mk = (parent, text, attrs, onclick) => {
    const b = document.createElement('button');
    b.textContent = text; Object.assign(b.dataset, attrs); b.onclick = onclick; parent.appendChild(b); return b;
  };
  for (const e of EMOTIONS) mk(q('#emo'), e, { emotion: e }, () => affect.setAffect({ emotion: e }));
  for (const g of GAZES) mk(q('#gz'), g, { gaze: g }, () => affect.setAffect({ gaze: g }));
  for (const g of GESTURES.filter((x) => x !== 'none')) mk(q('#ge'), g, {}, () => affect.setAffect({ gesture: g }));
  for (const a of ['rest', 'clasped', 'crossed']) mk(q('#arms'), a, { arms: a }, () => affect.setAffect({ behavior: { arms: a } }));

  if (voice) {
    const vs = q('#vstat'), vi = q('#vinfo');
    voice.checkStatus().then((st) => { vs.textContent = st.configured ? 'ElevenLabs ready' : 'demo voice (no API key)'; });
    q('#vsay').onclick = async () => {
      vi.textContent = 'working…';
      try { const r = await voice.speak(q('#vtext').value); vi.textContent = r ? `${r.source} voice, ${r.seconds}s, ${r.words} words` : ''; }
      catch (e) { vi.textContent = 'error: ' + e.message; }
    };
    q('#vstop').onclick = () => { voice.stop(); vi.textContent = 'stopped'; };
    const talk = q('#vtalk');
    let tick = null;
    talk.onclick = async () => {
      try {
        if (!voice.recording) {
          voice.stop();
          await voice.startRecording();
          talk.textContent = '⏹ Stop and send';
          talk.classList.add('active');
          tick = setInterval(() => { vi.textContent = `recording… ${((performance.now() - voice.recStart) / 1000).toFixed(0)} s`; }, 250);
          return;
        }
        clearInterval(tick);
        talk.textContent = '🎤 Talk (click, speak, click again)'; talk.classList.remove('active');
        vi.textContent = 'transcribing…';
        const blob = await voice.stopRecording();
        const r = await voice.sayRecording(blob, { replyIn: q('#vreply').value });
        vi.textContent = r.text ? `you said: “${r.text}”` + (r.source !== 'none' ? ` → ${r.source}, ${r.seconds}s` : '') : 'did not catch anything, try again';
      } catch (e) {
        clearInterval(tick);
        talk.textContent = '🎤 Talk (click, speak, click again)'; talk.classList.remove('active');
        vi.textContent = 'error: ' + e.message;
      }
    };
  } else q('#vsay').parentElement.hidden = true;

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
