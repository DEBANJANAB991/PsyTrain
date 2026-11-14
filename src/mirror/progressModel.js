/**
 * My Progress: a read-only summary of saved MIRROR consultation records (GET /api/consultations/{id}).
 * No new assessment: every status and score comes from what MIRROR saved. Only counting and comparison are added.
 *
 * Skills (heatmap rows) are MIRROR's communication dimensions, i.e. the categories of
 * communication_evaluation.positive_observations / improvement_opportunities / insufficient_evidence. MIRROR
 * scores its rubric criteria from these same findings (communication_evaluator.py: positive = 1.0,
 * improvement = 0.0, insufficient evidence = no score), and the same 0–1 mapping is shown here.
 *
 * Data rules:
 *  - only records that loaded are counted (every saved record is a completed, assessed consultation)
 *  - a consultation with too little conversation (isLimitedAssessment) shows no scores and is left out of trends
 *  - insufficient evidence / not assessed is never a 0; it is a gap
 *  - trends need at least two sessions with evidence for the same skill; an overall comparison uses only the
 *    skills evidenced in both sessions (as MIRROR's progress_comparator.py does for rubric criteria)
 *  - rubric scores are compared only between sessions with the same rubric ID, criteria and weights
 */
import { buildFeedbackModel, isLimitedAssessment } from './feedbackModel.js';

const SKILL_NAMES = {
  opening: 'Opening the consultation',
  open_ended_questions: 'Open-ended questions',
  focused_questioning: 'Focused questioning',
  symptom_exploration: 'Symptom exploration',
  listening: 'Listening',
  summarisation: 'Summarising',
  closing: 'Closing the consultation',
  acknowledging_concerns: 'Acknowledging concerns',
  verbal_empathy: 'Verbal empathy',
  permission_seeking: 'Asking permission',
  sensitive_topic_permission: 'Permission for sensitive topics',
  clear_language: 'Clear language',
  interruptions: 'Avoiding interruptions',
  responding_to_distress: 'Responding to distress'
};
const SKILL_ORDER = Object.keys(SKILL_NAMES);
export const skillName = (id) => SKILL_NAMES[id] ?? String(id).replace(/[_-]+/g, ' ').replace(/^./, (c) => c.toUpperCase());

/** Cell states. Only 'demonstrated' and 'practise' carry a score. */
export const CELL = {
  demonstrated: { label: 'Demonstrated', score: 1 },
  practise: { label: 'Needs practice', score: 0 },
  insufficient: { label: 'Insufficient evidence', score: null },
  not_assessed: { label: 'Not assessed', score: null },
  withheld: { label: 'Not enough conversation', score: null }
};
const FROM_STATUS = { positive: 'demonstrated', improvement: 'practise', insufficient_evidence: 'insufficient' };

/** MIRROR's normalised weighted rubric score (progress_comparator._weighted_score), evidenced criteria only. */
function rubricScore(criteria) {
  const used = criteria.filter((c) => c.score != null && (c.status === 'positive' || c.status === 'improvement') && c.evidence.length);
  const weight = used.reduce((s, c) => s + c.weight, 0);
  return weight > 0 ? used.reduce((s, c) => s + c.score * c.weight, 0) / weight : null;
}

function firstQuote(evidence) {
  const e = (evidence ?? []).find((x) => x.text && x.kind === 'turn');
  return e ? { text: e.text, speaker: e.speaker ?? null } : null;
}

function sessionFrom(record, scenarioNames) {
  const a = record.assessment;
  const m = buildFeedbackModel(a);
  const evaluation = a.communication_evaluation ?? null;
  const limited = isLimitedAssessment(m);
  const skills = new Map();
  // m.observations keeps MIRROR's order (positive, improvement, insufficient), so it lines up with the raw lists;
  // the raw category is the stable skill id, the model adds the resolved evidence text
  const raw = [...(evaluation?.positive_observations ?? []), ...(evaluation?.improvement_opportunities ?? []), ...(evaluation?.insufficient_evidence ?? [])];
  for (const [i, o] of m.observations.entries()) {
    const id = String(raw[i]?.category ?? '').trim();
    const state = FROM_STATUS[o.status];
    if (!id) continue;
    if (!state || skills.has(id)) continue;
    skills.set(id, { state, observation: o.observation, why: o.why, suggestion: o.suggestion, quote: firstQuote(o.evidence), evidenceCount: o.evidence.length });
  }
  const rubric = record.session?.assessment_rubric ?? null;
  const signature = m.criteria.length
    ? `${rubric?.rubric_id ?? 'rubric'}|${m.criteria.map((c) => `${c.id}:${c.weight}`).sort().join(',')}` : null;
  const counts = { demonstrated: 0, practise: 0, insufficient: 0 };
  for (const s of skills.values()) counts[s.state] += 1;
  const scenarioId = a.scenario_id ?? record.session?.scenario_id ?? null;
  return {
    sessionId: a.session_id,
    completedAt: record.completed_at ?? record.created_at ?? null,
    scenarioId,
    scenarioName: scenarioNames?.[scenarioId] ?? scenarioId ?? 'Unknown case',
    attempt: a.attempt_number ?? null,
    humanReview: Boolean(a.human_review_required),
    assessment: a,
    limited,
    scored: Boolean(evaluation) && !limited && counts.demonstrated + counts.practise > 0,
    skills,
    counts,
    rubric: { id: rubric?.rubric_id ?? null, signature, score: limited ? null : rubricScore(m.criteria) }
  };
}

function cellFor(session, skillId) {
  if (session.limited) return { state: 'withheld', score: null };
  const s = session.skills.get(skillId);
  if (!s) return { state: 'not_assessed', score: null };
  return { ...s, score: CELL[s.state].score };
}

function trendFor(points) {
  const evidenced = points.filter((p) => p.score != null);
  const n = evidenced.length;
  const demonstrated = evidenced.filter((p) => p.score === 1).length;
  if (n === 0) return { kind: 'none', n, demonstrated, text: 'No consultation has enough evidence for this skill yet.' };
  const latest = evidenced[n - 1];
  if (n === 1) return { kind: 'single', n, demonstrated, latest, text: `Assessed in one consultation so far (${CELL[latest.state].label.toLowerCase()}). At least two assessed consultations are needed to show a trend.` };
  const previous = evidenced[n - 2];
  const first = evidenced[0];
  const base = { n, demonstrated, latest, previous };
  const tally = `Demonstrated in ${demonstrated} of ${n} assessed consultations.`;
  if (demonstrated === n) return { ...base, kind: 'consistent_strong', text: `Demonstrated in all ${n} consultations where it could be assessed.` };
  if (demonstrated === 0) return { ...base, kind: 'consistent_practise', text: `Not yet demonstrated in any of the ${n} consultations where it could be assessed.` };
  if (latest.score > previous.score) return { ...base, kind: 'improved', from: previous, text: `Improved: needed practice in consultation ${previous.number}, demonstrated in consultation ${latest.number}. ${tally}` };
  if (latest.score < previous.score) return { ...base, kind: 'declined', from: previous, text: `Demonstrated in consultation ${previous.number} but not in consultation ${latest.number}. ${tally}` };
  // same result as last time: still a change if it differs from the first assessed consultation
  if (latest.score > first.score) return { ...base, kind: 'improved', from: first, text: `Improved: needed practice in consultation ${first.number}, demonstrated in your last two assessed consultations (${previous.number} and ${latest.number}). ${tally}` };
  if (latest.score < first.score) return { ...base, kind: 'declined', from: first, text: `Demonstrated in consultation ${first.number}, but not in your last two assessed consultations (${previous.number} and ${latest.number}). ${tally}` };
  return { ...base, kind: 'unchanged', text: `Same result as the previous assessed consultation (${CELL[latest.state].label.toLowerCase()}). ${tally}` };
}

/** Compare the last two scored sessions on the skills evidenced in both (nothing else is compared). */
function overallTrend(sessions) {
  const scored = sessions.filter((s) => s.scored);
  if (scored.length < 2) return { kind: 'insufficient', scoredCount: scored.length };
  const [prev, latest] = scored.slice(-2);
  let improved = 0, declined = 0, unchanged = 0;
  for (const [id, cur] of latest.skills) {
    const old = prev.skills.get(id);
    const a = old ? CELL[old.state].score : null, b = CELL[cur.state].score;
    if (a == null || b == null) continue;
    if (b > a) improved += 1; else if (b < a) declined += 1; else unchanged += 1;
  }
  const compared = improved + declined + unchanged;
  if (!compared) return { kind: 'insufficient', scoredCount: scored.length, reason: 'no-common-skills', previous: prev, latest };
  const rubric = prev.rubric.signature && prev.rubric.signature === latest.rubric.signature && prev.rubric.score != null && latest.rubric.score != null
    ? { previous: prev.rubric.score, latest: latest.rubric.score, id: latest.rubric.id } : null;
  return { kind: improved > declined ? 'up' : declined > improved ? 'down' : 'steady', improved, declined, unchanged, compared, previous: prev, latest, rubric, scoredCount: scored.length };
}

function pickSkill(rows, better) {
  const assessed = rows.filter((r) => r.trend.n > 0);
  if (!assessed.length) return null;
  const rate = (r) => r.trend.demonstrated / r.trend.n;
  const sorted = [...assessed].sort((x, y) => better(rate(x), rate(y)) || y.trend.n - x.trend.n);
  const top = sorted[0];
  const ties = sorted.filter((r) => rate(r) === rate(top) && r.trend.n === top.trend.n).length - 1;
  return { ...top, rate: rate(top), ties };
}

function insightsFrom(rows, sessions) {
  const scoredCount = sessions.filter((s) => s.scored).length;
  if (scoredCount < 2) return [];
  const latestNote = (row) => {
    const p = [...row.points].reverse().find((x) => x.score != null);
    return p ? { number: p.number, observation: p.observation ?? null, quote: p.quote ?? null, suggestion: p.suggestion ?? null } : null;
  };
  const out = [];
  const add = (kind, row, text) => out.push({ kind, skillId: row.id, skill: row.name, text, basis: `${row.trend.n} assessed consultation${row.trend.n === 1 ? '' : 's'}`, evidence: latestNote(row) });
  for (const r of rows) if (r.trend.kind === 'improved') add('improved', r, `${r.name} has improved: demonstrated in consultation ${r.trend.latest.number} after needing practice in consultation ${r.trend.from.number}.`);
  for (const r of rows) if (r.trend.kind === 'declined') add('declined', r, `${r.name} was demonstrated in consultation ${r.trend.from.number} but not in consultation ${r.trend.latest.number}. Keep it in mind next time.`);
  for (const r of rows) if (r.trend.kind === 'consistent_practise') add('practise', r, `Continue working on ${r.name.toLowerCase()}: not yet demonstrated in ${r.trend.n} assessed consultations.`);
  for (const r of rows) if (r.trend.kind === 'consistent_strong') add('strength', r, `Consistently strong in ${r.name.toLowerCase()}: demonstrated in all ${r.trend.n} assessed consultations.`);
  const neverEvidenced = rows.filter((r) => r.trend.n === 0 && r.points.filter((p) => p.state === 'insufficient').length >= 2);
  if (neverEvidenced.length) {
    out.push({ kind: 'gap', skillId: null, skill: null, basis: `${scoredCount} assessed consultations`, evidence: null,
      text: `Not yet observed: ${neverEvidenced.map((r) => r.name.toLowerCase()).join(', ')}. MIRROR found too little evidence to assess ${neverEvidenced.length === 1 ? 'this skill' : 'these skills'} in your consultations, which is not a negative result.` });
  }
  return out;
}

/**
 * @param records        ConsultationRecord objects returned by GET /api/consultations/{id}
 * @param scenarioNames  { scenario_id: display_name } from GET /api/consultations/scenarios (optional)
 */
export function buildProgressModel(records, { scenarioNames = {}, missing = 0 } = {}) {
  const sessions = records
    .filter((r) => r?.assessment?.session_id && r.assessment.overall_feedback)
    .map((r) => sessionFrom(r, scenarioNames))
    .sort((x, y) => String(x.completedAt ?? '').localeCompare(String(y.completedAt ?? '')));
  sessions.forEach((s, i) => { s.number = i + 1; });

  const ids = new Set();
  for (const s of sessions) for (const id of s.skills.keys()) ids.add(id);
  const order = (id) => { const i = SKILL_ORDER.indexOf(id); return i < 0 ? SKILL_ORDER.length : i; };
  const rows = [...ids].sort((a, b) => order(a) - order(b) || a.localeCompare(b)).map((id) => {
    const points = sessions.map((s) => ({ number: s.number, sessionId: s.sessionId, completedAt: s.completedAt, ...cellFor(s, id) }));
    return { id, name: skillName(id), points, trend: trendFor(points) };
  });

  const scored = sessions.filter((s) => s.scored);
  const latest = sessions.at(-1) ?? null;
  const latestScored = scored.at(-1) ?? null;
  const strongest = pickSkill(rows, (a, b) => b - a);
  const weakest = pickSkill(rows, (a, b) => a - b);
  return {
    sessions,
    rows,
    missing,
    overview: {
      completed: sessions.length,
      scored: scored.length,
      latest,
      latestScored,
      strongest: strongest && strongest.rate > 0 ? strongest : null,
      weakest: weakest && weakest.rate < 1 && weakest.id !== strongest?.id ? weakest : null,
      trend: overallTrend(sessions)
    },
    insights: insightsFrom(rows, sessions)
  };
}
