import { CASES, consultUrl } from './cases.js';

/**
 * Landing page: pick a patient (CASES in cases.js; disabled ones show as "coming soon"), pick a behaviour,
 * then go to the 3D room (consult.html). No three.js is loaded here.
 */
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const PERSON = '<svg viewBox="0 0 64 80" aria-hidden="true"><circle cx="32" cy="22" r="14" fill="#6b6f74"/><path d="M6 78c0-17 11.6-28 26-28s26 11 26 28z" fill="#6b6f74"/></svg>';

const state = { caseKey: null, behaviorKey: null };

// ---- patients ---------------------------------------------------------------------------------------
const grid = $('#patients');
grid.innerHTML = CASES.map((c) => `
  <button class="patient" data-key="${esc(c.key)}" ${c.enabled ? 'aria-pressed="false"' : 'disabled aria-disabled="true"'}>
    <div class="img" ${c.image ? `style="background-image:url('${esc(c.image)}')"` : ''}>${c.image ? '' : PERSON}</div>
    ${c.enabled ? '' : '<div class="badge">Coming soon</div>'}
    <div class="tick" aria-hidden="true">✓</div>
    <div class="txt"><b>${esc(c.title)}</b><span>${esc(c.who)}</span></div>
  </button>`).join('');
grid.addEventListener('click', (e) => {
  const btn = e.target.closest('.patient');
  if (!btn || btn.disabled) return;
  selectCase(btn.dataset.key);
});

function selectCase(key) {
  if (state.caseKey !== key) state.behaviorKey = null;
  state.caseKey = key;
  for (const b of grid.querySelectorAll('.patient:not(:disabled)')) b.setAttribute('aria-pressed', String(b.dataset.key === key));
  renderBehaviors();
  update();
  // the behaviour choices sit below the patient grid: bring them into view
  const smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches;
  $('#behaviors').scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'center' });
}

// ---- behaviours -------------------------------------------------------------------------------------
function renderBehaviors() {
  const c = CASES.find((x) => x.key === state.caseKey);
  const box = $('#behaviors');
  if (!c) {
    $('#bfor').textContent = '';
    $('#about').hidden = true;
    box.innerHTML = '<p class="hint">Select a patient first.</p>';
    return;
  }
  $('#bfor').textContent = `for the ${c.title.toLowerCase()}`;
  $('#about').hidden = !c.blurb;
  $('#about').textContent = c.blurb || '';
  box.innerHTML = `<div class="behaviors" role="radiogroup" aria-label="Behaviour">${Object.entries(c.behaviors).map(([k, b]) => `
    <label class="behavior">
      <input type="radio" name="behavior" value="${esc(k)}" ${state.behaviorKey === k ? 'checked' : ''}>
      <b>${esc(b.label)}</b><span>${esc(b.blurb)}</span>
    </label>`).join('')}</div>`;
  box.querySelectorAll('input').forEach((i) => (i.onchange = () => { state.behaviorKey = i.value; update(); }));
}

// ---- start --------------------------------------------------------------------------------------------
function update() {
  const c = CASES.find((x) => x.key === state.caseKey);
  const b = c?.behaviors?.[state.behaviorKey];
  $('#start').disabled = !b;
  $('#summary').innerHTML = !c ? 'Select a patient and a behaviour.'
    : !b ? `<b>${esc(c.title)}</b>: now choose a behaviour.`
    : `<b>${esc(c.title)}</b> · ${esc(c.who)} · <b>${esc(b.label)}</b>`;
}

$('#start').onclick = () => {
  const c = CASES.find((x) => x.key === state.caseKey);
  if (c?.behaviors?.[state.behaviorKey]) location.href = consultUrl(c, state.behaviorKey);
};

renderBehaviors();
update();
