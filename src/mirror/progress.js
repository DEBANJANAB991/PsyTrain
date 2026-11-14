/**
 * My Progress dashboard (opened from the MIRROR feedback screen). Read-only:
 *   1. the session IDs this browser completed (history.js)
 *   2. GET /api/consultations/{id} for each one (the saved record: session + assessment), GET /scenarios for names
 *   3. buildProgressModel() (progressModel.js) -> overview, skills heatmap, skill progression, history, insights
 * A saved consultation's feedback is opened from its stored assessment with the existing renderer; nothing is
 * submitted or re-assessed. All text is set through textContent.
 */
import './progress.css';
import { buildProgressModel, CELL } from './progressModel.js';
import { demoProgressRecords, DEMO_SCENARIO_NAMES, DEMO_PROGRESS_LABEL, DEMO_FEEDBACK } from './progressDemo.js';   // DEMO DATA only

const SVG = 'http://www.w3.org/2000/svg';
function h(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) n.append(c);
  return n;
}
function s(tag, attrs = {}, ...children) {
  const n = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) n.setAttribute(k, String(v));
  for (const c of children) if (c) n.append(c);
  return n;
}
const fmtDate = (iso, withTime = false) => {
  try { return new Intl.DateTimeFormat('en-GB', withTime ? { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' } : { day: 'numeric', month: 'short' }).format(new Date(iso)); }
  catch { return 'Unknown date'; }
};
const pct = (x) => `${Math.round(x * 100)}%`;
const cellText = (c) => (c.score != null ? c.score.toFixed(1) : c.state === 'insufficient' ? '–' : c.state === 'withheld' ? '·' : '');

async function pool(items, size, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]); }
  }));
  return out;
}

/** Load the saved records for this browser's sessions; 404 = no longer in MIRROR (counted, not shown). */
export async function loadProgress(api, history) {
  const ids = history.list().map((x) => x.sessionId);
  if (!ids.length) return buildProgressModel([]);
  const [scenarios, results] = await Promise.all([
    api.getScenarios().catch(() => []),
    pool(ids, 4, async (id) => {
      try { return { record: await api.getRecord(id) }; }
      catch (e) { if (e?.status === 404) return { missing: true }; throw e; }
    })
  ]);
  const scenarioNames = Object.fromEntries((scenarios ?? []).map((x) => [x.scenario_id, x.display_name]));
  const records = results.filter((r) => r.record?.assessment?.session_id && ids.includes(r.record.assessment.session_id)).map((r) => r.record);
  return buildProgressModel(records, { scenarioNames, missing: results.filter((r) => r.missing).length });
}

export function createProgressDashboard({ api, history, container, currentSessionId = () => null, onBack = null, onTryAgain = null, renderSaved }) {
  let model = null;
  let demo = false;   // true only while there is no genuine saved consultation (DEMO DATA dashboard)
  let selectedSkill = null;
  let loadToken = 0;

  function header(extra = null) {
    return h('header', { class: 'pm-head' },
      h('div', {},
        h('p', { class: 'fb-eyebrow' }, 'MIRROR · My Progress'),
        h('h1', {}, 'My Progress'),
        h('p', { class: 'pm-sub' }, demo ? DEMO_PROGRESS_LABEL : 'Your saved MIRROR assessments from consultations completed in this browser.')),
      h('div', { class: 'pm-head-actions' },
        extra,
        onBack ? h('button', { type: 'button', class: 'mirror-btn', 'data-action': 'back-to-feedback', onclick: onBack }, '← Back to feedback') : null,
        onTryAgain ? h('button', { type: 'button', class: 'mirror-btn mirror-btn-primary', 'data-action': 'try-again', onclick: onTryAgain }, 'Try again') : null));
  }

  function shell(...body) {
    container.replaceChildren(h('div', { class: 'pm', 'data-view': 'progress' }, header(), ...body));
    container.closest('.mirror-feedback')?.scrollIntoView({ behavior: 'auto', block: 'start' });
  }

  async function open() {
    const token = ++loadToken;
    shell(h('div', { class: 'pm-state', 'data-state': 'loading' }, h('span', { class: 'mirror-spinner' }), h('p', {}, 'Loading your saved assessments…')));
    try {
      const m = history.available ? await loadProgress(api, history) : buildProgressModel([]);
      if (token !== loadToken) return;
      // zero genuine saved consultations -> DEMO DATA dashboard; one or more -> always the real history
      demo = m.sessions.length === 0;
      model = demo ? buildProgressModel(demoProgressRecords(), { scenarioNames: DEMO_SCENARIO_NAMES }) : m;
      if (demo) selectedSkill = null;
      showDashboard();
    } catch (e) {
      if (token !== loadToken) return;
      shell(h('div', { class: 'pm-state', 'data-state': 'error' },
        h('p', { class: 'mirror-error', role: 'alert' }, `Your progress could not be loaded. ${e?.message ?? ''}`.trim()),
        h('p', { class: 'mirror-muted' }, 'Nothing is shown rather than an incomplete history. Your saved assessments are unchanged.'),
        h('button', { type: 'button', class: 'mirror-btn mirror-btn-primary', onclick: open }, 'Retry')));
    }
  }

  function demoBanner() {
    return h('div', { class: 'pm-demo-banner', role: 'note', 'data-demo': 'true' },
      h('span', { class: 'pm-demo-badge' }, 'DEMO DATA'),
      h('p', {}, h('strong', {}, 'Example dashboard. '), 'These five consultations are fictional and are not your history. ',
        'Complete a consultation and end the session: your real MIRROR assessments will then replace this demo.'));
  }

  // ---- dashboard -------------------------------------------------------------------------------------
  function showDashboard() {
    const m = model;
    if (!selectedSkill || !m.rows.some((r) => r.id === selectedSkill)) {
      selectedSkill = (m.overview.weakest ?? m.overview.strongest ?? m.rows.find((r) => r.trend.n > 0) ?? m.rows[0])?.id ?? null;
    }
    const chart = h('div', { class: 'pm-chart-wrap' });
    const cellInfo = h('div', { class: 'pm-cell-info', 'aria-live': 'polite' }, h('p', { class: 'mirror-muted' }, 'Select a cell to see what MIRROR recorded for that skill in that consultation.'));
    const select = (skillId) => { selectedSkill = skillId; renderChart(chart); };
    shell(
      demo ? demoBanner() : null,
      !demo && m.missing ? h('p', { class: 'fb-note' }, `${m.missing} earlier consultation${m.missing === 1 ? ' is' : 's are'} no longer available in MIRROR and ${m.missing === 1 ? 'is' : 'are'} not included.`) : null,
      overviewSection(m),
      heatmapSection(m, cellInfo, select),
      progressionSection(m, chart, select),
      insightsSection(m),
      historySection(m));
    renderChart(chart);
  }

  function metric(label, value, note, attrs = {}) {
    return h('article', { class: 'fb-metric pm-metric', ...attrs }, h('p', {}, label), h('strong', {}, value), note ? h('span', {}, note) : null);
  }

  function overviewSection(m) {
    const o = m.overview;
    const ls = o.latestScored;
    const latestValue = !o.latest ? '—'
      : o.latest.limited ? 'Not assessed'
      : ls === o.latest && ls.rubric.score != null ? pct(ls.rubric.score)
      : ls === o.latest ? `${ls.counts.demonstrated} / ${ls.counts.demonstrated + ls.counts.practise}` : 'Not scored';
    const latestNote = !o.latest ? '' : o.latest.limited ? 'too little conversation in the latest consultation'
      : ls === o.latest && ls.rubric.score != null ? `rubric score (${ls.rubric.id ?? 'MIRROR rubric'}), evidenced criteria`
      : ls === o.latest ? 'assessed skills demonstrated' : 'no communication findings saved';
    const skillNote = (r) => `${r.trend.demonstrated} of ${r.trend.n} assessed consultation${r.trend.n === 1 ? '' : 's'}${r.ties ? ` · ${r.ties} more with the same result` : ''}`;
    const t = o.trend;
    const trendValue = t.kind === 'up' ? 'Improving' : t.kind === 'down' ? 'Declining' : t.kind === 'steady' ? 'Steady' : 'Not enough data';
    const trendNote = t.kind === 'insufficient'
      ? (t.reason === 'no-common-skills' ? 'your last two assessed consultations share no assessed skill' : `${t.scoredCount} assessed consultation${t.scoredCount === 1 ? '' : 's'}; at least two are needed`)
      : `vs previous: ${t.improved} improved · ${t.declined} declined · ${t.unchanged} same${t.rubric ? ` · rubric ${pct(t.rubric.previous)} → ${pct(t.rubric.latest)}` : ''}`;
    return h('section', { class: 'pm-section', 'data-section': 'overview' },
      h('h2', {}, 'Overall progress'),
      h('div', { class: 'pm-metrics' },
        metric('Completed consultations', String(o.completed), `${o.scored} with an assessable conversation`, { 'data-metric': 'completed' }),
        metric('Latest result', latestValue, latestNote, { 'data-metric': 'latest' }),
        metric('Strongest skill', o.strongest?.name ?? 'Not yet known', o.strongest ? skillNote(o.strongest) : 'no skill demonstrated with evidence yet', { 'data-metric': 'strongest', class: 'fb-metric pm-metric pm-good' }),
        metric('Most to improve', o.weakest?.name ?? 'Not yet known', o.weakest ? skillNote(o.weakest) : 'no skill needing practice has been evidenced', { 'data-metric': 'weakest', class: 'fb-metric pm-metric pm-improve' }),
        metric('Overall trend', trendValue, trendNote, { 'data-metric': 'trend', 'data-trend': t.kind })),
      o.scored < 2 ? h('p', { class: 'pm-hint' }, o.scored === 1
        ? 'This is based on one assessed consultation. Complete more consultations to establish a trend.'
        : 'None of your saved consultations had enough conversation to assess. Hold a longer conversation next time to get scores.') : null);
  }

  function heatmapSection(m, cellInfo, select) {
    const head = h('tr', {}, h('th', { scope: 'col', class: 'pm-skill-col' }, 'Skill'),
      m.sessions.map((x) => h('th', { scope: 'col', class: x.limited ? 'pm-col-limited' : null, title: `${x.scenarioName} · ${fmtDate(x.completedAt, true)}${x.limited ? ' · not enough conversation to assess' : ''}` },
        h('span', { class: 'pm-col-num' }, `#${x.number}`), h('span', { class: 'pm-col-date' }, fmtDate(x.completedAt)),
        x.sessionId === currentSessionId() ? h('span', { class: 'pm-col-now' }, 'this one') : null)));
    let active = null;
    const body = m.rows.map((r) => h('tr', { 'data-skill': r.id },
      h('th', { scope: 'row', class: 'pm-skill-col' }, h('button', { type: 'button', class: 'pm-skill-btn', onclick: () => select(r.id), title: 'Show this skill in the progression chart' }, r.name)),
      r.points.map((p, i) => {
        const session = m.sessions[i];
        const label = `${r.name}, consultation ${p.number} (${fmtDate(p.completedAt)}): ${CELL[p.state].label}${p.score != null ? `, score ${p.score.toFixed(1)}` : ''}`;
        const btn = h('button', { type: 'button', class: `pm-cell pm-${p.state}`, 'aria-label': label, title: label, 'data-state': p.state, 'data-session-id': session.sessionId }, cellText(p));
        btn.addEventListener('click', () => {
          active?.classList.remove('pm-active');
          active = btn; btn.classList.add('pm-active');
          cellInfo.replaceChildren(cellDetail(r, p, session));
          select(r.id);
        });
        return h('td', {}, btn);
      })));
    return h('section', { class: 'pm-section pm-heatmap-section', 'data-section': 'heatmap' },
      h('h2', {}, 'Communication skills heatmap'),
      h('p', { class: 'fb-detail' }, 'Rows are MIRROR’s communication dimensions, columns your saved consultations (oldest first). MIRROR scores a skill 1.0 when it was demonstrated and 0.0 when it needed practice; a skill without enough evidence has no score and is not counted as 0.'),
      m.rows.length ? h('div', { class: 'pm-heatmap-scroll' }, h('table', { class: 'pm-heatmap' }, h('thead', {}, head), h('tbody', {}, body)))
        : h('p', { class: 'fb-empty' }, 'Your saved assessments contain no communication findings yet.'),
      h('ul', { class: 'pm-legend', 'aria-label': 'Legend' }, ['demonstrated', 'practise', 'insufficient', 'not_assessed', 'withheld'].map((k) =>
        h('li', {}, h('span', { class: `pm-swatch pm-${k}` }, cellText({ state: k, score: CELL[k].score })), CELL[k].label))),
      cellInfo);
  }

  function cellDetail(row, p, session) {
    const explain = {
      insufficient: 'MIRROR did not find enough evidence in this consultation to assess this skill. It is not counted as a low score.',
      not_assessed: 'This skill was not part of this consultation’s saved assessment.',
      withheld: 'The conversation was too short for a detailed assessment, so no scores are shown for this consultation.'
    }[p.state];
    return h('article', { class: 'fb-card pm-cell-card', 'data-skill': row.id, 'data-session-id': session.sessionId },
      h('div', { class: 'fb-card-head' },
        h('div', {}, h('span', { class: 'fb-kicker' }, `Consultation ${p.number} · ${session.scenarioName} · ${fmtDate(session.completedAt, true)}`), h('h3', {}, row.name)),
        h('span', { class: `fb-pill pm-pill-${p.state}` }, `${CELL[p.state].label}${p.score != null ? ` · ${p.score.toFixed(1)}` : ''}`)),
      p.observation ? h('p', {}, p.observation) : null,
      explain && !(p.state === 'insufficient' && p.observation) ? h('p', { class: 'fb-small' }, explain) : null,
      p.quote ? h('blockquote', { class: 'pm-quote' }, `${p.quote.speaker === 'doctor' ? 'You' : p.quote.speaker === 'patient' ? 'Patient' : 'Transcript'}: “${p.quote.text}”`) : null,
      p.state === 'practise' && p.suggestion ? h('p', { class: 'fb-small' }, h('strong', {}, 'MIRROR suggested: '), p.suggestion) : null,
      h('button', { type: 'button', class: 'mirror-link', onclick: () => openSaved(session) }, 'Open this consultation’s feedback →'));
  }

  function progressionSection(m, chart, select) {
    const sel = h('select', { class: 'mirror-control pm-select', id: 'pm-skill', 'aria-label': 'Skill' },
      m.rows.map((r) => h('option', { value: r.id, selected: r.id === selectedSkill ? true : null }, `${r.name}${r.trend.n ? ` (${r.trend.n} assessed)` : ' (not yet assessed)'}`)));
    sel.addEventListener('change', () => select(sel.value));
    chart._select = sel;   // renderChart keeps the dropdown in step when a heatmap row is chosen
    return h('section', { class: 'pm-section', 'data-section': 'progression' },
      h('div', { class: 'pm-section-head' }, h('h2', {}, 'Skill progression'), m.rows.length ? h('label', { class: 'pm-select-label' }, 'Skill ', sel) : null),
      m.rows.length ? chart : h('p', { class: 'fb-empty' }, 'No skills to show yet.'));
  }

  function renderChart(chart) {
    const m = model;
    const row = m.rows.find((r) => r.id === selectedSkill);
    if (!row) return;
    if (chart._select && chart._select.value !== row.id) chart._select.value = row.id;
    const W = 1000, H = 230, L = 140, R = 28, T = 18, B = 44;
    const n = row.points.length;
    const x = (i) => (n === 1 ? L + (W - L - R) / 2 : L + (i * (W - L - R)) / (n - 1));
    const y = (v) => T + (1 - v) * (H - T - B);
    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'pm-chart', role: 'img', 'aria-label': `${row.name} across consultations. ${row.trend.text}` });
    for (const [v, label] of [[1, 'Demonstrated · 1.0'], [0, 'Needs practice · 0.0']]) {
      svg.append(s('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), class: 'pm-grid' }));
      svg.append(s('text', { x: L - 10, y: y(v) + 4, 'text-anchor': 'end', class: 'pm-axis' }, document.createTextNode(label)));
    }
    const pts = row.points.map((p, i) => ({ ...p, i })).filter((p) => p.score != null);
    for (let k = 1; k < pts.length; k++) {
      const a = pts[k - 1], b = pts[k];
      svg.append(s('line', { x1: x(a.i), y1: y(a.score), x2: x(b.i), y2: y(b.score), class: b.i - a.i > 1 ? 'pm-line pm-line-gap' : 'pm-line' }));
    }
    row.points.forEach((p, i) => {
      svg.append(s('text', { x: x(i), y: H - 22, 'text-anchor': 'middle', class: 'pm-axis' }, document.createTextNode(`#${p.number}`)));
      svg.append(s('text', { x: x(i), y: H - 8, 'text-anchor': 'middle', class: 'pm-axis pm-axis-date' }, document.createTextNode(fmtDate(p.completedAt))));
      const title = s('title', {}, document.createTextNode(`Consultation ${p.number}, ${fmtDate(p.completedAt, true)}: ${CELL[p.state].label}${p.score != null ? ` (${p.score.toFixed(1)})` : ''}`));
      svg.append(p.score != null
        ? s('circle', { cx: x(i), cy: y(p.score), r: 6, class: `pm-dot pm-dot-${p.state}` }, title)
        : s('rect', { x: x(i) - 5, y: y(0.5) - 5, width: 10, height: 10, rx: 2, class: `pm-gap pm-gap-${p.state}` }, title));
    });
    const t = row.trend;
    const val = (p) => (p ? `${CELL[p.state].label} · ${p.score.toFixed(1)} (#${p.number})` : '—');
    chart.replaceChildren(
      h('div', { class: 'pm-chart-box' }, svg),
      h('div', { class: 'pm-chart-facts' },
        h('div', {}, h('span', {}, 'Previous'), h('strong', {}, t.previous ? val(t.previous) : 'No earlier assessed consultation')),
        h('div', {}, h('span', {}, 'Latest'), h('strong', {}, t.latest ? val(t.latest) : 'Not yet assessed')),
        h('div', { class: 'pm-chart-trend', 'data-trend': t.kind }, h('span', {}, 'Trend'), h('p', {}, t.text))),
      h('p', { class: 'mirror-muted' }, 'Grey squares are consultations without a score for this skill (insufficient evidence, not assessed, or too little conversation); a dashed line spans them.'));
  }

  function insightsSection(m) {
    const KIND = { improved: 'Improved', declined: 'Slipped', practise: 'Keep working on', strength: 'Consistent strength', gap: 'Not yet observed' };
    return h('section', { class: 'pm-section', 'data-section': 'insights' },
      h('h2', {}, 'Learning insights'),
      m.insights.length ? h('div', { class: 'pm-insights' }, m.insights.map((i) => h('article', { class: `fb-card pm-insight pm-insight-${i.kind}`, 'data-insight': i.kind },
        h('span', { class: 'fb-kicker' }, `${KIND[i.kind]} · based on ${i.basis}`),
        h('p', { class: 'pm-insight-text' }, i.text),
        i.evidence?.observation ? h('p', { class: 'fb-small' }, h('strong', {}, `Latest evidence (#${i.evidence.number}): `), i.evidence.observation) : null,
        i.evidence?.quote ? h('blockquote', { class: 'pm-quote' }, `${i.evidence.quote.speaker === 'doctor' ? 'You' : 'Patient'}: “${i.evidence.quote.text}”`) : null,
        (i.kind === 'practise' || i.kind === 'declined') && i.evidence?.suggestion ? h('p', { class: 'fb-small' }, h('strong', {}, 'MIRROR suggested: '), i.evidence.suggestion) : null)))
        : h('p', { class: 'fb-empty' }, m.overview.scored < 2
          ? 'Insights compare your assessed consultations, so they appear after at least two consultations with enough conversation to assess.'
          : 'No pattern stands out yet across your assessed consultations.'));
  }

  function historySection(m) {
    const status = (x) => (x.limited ? ['insufficient_evidence', 'Insufficient evidence'] : x.scored ? ['positive', 'Assessed'] : ['not_assessable', 'Not scored']);
    const result = (x) => (x.limited || !x.scored ? '—'
      : x.rubric.score != null ? `${pct(x.rubric.score)} rubric · ${x.counts.demonstrated}/${x.counts.demonstrated + x.counts.practise} skills`
      : `${x.counts.demonstrated} / ${x.counts.demonstrated + x.counts.practise} skills demonstrated`);
    return h('section', { class: 'pm-section', 'data-section': 'history' },
      h('h2', {}, 'Consultation history'),
      h('div', { class: 'pm-history-scroll' }, h('table', { class: 'pm-history' },
        h('thead', {}, h('tr', {}, ['#', 'Case', 'Date', 'Status', 'Result', ''].map((c) => h('th', { scope: 'col' }, c)))),
        h('tbody', {}, [...m.sessions].reverse().map((x) => {
          const [cls, text] = status(x);
          return h('tr', { 'data-session-id': x.sessionId },
            h('td', { class: 'pm-num' }, `#${x.number}`),
            h('td', {}, x.scenarioName, x.sessionId === currentSessionId() ? h('span', { class: 'pm-col-now' }, 'this one') : null),
            h('td', {}, fmtDate(x.completedAt, true)),
            h('td', {}, h('span', { class: `fb-pill fb-${cls}` }, text), x.humanReview ? h('span', { class: 'fb-pill pm-review', title: 'MIRROR flagged this assessment for human review' }, 'review') : null),
            h('td', {}, result(x)),
            h('td', {}, h('button', { type: 'button', class: 'mirror-btn', 'data-action': 'view-feedback', onclick: () => openSaved(x) }, 'View feedback')));
        })))));
  }

  // ---- saved feedback of one consultation (stored assessment, existing renderer; no new assessment) -----
  function openSaved(session) {
    const back = h('button', { type: 'button', class: 'mirror-btn', 'data-action': 'back-to-progress', onclick: () => { showDashboard(); } }, '← Back to My Progress');
    const holder = h('div', { class: 'pm-saved', 'data-session-id': session.sessionId });
    container.replaceChildren(h('div', { class: 'pm-saved-bar' }, back,
      demo ? h('span', { class: 'pm-demo-badge' }, 'DEMO DATA') : null,
      h('span', { class: 'mirror-muted' }, `${demo ? 'Fictional feedback' : 'Saved feedback'} · consultation #${session.number} · ${session.scenarioName} · ${fmtDate(session.completedAt, true)}`)), holder);
    try { renderSaved(holder, session.assessment, () => showDashboard(), demo ? DEMO_FEEDBACK : null); }
    catch (e) { holder.replaceChildren(h('p', { class: 'mirror-error', role: 'alert' }, `This saved feedback could not be displayed. ${e?.message ?? ''}`)); }
    container.closest('.mirror-feedback')?.scrollIntoView({ behavior: 'auto', block: 'start' });
  }

  return { open };
}
