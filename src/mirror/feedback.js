/**
 * PsyTrain-native view of a MIRROR assessment. Renders only what buildFeedbackModel() returns (what MIRROR
 * saved, or the clearly labelled demo fixture) plus the optional coaching / issue results; text via textContent.
 *
 * Two views: a one-screen summary (shown first: key stats, top strengths and improvements, the first located
 * issue, one next step) and the detailed report below, opened with "See detailed feedback".
 *
 * Detailed report section order: Consultation overview · Communication performance · Patient information discovered ·
 * Moments that mattered · Personalised coaching (strategies, general tips, practise next) ·
 * Full transcript and educational references (frameworks; progress only for genuine saved attempts) · Try again.
 * With too little conversation (non-demo), scores and achievements are withheld.
 *
 * options (all optional):
 *   coaching         analyseCoaching() result (coaching.js)          issues        buildIssueTimeline() result
 *   strategyDetails  { '<behaviour>-<level>': { expected, behaviour, intervention, outcome, alternative, why } }
 *   criterionDetails { criterion_id: { level, good, recommendation } }   learningObjective  string
 *   practiceSteps    [{ skill, phrase, when, why, objective }]           progress     { note, attempts, rows }
 *   demo             { label, transcriptLabel, note }  -> marks every part as simulated
 *   onTryAgain       () => void
 */
import { buildFeedbackModel } from './feedbackModel.js';
import { COACH_WHY } from './issues.js';

function h(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') n.className = v; else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) n.append(c);
  return n;
}
const readable = (v) => String(v ?? '').replace(/[_-]+/g, ' ');
const time = (iso) => { try { return new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit', second: '2-digit' }).format(new Date(iso)); } catch { return ''; } };
const pill = (status) => h('span', { class: `fb-pill fb-${status}` }, readable(status));

function section(index, eyebrow, title, detail, ...body) {
  return h('section', { class: 'fb-section', 'data-section': eyebrow.toLowerCase().replace(/[^a-z]+/g, '-') },
    h('p', { class: 'fb-eyebrow' }, h('span', { class: 'fb-index' }, index), eyebrow),
    h('h2', {}, title), detail ? h('p', { class: 'fb-detail' }, detail) : null, ...body);
}
const demoTag = (demo, text) => (demo ? h('p', { class: 'fb-demo-tag' }, text ?? 'Simulated demo content') : null);

function evidenceList(evidence, label = 'Evidence') {
  if (!evidence?.length) return null;
  return h('details', { class: 'fb-evidence' },
    h('summary', {}, `${label} · ${evidence.length}`),
    h('ul', {}, evidence.map((e) => h('li', {},
      h('code', {}, e.id),
      e.text ? h('span', {}, ` ${e.kind === 'turn' ? (e.speaker === 'doctor' ? 'You' : e.speaker === 'patient' ? 'Patient' : 'Turn') : (e.eventType ? readable(e.eventType) : 'Event')}: “${e.text}”`) : null))));
}

const empty = (text) => h('p', { class: 'fb-empty' }, text);

function factColumn(kicker, title, items, emptyText) {
  return h('article', { class: 'fb-card' },
    h('div', { class: 'fb-card-head' }, h('div', {}, h('span', { class: 'fb-kicker' }, kicker), h('h3', {}, title)), h('span', { class: 'fb-count' }, String(items.length))),
    items.length ? items.map((f) => h('div', { class: 'fb-fact' }, h('strong', {}, f.description), h('small', {}, `${f.id} · ${f.importance} importance · ${f.category}`), evidenceList(f.evidence))) : empty(emptyText));
}

function list(items, emptyText) {
  return items.length ? h('ul', { class: 'fb-list' }, items.map((i) => h('li', {}, i.text, evidenceList(i.evidence)))) : empty(emptyText);
}

// ---- transcript download (exact saved turns: order, speakers, timestamps, wording) ----------------------
const SPEAKER = { doctor: 'Student (doctor)', patient: 'Patient' };
export function transcriptFiles(m, demo) {
  const base = demo ? 'MIRROR_Demo_Consultation_Transcript' : `MIRROR_Consultation_Transcript_${String(m.sessionId).replace(/[^A-Za-z0-9-]+/g, '_')}`;
  const head = demo ? [demo.transcriptLabel, demo.label] : ['MIRROR consultation transcript (saved assessment)'];
  const txt = [...head, `Session: ${m.sessionId}`, `Patient: ${m.patientId ?? 'not recorded'}`, `Case: ${m.scenarioId ?? 'not recorded'}`, '',
    ...m.transcriptTurns.flatMap((t) => [`Turn ${t.number} · ${SPEAKER[t.speaker] ?? t.speaker} · ${t.timestamp ?? 'no timestamp'}`, t.text, ''])].join('\n');
  const json = JSON.stringify({
    ...(demo ? { label: demo.transcriptLabel, simulated: true } : { simulated: false }),
    session_id: m.sessionId, patient_id: m.patientId, scenario_id: m.scenarioId,
    turns: m.transcriptTurns.map((t) => ({ turn_number: t.number, turn_id: t.turnId, speaker: t.speaker, timestamp: t.timestamp ?? null, text: t.text }))
  }, null, 2);
  return { txt: { name: `${base}.txt`, mime: 'text/plain;charset=utf-8', content: txt }, json: { name: `${base}.json`, mime: 'application/json;charset=utf-8', content: json } };
}
function downloadButton(file, label, action) {
  const b = h('button', { type: 'button', class: 'mirror-btn', 'data-action': action, 'data-filename': file.name }, label);
  b.addEventListener('click', () => {
    const url = URL.createObjectURL(new Blob([file.content], { type: file.mime }));
    const a = h('a', { href: url, download: file.name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  return b;
}

// ---- one-screen summary (default view); the full report is one click away ----------------------------
const SUMMARY_ITEMS = 2;   // strengths / improvements shown on the summary

function summaryView(m, options, demo, onDetails, limited = false) {
  // too little conversation: no achievements on the summary either (see renderFeedback)
  const strengths = limited ? [] : m.overall.strengths.slice(0, SUMMARY_ITEMS);
  const improvements = (m.overall.improvements.length ? m.overall.improvements
    : m.criteria.filter((c) => c.status === 'improvement').map((c) => ({ text: c.name }))).slice(0, SUMMARY_ITEMS);
  const issue = options.issues?.status === 'issues' ? options.issues.located[0] : null;
  const step = options.practiceSteps?.[0];
  const nextText = options.learningObjective ?? m.overall.nextSteps[0]?.text ?? null;
  const bullets = (items, emptyText) => (items.length
    ? h('ul', { class: 'fb-list' }, items.map((i) => h('li', {}, i.text))) : empty(emptyText));
  const stat = (label, value) => h('div', { class: 'fb-stat' }, h('strong', {}, value), h('span', {}, label));

  const details = h('button', { type: 'button', class: 'mirror-btn mirror-btn-primary', 'data-action': 'show-details' }, 'See detailed feedback');
  details.addEventListener('click', onDetails);
  const again = options.onTryAgain ? h('button', { type: 'button', class: 'mirror-btn', 'data-action': 'try-again' }, 'Try again') : null;
  again?.addEventListener('click', options.onTryAgain);

  return h('div', { class: 'fb-overview', 'data-view': 'summary' },
    demo ? h('div', { class: 'fb-demo-banner fb-demo-banner-small', role: 'note' }, demo.label) : null,
    h('header', { class: 'fb-overview-head' },
      h('div', {},
        h('p', { class: 'fb-eyebrow' }, demo ? 'MIRROR · demo assessment (simulated, not saved)' : 'MIRROR · consultation review'),
        h('h1', {}, 'Your consultation at a glance')),
      h('div', { class: 'fb-stats' },
        stat('facts found', `${m.metrics.factsDiscovered} / ${m.metrics.factsTotal}`),
        stat('duration', m.metrics.duration),
        stat('areas to practise', String(m.metrics.areasToPractise)))),
    m.humanReviewRequired ? h('p', { class: 'fb-note' }, 'Flagged for human review.') : null,
    h('p', { class: 'fb-summary fb-clamp' }, m.overall.summary),
    h('div', { class: 'fb-grid' },
      h('article', { class: 'fb-card fb-good' }, h('h3', {}, 'What went well'), bullets(strengths, limited ? 'Not enough conversation to assess this.' : 'Nothing specific was noted.')),
      h('article', { class: 'fb-card fb-improve' }, h('h3', {}, 'Work on next'), bullets(improvements, 'No improvement areas were noted.'))),
    issue ? h('article', { class: 'fb-card fb-key-moment', 'data-start-turn': issue.start.number },
      h('div', { class: 'fb-card-head' },
        h('div', {}, h('span', { class: 'fb-kicker' }, 'Key moment'), h('h3', {}, issue.title)),
        h('span', { class: 'fb-pill fb-issue-turn' }, `Turn ${issue.start.number}`)),
      h('p', { class: 'fb-clamp-2' }, `${issue.start.speaker === 'doctor' ? 'You' : 'Patient'}: “${issue.start.text}”`),
      issue.suggestion ? h('p', { class: 'fb-small fb-clamp-2' }, h('strong', {}, 'Try instead: '), issue.suggestion) : null) : null,
    nextText || step ? h('article', { class: 'fb-card fb-next-step' },
      h('span', { class: 'fb-kicker' }, 'For your next consultation'),
      nextText ? h('p', { class: 'fb-clamp-2' }, nextText) : null,
      step?.phrase ? h('blockquote', { class: 'fb-clamp-2' }, step.phrase) : null) : null,
    h('div', { class: 'fb-overview-actions' }, details, again));
}

export function renderFeedback(container, assessment, options = {}) {
  const m = buildFeedbackModel(assessment);
  const demo = options.demo ?? null;
  const details = options.criterionDetails ?? {};
  const wrap = h('div', { class: 'fb-views' });
  const root = h('div', { class: 'fb', 'data-session-id': m.sessionId, 'data-demo': demo ? 'true' : null, 'data-view': 'details', hidden: true });
  const showView = (detailed) => {
    overview.hidden = detailed;
    root.hidden = !detailed;
    container.closest('.mirror-feedback')?.scrollIntoView({ behavior: 'auto', block: 'start' });
  };
  // Too little conversation to support a detailed assessment: no scores and no achievements are presented.
  const doctorTurns = m.transcriptTurns.filter((t) => t.speaker === 'doctor').length;
  const evidenced = m.criteria.filter((c) => c.score != null && c.evidence.length);
  const limited = !demo && (doctorTurns < 2 || m.transcriptTurns.length < 4 || (m.criteria.length > 0 && evidenced.length === 0));

  const overview = summaryView(m, options, demo, () => showView(true), limited);
  const back = h('button', { type: 'button', class: 'mirror-btn', 'data-action': 'show-summary' }, '← Back to summary');
  back.addEventListener('click', () => showView(false));
  root.append(h('div', { class: 'fb-details-nav' }, back));
  let n = 0;
  const num = () => String(++n).padStart(2, '0');
  const turnNumbers = new Map(m.transcriptTurns.map((t) => [t.turnId, t.number]));

  if (demo) root.append(h('div', { class: 'fb-demo-banner', role: 'note' }, demo.label));

  root.append(h('header', { class: 'fb-hero' },
    h('p', { class: 'fb-eyebrow' }, demo ? 'MIRROR · demo assessment (not saved)' : 'MIRROR · saved assessment'),
    h('h1', {}, 'Your consultation review'),
    h('dl', { class: 'fb-meta' },
      h('dt', {}, 'Session'), h('dd', { class: 'fb-mono' }, m.sessionId),
      h('dt', {}, 'Patient'), h('dd', {}, m.patientId ?? 'Not recorded'),
      h('dt', {}, 'Case'), h('dd', {}, m.scenarioId ?? 'Not recorded'),
      h('dt', {}, 'Attempt'), h('dd', {}, m.attempt ?? 'Not recorded')),
    m.humanReviewRequired ? h('p', { class: 'fb-note' }, 'MIRROR flags this assessment for human review (for example, limited evidence or data-quality warnings).') : null));

  // 1 Consultation overview: summary, the three improvement priorities, what went well
  const priorities = m.overall.improvements.map((i) => ({ text: i.text, evidence: i.evidence }));
  if (priorities.length < 3) {
    for (const c of [...m.criteria].filter((x) => x.status === 'improvement').sort((x, y) => (x.score ?? 1) - (y.score ?? 1))) {
      if (priorities.length >= 3) break;
      priorities.push({ text: `${c.name}: ${details[c.id]?.recommendation ?? c.explanation}`, evidence: [] });
    }
  }
  root.append(section(num(), 'Consultation overview', 'Consultation Overview', null,
    demoTag(demo),
    limited ? h('p', { class: 'fb-note fb-limited', 'data-limited': 'true' }, 'There is not enough conversation in this consultation to support a detailed assessment, so scores and achievements are not shown. Hold a longer conversation to get full feedback.') : null,
    h('div', { class: 'fb-metrics' },
      metric('Duration', m.metrics.duration, m.metrics.statistics ? `${m.metrics.statistics.total_transcript_turns} turns · ${m.metrics.statistics.doctor_turns} yours` : ''),
      metric('Patient information', `${m.metrics.factsDiscovered} / ${m.metrics.factsTotal}`, 'expected facts discovered'),
      limited ? metric('Communication', 'Insufficient evidence', 'not scored')
        : metric('Communication', m.metrics.criteriaTotal ? `${m.metrics.criteriaEvidenced} / ${m.metrics.criteriaTotal}` : 'Not scored', m.metrics.criteriaTotal ? 'dimensions with evidence' : 'no rubric results'),
      metric('Areas to practise', String(m.metrics.areasToPractise), m.metrics.insufficient ? `${m.metrics.insufficient} need more evidence` : '')),
    h('p', { class: 'fb-summary' }, m.overall.summary),
    priorities.length ? h('article', { class: 'fb-card fb-priorities', 'data-priorities': 'true' },
      h('h3', {}, 'Your top improvement priorities'),
      h('ol', { class: 'fb-priority-list' }, priorities.slice(0, 3).map((i) => h('li', {}, i.text, evidenceList(i.evidence)))),
      priorities.length > 3 ? h('details', { class: 'fb-evidence' }, h('summary', {}, `More areas to improve · ${priorities.length - 3}`),
        h('ul', { class: 'fb-list' }, priorities.slice(3).map((i) => h('li', {}, i.text, evidenceList(i.evidence))))) : null) : null,
    h('div', { class: 'fb-grid' },
      !limited && m.overall.strengths.length ? h('article', { class: 'fb-card fb-good' }, h('h3', {}, 'What went well'), list(m.overall.strengths, '')) : null,
      options.learningObjective ? h('article', { class: 'fb-card', 'data-learning-objective': 'true' }, h('h3', {}, 'Learning objective for next time'), h('p', {}, options.learningObjective)) : null)));

  // 2 Communication performance (dimension cards; improvement advice collapsed to avoid repeating the priorities)
  const observations = limited ? m.observations.filter((o) => o.status !== 'positive') : m.observations;
  root.append(section(num(), 'Communication performance', 'Communication Performance',
    limited ? 'Scores are withheld because the conversation was too short to evidence these skills.' : 'Each dimension is scored on MIRROR’s 0–1 scale when the assessment includes evidence for it.',
    demoTag(demo),
    m.criteria.length ? h('div', { class: 'fb-grid fb-criteria' }, m.criteria.map((c) => {
      const d = details[c.id];
      const scored = !limited && c.score != null;
      const advice = d?.good || d?.recommendation;
      return h('article', { class: 'fb-card', 'data-dimension': c.id },
        h('div', { class: 'fb-card-head' }, h('div', {}, h('span', { class: 'fb-kicker' }, c.category), h('h3', {}, c.name)), pill(limited ? 'insufficient_evidence' : c.status)),
        scored ? h('div', { class: 'fb-score-row' },
          h('div', { class: 'fb-bar', role: 'img', 'aria-label': `Score ${Math.round(c.score * 100)}%` }, h('span', { style: `width:${Math.round(c.score * 100)}%` })),
          h('span', { class: 'fb-score' }, `${c.score.toFixed(2)}`), d?.level ? h('span', { class: 'fb-level' }, d.level) : null) : null,
        h('p', {}, c.explanation),
        advice ? h('details', { class: 'fb-evidence' }, h('summary', {}, 'Good practice & how to improve'),
          d.good ? h('p', { class: 'fb-small' }, h('strong', {}, 'Good practice: '), d.good) : null,
          d.recommendation ? h('p', { class: 'fb-small' }, h('strong', {}, 'Recommendation: '), d.recommendation) : null) : null,
        evidenceList(c.evidence));
    })) : null,
    observations.length ? h('div', { class: 'fb-grid' }, observations.map((o) => h('article', { class: 'fb-card' },
      h('div', { class: 'fb-card-head' }, h('h3', {}, o.category), pill(o.status)),
      h('p', {}, o.observation),
      o.why ? h('p', { class: 'fb-small' }, h('strong', {}, 'Why it matters: '), o.why) : null,
      o.suggestion ? h('p', { class: 'fb-small' }, h('strong', {}, 'Try: '), o.suggestion) : null,
      evidenceList(o.evidence)))) : null,
    !m.criteria.length && !observations.length ? empty('No communication findings were returned for this consultation.') : null));

  // 3 Patient information discovered
  root.append(section(num(), 'Patient information', 'Patient Information Discovered', 'Expected information, organised by what happened in this conversation.',
    demoTag(demo),
    h('div', { class: 'fb-grid fb-grid-3' },
      factColumn('Found', 'Discovered', m.information.discovered, 'No facts recorded as discovered.'),
      factColumn('Held back', 'Explored, not fully disclosed', m.information.exploredNotDisclosed, 'None.'),
      factColumn('Still to ask', 'Not explored', m.information.notExplored, 'None.'))));

  // 4 Moments that mattered
  if (options.issues) root.append(issuesSection(num(), options.issues, demo));

  // 5 Personalised coaching: strategies, general tips and next practice steps in one place
  root.append(strategySection(num(), options.coaching, options.strategyDetails ?? {}, m.contextual, demo, turnNumbers,
    practiceBlock(options.practiceSteps, m.overall.nextSteps)));

  // 6 Full transcript and educational references
  const files = transcriptFiles(m, demo);
  const fw = m.frameworks;
  root.append(section(num(), 'Transcript and references', 'Full Transcript and Educational References', null,
    demo ? h('div', { class: 'fb-demo-banner fb-demo-banner-small', role: 'note' }, demo.transcriptLabel) : null,
    m.emotions.length ? h('p', { class: 'fb-small' }, 'Simulated patient states (not real measurements): ', m.emotions.map((e) => `${e.state} (${time(e.timestamp)})`).join(' → ')) : null,
    m.transcriptTurns.length ? h('div', { class: 'fb-downloads' },
      downloadButton(files.txt, 'Download transcript (.txt)', 'download-txt'),
      downloadButton(files.json, 'Download transcript (.json)', 'download-json')) : null,
    h('details', { class: 'fb-transcript fb-collapse', 'data-block': 'transcript' },
      h('summary', {}, `Full conversation · ${m.transcriptTurns.length} turns`),
      m.timeline.length ? h('ol', { class: 'fb-timeline' }, m.timeline.map((t) => h('li', { class: `fb-moment fb-${t.kind}${t.speaker ? ' fb-' + t.speaker : ''}`, 'data-turn': t.turnNumber ?? null },
        h('div', { class: 'fb-moment-meta' },
          h('span', {}, t.kind === 'turn' ? `Turn ${t.turnNumber} · ${t.speaker === 'doctor' ? 'You' : 'Patient'}` : (t.eventType ?? 'Event')),
          h('time', {}, time(t.timestamp))),
        h('p', {}, t.text),
        t.annotations.map((a) => h('div', { class: 'fb-annotation' }, h('span', { class: 'fb-kicker' }, a.category), h('p', {}, a.explanation),
          a.suggestion ? h('p', { class: 'fb-small' }, h('strong', {}, 'Try next: '), a.suggestion) : null))))) : empty('No transcript was saved for this consultation.')),
    h('details', { class: 'fb-collapse', 'data-block': 'frameworks' },
      h('summary', {}, demo ? 'Communication frameworks · simulated educational mapping' : 'Communication frameworks'),
      fw ? h('p', { class: 'fb-detail' }, demo ? `Educational context only: a simulated mapping of this demo onto MIRROR's framework crosswalk (${fw.version}). It is not a formal framework assessment and adds no scores.`
        : `MIRROR's framework crosswalk (${fw.version}). It adds no scores; a domain without evidence is not a negative finding.`) : null,
      fw?.items.length ? fw.items.map((f) => h('div', { class: 'fb-framework' },
        h('h3', {}, f.name), h('p', { class: 'fb-small' }, `${f.version}. ${f.description}`),
        h('div', { class: 'fb-grid' }, f.domains.map((d) => h('article', { class: 'fb-card' },
          h('div', { class: 'fb-card-head' }, h('h3', {}, d.name), pill(d.status)),
          h('p', {}, d.explanation),
          d.mappings.length ? h('p', { class: 'fb-small' }, h('strong', {}, 'Mapped MIRROR criteria: '), d.mappings.map((x) => `${x.criterion} (${x.type})`).join(', ')) : null,
          d.mappings.some((x) => x.supporting.length) ? h('p', { class: 'fb-small' }, h('strong', {}, 'Supporting frameworks: '), [...new Set(d.mappings.flatMap((x) => x.supporting))].join(', ')) : null,
          evidenceList(d.evidence)))))) : empty('No framework crosswalk was returned for this consultation.')),
    // progress only with genuine saved attempts (the demo's fictional attempts are not shown)
    options.progress?.genuine && options.progress.rows?.length ? progressBlock(options.progress) : null,
    m.warnings.length ? h('details', { class: 'fb-collapse', 'data-block': 'data-quality' }, h('summary', {}, `Data quality notes · ${m.warnings.length}`),
      h('ul', { class: 'fb-list' }, m.warnings.map((w) => h('li', {}, `${w.factId} (event ${w.eventId}): ${w.message}`)))) : null));

  if (options.onTryAgain) root.append(nextStepsSection(options));
  wrap.append(overview, root);
  container.replaceChildren(wrap);
  return m;
}
// ---- Where Communication Issues Started (issues.js result, or the demo's illustrative list) -------------
const OUTCOME_SHORT = { not_demonstrated: 'not demonstrated', partially_demonstrated: 'partially demonstrated' };

function transcriptLine(t, role, highlight = false) {
  if (!t) return null;
  const who = t.speaker === 'doctor' ? 'You' : 'Patient';
  return h('div', { class: `fb-tline fb-tline-${t.speaker}${highlight ? ' fb-tline-start' : ''}`, 'data-turn': t.number },
    h('div', { class: 'fb-tline-meta' },
      h('span', {}, `Turn ${t.number} · ${who}`), role ? h('span', { class: 'fb-tline-role' }, role) : null,
      t.timestamp ? h('time', { datetime: t.timestamp }, time(t.timestamp)) : null),
    h('p', {}, `“${t.text}”`));
}

function issueCard(issue) {
  const s = issue.strategy;
  return h('article', { class: 'fb-card fb-issue', 'data-issue-source': issue.source, 'data-start-turn': issue.start.number },
    h('div', { class: 'fb-card-head' },
      h('div', {}, h('span', { class: 'fb-kicker' }, issue.label), h('h3', {}, issue.title)),
      h('span', { class: 'fb-pill fb-issue-turn' }, `Starts at turn ${issue.start.number}`)),
    issue.anchor && issue.anchor.number !== issue.start.number ? transcriptLine(issue.anchor, 'your question') : null,
    transcriptLine(issue.before, issue.before?.speaker === 'patient' ? 'patient, just before' : null),
    transcriptLine(issue.start, 'where it started', true),
    transcriptLine(issue.after, 'patient, right after'),
    issue.why ? h('p', { class: 'fb-small' }, h('strong', {}, 'Why it matters: '), issue.why) : null,
    issue.suggestion ? h('p', { class: 'fb-small' }, h('strong', {}, 'Try instead: '), issue.suggestion) : null,
    s ? h('p', { class: 'fb-small fb-issue-strategy' }, h('strong', {}, 'Coaching strategy: '), `${s.shortHint} (${OUTCOME_SHORT[s.outcome] ?? s.outcome})`,
      ' · see Personalised Coaching below.') : null,
    issue.context?.length > 1 ? h('details', { class: 'fb-evidence fb-issue-context' }, h('summary', {}, 'Show the surrounding conversation'),
      h('div', {}, issue.context.map((t) => transcriptLine(t, null, t.number === issue.start.number)))) : null);
}

function issuesSection(index, r, demo) {
  const detail = demo ? 'Illustrative examples from the simulated consultation, not real student performance. Quotes match the simulated transcript exactly.'
    : 'The earliest moment in your saved transcript where each issue supported by this assessment began. Quotes are exactly what was said.';
  const unlocated = r.unlocated?.length ? h('details', { class: 'fb-evidence fb-issue-unlocated' },
    h('summary', {}, `Could not be pinpointed in the transcript · ${r.unlocated.length}`),
    h('ul', {}, r.unlocated.map((u) => h('li', { 'data-issue-source': u.source }, h('strong', {}, u.title), ` (${u.source === 'coaching' ? 'coaching' : 'MIRROR assessment'}): ${u.reason}`)))) : null;
  if (r.status !== 'issues') {
    return section(index, 'Moments that mattered', 'Moments That Mattered', detail,
      empty(r.status === 'none' || !r.unlocated?.length
        ? 'No specific communication issue could be located in the transcript.'
        : 'No specific communication issue could be located in the transcript; the findings below do not point to a single moment, so the evidence is insufficient to show where they started.'),
      unlocated);
  }
  return section(index, 'Moments that mattered', 'Moments That Mattered', detail,
    demoTag(demo, 'Illustrative examples · simulated'),
    h('div', { class: 'fb-issues' }, r.located.map(issueCard)), unlocated);
}

// ---- Strategy Comparison & Personalised Coaching (coaching.js result + hints.json) --------------------
const OUTCOME_LABEL = {
  demonstrated: 'Demonstrated', partially_demonstrated: 'Partially demonstrated',
  not_demonstrated: 'Not demonstrated', insufficient_evidence: 'Insufficient evidence'
};
const BEHAVIOUR_LABEL = { distraction: 'Distraction', aggressive: 'Aggressive behaviour' };
// what the strategy asks the student to do (wording of the expected approach; the hint itself is shown verbatim)
const EXPECTED = {
  'distraction-1': 'Pick up one aspect of what the patient says and narrow the conversation back to your interview question.',
  'distraction-2': 'Name the drifting as an observation, ask whether it fits, and continue with short, closed questions or a pause.',
  'distraction-3': 'Interrupt politely in a formulaic way, use the patient’s name and repeat the question word for word.',
  'aggressive-1': 'Validate the emotion and set a limit in one sentence, without correcting the content.',
  'aggressive-2': 'Speak slowly and firmly, set boundaries and use metacommunication instead of a power struggle.',
  'aggressive-3': 'Keep your distance, end the conversation and put safety first, without further verbal interventions.'
};

/** hints.json text with its markdown links as real links; the wording itself is unchanged. */
function richText(text) {
  const out = []; const re = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g; let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(h('a', { href: m[2], target: '_blank', rel: 'noopener noreferrer' }, m[1]));
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Evidence in transcript order (saved turn numbers; timestamps as tie-breaker), each turn once, exact wording. */
function coachingEvidence(evidence, demo, turnNumbers = new Map()) {
  if (!evidence?.length) return null;
  const seen = new Set();
  const rows = evidence.filter((e) => (seen.has(e.turnId) ? false : seen.add(e.turnId)))
    .map((e, i) => ({ ...e, number: turnNumbers.get(e.turnId) ?? null, i }))
    .sort((a, b) => (a.number ?? Infinity) - (b.number ?? Infinity) || String(a.timestamp ?? '').localeCompare(String(b.timestamp ?? '')) || a.i - b.i);
  return h('div', { class: 'fb-coach-evidence' }, h('span', { class: 'fb-kicker' }, demo ? 'What happened (simulated transcript)' : 'What happened in your consultation'),
    h('ul', {}, rows.map((e) => h('li', { 'data-turn': e.number ?? null }, h('span', { class: 'fb-coach-role' }, `${e.number ? `Turn ${e.number} · ` : ''}${e.role}: `), `“${e.text}”`))));
}

function coachingSources(sources) {
  if (!sources?.length) return null;
  return h('details', { class: 'fb-evidence fb-sources' }, h('summary', {}, `Sources · ${sources.length}`),
    h('ul', {}, sources.map((s) => h('li', {}, h('a', { href: s.url, target: '_blank', rel: 'noopener noreferrer' }, s.label)))));
}

const labelled = (label, text, cls = 'fb-small') => (text ? h('p', { class: cls }, h('strong', {}, `${label}: `), text) : null);

function strategyCard(it, d, demo, turnNumbers) {
  const key = `${it.behaviour}-${it.level}`;
  // the analysis summary repeats the behaviour/intervention lines when both are given, so show it only otherwise
  const summary = d.behaviour && d.intervention ? null : h('p', {}, it.observed);
  return h('article', { class: `fb-card fb-coaching fb-coaching-${it.outcome}`, 'data-strategy': key },
    h('div', { class: 'fb-card-head' },
      h('div', {}, h('span', { class: 'fb-kicker' }, `${BEHAVIOUR_LABEL[it.behaviour] ?? it.behaviour} · level ${it.level}`), h('h3', {}, it.strategy)),
      h('span', { class: `fb-pill fb-o-${it.outcome}` }, `${OUTCOME_LABEL[it.outcome] ?? it.outcome}${demo ? ' (simulated)' : ''}`)),
    labelled('Expected approach', d.expected ?? EXPECTED[key]),
    labelled('Patient behaviour', d.behaviour),
    labelled('Student intervention', d.intervention),
    labelled('Observed outcome', d.outcome),
    summary,
    coachingEvidence(it.evidence, demo, turnNumbers),
    labelled('Suggested alternative', d.alternative ?? it.improvement),
    labelled('Why this approach works', d.why ?? COACH_WHY[key]),
    it.longExplanation ? h('details', { class: 'fb-evidence fb-coach-long' }, h('summary', {}, `Learning hint: ${it.strategy}`),
      h('p', {}, richText(it.longExplanation))) : h('p', { class: 'fb-coach-hint' }, h('strong', {}, 'Learning hint: '), it.strategy),
    coachingSources(it.sources));
}

function contextualBlock(cf) {
  const cfMessage = { disabled: 'Contextual coaching is disabled in this MIRROR configuration.', insufficient_evidence: 'There is not enough evidence for contextual coaching.', unavailable: 'Contextual coaching was unavailable for this consultation; the deterministic assessment is complete.' };
  return h('div', { class: 'fb-contextual' }, h('h3', {}, 'MIRROR contextual coaching'),
    cf?.status === 'generated' && cf.observations.length ? h('div', { class: 'fb-grid' }, cf.observations.map((o) => h('article', { class: 'fb-card fb-coach' },
      h('div', { class: 'fb-card-head' }, h('h3', {}, o.topic), pill(o.finding)),
      h('p', {}, o.summary),
      o.why ? h('p', { class: 'fb-small' }, h('strong', {}, 'Why it matters: '), o.why) : null,
      o.tryThis ? h('p', { class: 'fb-small' }, h('strong', {}, 'What to try: '), o.tryThis) : null,
      o.example ? h('blockquote', {}, `“${o.example}”`) : null,
      o.principles.length ? h('p', { class: 'fb-small' }, h('strong', {}, 'Principles: '), o.principles.map(readable).join(', ')) : null,
      evidenceList(o.evidence, 'Transcript evidence')))) : empty(cfMessage[cf?.status] ?? 'No contextual coaching was returned.'),
    cf?.references?.length ? h('details', { class: 'fb-evidence fb-sources' }, h('summary', {}, `Scientific sources · ${cf.references.length}`),
      h('ul', {}, cf.references.map((r) => h('li', {}, h('strong', {}, `${readable(r.principle)}: `), `${r.author}, “${r.title}”, ${r.section}. `,
        h('a', { href: r.url, target: '_blank', rel: 'noopener noreferrer' }, 'Source'))))) : null);
}

function strategySection(index, c, details, contextual, demo, turnNumbers, practice) {
  const detail = demo ? 'Simulated example of MIRROR’s personalised coaching: statuses come from MIRROR’s coaching logic applied to the simulated transcript, not from a real student consultation. Learning hints are quoted exactly from the hints for difficult patients.'
    : 'What each strategy expects, what happened in your conversation and how to improve. Only strategies the transcript supports are shown; learning hints are quoted exactly from the hints for difficult patients.';
  const strategies = !c ? null : c.status !== 'coaching'
    ? empty(`There is insufficient evidence for personalised coaching in this consultation. ${c.reason ?? ''}`.trim())
    : h('div', {},
      h('div', { class: 'fb-grid' }, c.items.map((it) => strategyCard(it, details[`${it.behaviour}-${it.level}`] ?? {}, demo, turnNumbers))),
      c.tips.length ? h('div', { class: 'fb-coach-tips' }, h('h3', { class: 'fb-subhead' }, 'General tips for this conversation'),
        c.tips.map((t) => h('article', { class: 'fb-card', 'data-tip': t.tip.short_hint },
          h('div', { class: 'fb-card-head' }, h('div', {}, h('span', { class: 'fb-kicker' }, BEHAVIOUR_LABEL[t.behaviour] ?? t.behaviour), h('h3', {}, t.tip.short_hint))),
          h('p', {}, t.reason),
          coachingEvidence(t.evidence, demo, turnNumbers),
          h('details', { class: 'fb-evidence fb-coach-long' }, h('summary', {}, 'Why and how'), h('p', {}, richText(t.tip.long_explanation)))))) : null);
  return section(index, 'Personalised coaching', 'Personalised Coaching', detail,
    demoTag(demo, 'Simulated coaching example'),
    strategies,
    practice,
    // MIRROR contextual coaching only when it was generated (adds observations, examples and sources)
    !demo && contextual?.status === 'generated' && contextual.observations.length ? contextualBlock(contextual) : null);
}

// ---- Practise next (inside Personalised Coaching) ---------------------------------------------------------
function practiceBlock(steps, nextSteps) {
  const body = steps?.length
    ? h('div', { class: 'fb-grid' }, steps.map((s) => h('article', { class: 'fb-card', 'data-practice': s.skill },
      h('h3', {}, s.skill),
      s.phrase ? h('blockquote', {}, s.phrase) : null,
      labelled('When to use it', s.when), labelled('Why it works', s.why), labelled('Practice objective', s.objective))))
    : nextSteps?.length ? list(nextSteps, '') : null;
  return body ? h('div', { class: 'fb-practice', 'data-block': 'practice' }, h('h3', { class: 'fb-subhead' }, 'Practise next'), body) : null;
}

// ---- Progress across attempts (genuine saved attempts only) ----------------------------------------------
function progressBlock(p) {
  return h('div', { class: 'fb-progress-block', 'data-block': 'progress' }, h('h3', { class: 'fb-subhead' }, 'Progress across attempts'),
    p.note ? h('p', { class: 'fb-detail' }, p.note) : null,
    h('table', { class: 'fb-progress' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Skill'), ...p.attempts.map((a) => h('th', {}, a)), h('th', {}, 'Change'))),
      h('tbody', {}, p.rows.map((r) => h('tr', { 'data-skill': r.skill },
        h('th', {}, r.skill), ...r.scores.map((s) => h('td', {}, s.toFixed(2))),
        h('td', { class: r.scores.at(-1) > r.scores[0] ? 'fb-up' : '' }, `${r.scores.at(-1) > r.scores[0] ? '+' : ''}${(r.scores.at(-1) - r.scores[0]).toFixed(2)}`))))));
}
// ---- Try Again (the only action at the bottom; Back to patient stays in the top bar) -----------------------
function nextStepsSection({ onTryAgain }) {
  const b = h('button', { type: 'button', class: 'mirror-btn mirror-btn-primary fb-next-primary', 'data-action': 'try-again' }, 'Try Again');
  b.addEventListener('click', onTryAgain);
  return h('section', { class: 'fb-section fb-next', 'data-section': 'next-steps' },
    h('h2', {}, 'Would you like to try again?'),
    h('p', { class: 'fb-detail' }, 'Ready to practise again? Return to patient selection and start a new consultation.'),
    h('div', { class: 'fb-next-actions' }, b));
}

function metric(label, value, note) {
  return h('article', { class: 'fb-metric' }, h('p', {}, label), h('strong', {}, value), note ? h('span', {}, note) : null);
}
