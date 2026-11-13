import {
  PATIENT_OPTIONS, TRAITS, LEVELS, AVAILABLE_LEVELS, SITUATIONS,
  defaultSession, describeSession, consultUrl
} from './cases.js';

/**
 * Landing page: 1. patient, 2. Big Five personality, 3. difficult situation, then into the 3D room
 * (consult.html). Options that are not modelled yet are shown disabled. No three.js is loaded here.
 */
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SOON = 'Not modelled yet';

const state = defaultSession();

// ---- 1. patient -------------------------------------------------------------------------------------
const grid = $('#patients');
grid.innerHTML = PATIENT_OPTIONS.map((p) => `
  <button class="patient" data-key="${esc(p.key)}" ${p.enabled ? `aria-pressed="${p.key === state.patient}"` : 'disabled aria-disabled="true"'}>
    <div class="img" style="background-image:url('${esc(p.image)}')"></div>
    ${p.enabled ? '' : '<div class="badge">Coming soon</div>'}
    <div class="tick" aria-hidden="true">✓</div>
    <div class="txt"><b>${esc(p.title)}</b><span>${esc(p.who)}</span></div>
  </button>`).join('');
grid.addEventListener('click', (e) => {
  const btn = e.target.closest('.patient');
  if (!btn || btn.disabled) return;
  state.patient = btn.dataset.key;
  for (const b of grid.querySelectorAll('.patient:not(:disabled)')) b.setAttribute('aria-pressed', String(b.dataset.key === state.patient));
  update();
});

// ---- 2. Big Five --------------------------------------------------------------------------------------
$('#traits').innerHTML = `
  <thead><tr><th scope="col"><span class="sr">Trait</span></th>${LEVELS.map((l) => `<th scope="col">${esc(l.label)}</th>`).join('')}</tr></thead>
  <tbody>${TRAITS.map((t) => `<tr><th scope="row">${esc(t.label)}</th>${LEVELS.map((l) => {
    const ok = AVAILABLE_LEVELS[t.key].includes(l.key);
    return `<td><label class="dot${ok ? '' : ' off'}"${ok ? '' : ` title="${SOON}"`}>
      <input type="radio" name="${esc(t.key)}" value="${esc(l.key)}" aria-label="${esc(`${t.label}: ${l.label}`)}"${ok ? '' : ' disabled'}${state.traits[t.key] === l.key ? ' checked' : ''}>
      <span></span></label></td>`;
  }).join('')}</tr>`).join('')}</tbody>`;
$('#traits').addEventListener('change', (e) => { state.traits[e.target.name] = e.target.value; update(); });

// ---- 3. situation -------------------------------------------------------------------------------------
$('#situations').innerHTML = SITUATIONS.map((x) => `
  <label class="behavior${x.enabled ? '' : ' off'}">
    <input type="radio" name="situation" value="${esc(x.key)}"${x.enabled ? '' : ' disabled'}${state.situation === x.key ? ' checked' : ''}>
    <b>${esc(x.label)}${x.enabled ? '' : ` <em>${SOON}</em>`}</b><span>${esc(x.blurb)}</span>
  </label>`).join('');
$('#situations').addEventListener('change', (e) => { state.situation = e.target.value; update(); });

// ---- start --------------------------------------------------------------------------------------------
function update() {
  const d = describeSession(state);
  $('#summary').innerHTML = [`<b>${esc(d.name)}</b> (${esc(d.who.toLowerCase())})`, ...d.traits.map(esc), `<b>${esc(d.situation)}</b>`].join(' · ');
}

// session switches: the same session with live hints and / or the debug tools; remembered in this browser
const SWITCHES = { hints: $('#opt-hints'), debug: $('#opt-debug') };
for (const [key, box] of Object.entries(SWITCHES)) {
  box.checked = localStorage.getItem(`psytrain.option.${key}`) === '1';
  box.onchange = () => localStorage.setItem(`psytrain.option.${key}`, box.checked ? '1' : '0');
}
$('#start').onclick = () => {
  location.href = consultUrl(state) + Object.entries(SWITCHES).map(([key, box]) => (box.checked ? `&${key}=1` : '')).join('');
};
update();
