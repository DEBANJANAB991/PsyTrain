/**
 * "Where Communication Issues Started": locates, in the saved transcript, the earliest turn of each
 * communication issue that the existing assessment supports. Nothing is invented: every issue comes from
 *
 *   A. MIRROR's saved assessment: communication_evaluation.improvement_opportunities whose evidence points
 *      at specific turns. Only categories whose evidence marks *where* something happened are located:
 *        opening                     the first doctor turn (the opening itself)
 *        sensitive_topic_permission  the sensitive question(s) asked without a permission cue
 *        clear_language              the doctor turn(s) with an unexplained medical term
 *        responding_to_distress      the doctor turn(s) after an explicit distress signal
 *      Findings about something *missing across the consultation* (their evidence is every doctor question
 *      or turn, e.g. "did not match the configured cues"), and event-based findings (interruptions), have no
 *      single starting turn and are listed as "cannot be pinpointed" instead of guessing.
 *   B. the coaching analysis (coaching.js, hints.json): strategies the coaching section marks as
 *      not / partially demonstrated, located with the same episode detection (detectEpisodes) at the first
 *      student reply where the strategy was missing. Insufficient-evidence strategies are listed as such.
 *
 * Turn numbers count every saved transcript turn (both speakers) from 1. Timestamps are the saved turn timestamps.
 */
import { detectEpisodes, OUTCOME } from './coaching.js';

const LOCATABLE = {
  opening: 'The consultation opening',
  sensitive_topic_permission: 'Sensitive question without asking permission first',
  clear_language: 'Medical term without a plain-language explanation',
  responding_to_distress: 'Explicit distress not acknowledged'
};
const readable = (v) => String(v ?? '').replace(/[_-]+/g, ' ').trim();
const idOf = (ref) => String(ref).replace(/^(turn|event):/, '');

function index(turns) {
  const pos = new Map(turns.map((t, i) => [t.id, i]));
  const turn = (i) => (i >= 0 && i < turns.length ? { ...turns[i], number: i + 1 } : null);
  const prev = (i, speaker) => { for (let j = i - 1; j >= 0; j--) if (turns[j].speaker === speaker) return turn(j); return null; };
  const next = (i, speaker) => { for (let j = i + 1; j < turns.length; j++) if (turns[j].speaker === speaker) return turn(j); return null; };
  const around = (i, before = 2, after = 2) => turns.slice(Math.max(0, i - before), i + after + 1).map((t) => turn(pos.get(t.id)));
  return { pos, turn, prev, next, around };
}

// ---------------------------------------------------------------- A. MIRROR assessment findings
function assessmentIssues(assessment, turns, ix) {
  const located = [], unlocated = [];
  for (const f of assessment?.communication_evaluation?.improvement_opportunities ?? []) {
    const refs = (f.evidence_ids ?? []).map(idOf);
    const turnRefs = refs.filter((id) => ix.pos.has(id));
    const title = LOCATABLE[f.category];
    const base = { source: 'assessment', category: f.category, why: f.why_it_matters ?? null, suggestion: f.suggestion ?? null, observation: f.observation };
    if (!title || !turnRefs.length) {
      unlocated.push({ ...base, title: readable(f.category),
        reason: !turnRefs.length ? 'The assessment evidence does not point to a transcript turn.'
          : 'This finding is about something missing across the consultation, so there is no single moment where it started.' });
      continue;
    }
    const positions = turnRefs.map((id) => ix.pos.get(id)).sort((a, b) => a - b);
    let student = null, before = null;
    if (f.category === 'responding_to_distress') {
      // evidence = the distress signal(s) + the doctor turns after them; the issue starts at the first doctor turn
      // after the earliest patient distress turn that is part of the evidence
      const firstDistress = positions.find((p) => turns[p].speaker === 'patient');
      const firstDoctor = positions.find((p) => turns[p].speaker === 'doctor' && (firstDistress === undefined || p > firstDistress));
      if (firstDoctor === undefined) { unlocated.push({ ...base, title, reason: 'The distress signal is not followed by a doctor turn in the transcript.' }); continue; }
      student = ix.turn(firstDoctor);
      before = firstDistress !== undefined ? ix.turn(firstDistress) : ix.prev(firstDoctor, 'patient');
    } else {
      const firstDoctor = positions.find((p) => turns[p].speaker === 'doctor');
      if (firstDoctor === undefined) { unlocated.push({ ...base, title, reason: 'The assessment evidence does not point to one of your turns.' }); continue; }
      student = ix.turn(firstDoctor);
      before = ix.prev(firstDoctor, 'patient');
    }
    const after = ix.next(student.number - 1, 'patient');
    located.push({ ...base, title, start: student, before, after, context: ix.around(student.number - 1),
      label: `MIRROR assessment · ${readable(f.category)}`, occurrences: positions.filter((p) => turns[p].speaker === 'doctor').length });
  }
  return { located, unlocated };
}

// ---------------------------------------------------------------- B. coaching strategies (hints.json)
export const COACH_WHY = {
  'distraction-1': 'Once the conversation follows the patient’s side topic, the interview question is left unanswered and the patient sets the direction.',
  'distraction-2': 'When steering back does not hold, naming the drifting as an observation helps the patient notice the pattern without feeling criticised.',
  'distraction-3': 'When the patient keeps drifting after repeated steering, a polite, formulaic interruption and repeating the question are a legitimate correction.',
  'aggressive-1': 'Irritated comments are best met on the relationship level: validating the emotion and setting a limit, without correcting the content or provoking.',
  'aggressive-2': 'Open confrontation can turn into a power struggle; slow, firm speech and metacommunication keep the conversation workable.',
  'aggressive-3': 'Threatening language is a warning sign; distance and safety come first, and further verbal interventions tend to escalate.'
};

function coachingIssues(coaching, turns, ix) {
  const located = [], unlocated = [];
  if (!coaching || coaching.status !== 'coaching') return { located, unlocated };
  const { distraction, aggression } = detectEpisodes(turns);
  const failedRedirects = distraction.filter((e) => e.response && e.types.some((x) => x === 'narrow' || x === 'name' || x.startsWith('interrupt')) && e.held === false);

  for (const it of coaching.items) {
    const key = `${it.behaviour}-${it.level}`;
    const strategy = { name: it.strategy, shortHint: it.shortHint ?? it.strategy, sources: it.sources, outcome: it.outcome, hasLong: Boolean(it.longExplanation) };
    const base = { source: 'coaching', key, strategy, why: COACH_WHY[key] ?? null, suggestion: it.improvement ?? null, observation: it.observed,
      label: `Coaching · ${it.behaviour === 'aggressive' ? 'Aggressive behaviour' : 'Distraction'} · level ${it.level}` };
    if (it.outcome === OUTCOME.demonstrated) continue;                       // not an issue
    if (it.outcome === OUTCOME.insufficient) {
      unlocated.push({ ...base, title: it.strategy, reason: 'There is not enough transcript evidence to evaluate how you handled this.' });
      continue;
    }
    // the first student reply where the strategy was missing
    let ep = null, title = null, after = null;
    if (key === 'distraction-1') {
      ep = distraction.find((e) => e.response && e.types.includes('followed'));
      title = 'Followed the patient’s side topic instead of returning to your question';
    } else if (key === 'distraction-2') {
      ep = it.outcome === OUTCOME.partial ? distraction.find((e) => e.types?.includes('name') && e.held === false) : failedRedirects[0];
      title = it.outcome === OUTCOME.partial ? 'Named the drifting, but the patient drifted again' : 'Steering back did not hold';
      after = ep?.after ?? null;
    } else if (key === 'distraction-3') {
      ep = it.outcome === OUTCOME.partial ? distraction.find((e) => e.types?.includes('interrupt')) : failedRedirects[1] ?? distraction.find((e) => e.types?.includes('name') && e.held === false);
      title = it.outcome === OUTCOME.partial ? 'Interrupted, but did not repeat the question' : 'Drifting continued after repeated steering';
      after = it.outcome === OUTCOME.partial ? null : ep?.after ?? null;
    } else if (it.behaviour === 'aggressive') {
      const own = aggression.filter((e) => e.level === it.level && e.response && e.flags);
      const lacking = (f) => (it.level === 1 ? !(f.validate && f.limit) : it.level === 2 ? !f.meta : !f.safety);
      ep = own.find((e) => e.flags.escalate) ?? own.find((e) => lacking(e.flags));
      title = ep?.flags.escalate
        ? ({ 1: 'Answered irritation by arguing or defending yourself', 2: 'Drawn into the confrontation', 3: 'Escalated after threatening language' })[it.level]
        : ({ 1: 'Irritation not met with both validation and a limit', 2: 'Confrontation without metacommunication', 3: 'Threatening language not met with distance and safety' })[it.level];
    }
    if (!ep?.response) { unlocated.push({ ...base, title: it.strategy, reason: 'The exact turn where this started could not be determined reliably.' }); continue; }
    const i = ix.pos.get(ep.response.id);
    if (i === undefined) { unlocated.push({ ...base, title: it.strategy, reason: 'The exact turn where this started could not be determined reliably.' }); continue; }
    const student = ix.turn(i);
    const before = ix.turn(ix.pos.get(ep.patient.id));
    // how the patient responded: the patient's next saved turn after the student's reply (if any)
    const afterTurn = after && ix.pos.has(after.id) ? ix.turn(ix.pos.get(after.id)) : ix.next(i, 'patient');
    const anchor = ep.anchor && ix.pos.has(ep.anchor.id) ? ix.turn(ix.pos.get(ep.anchor.id)) : null;
    located.push({ ...base, title, start: student, before, after: afterTurn, anchor: key.startsWith('distraction') ? anchor : null,
      context: ix.around(i, 3, 2) });
  }
  return { located, unlocated };
}

// ---------------------------------------------------------------- entry point
/**
 * @param assessment  saved MIRROR ConsultationAssessment
 * @param turns       transcript turns from the same assessment (coaching.js turnsFromAssessment)
 * @param coaching    the analyseCoaching() result shown in the coaching section (keeps both sections consistent)
 * @returns {{ status: 'issues'|'none'|'insufficient', located: object[], unlocated: object[] }}
 */
export function buildIssueTimeline(assessment, turns, coaching) {
  if (!turns?.length) return { status: 'insufficient', located: [], unlocated: [] };
  const ix = index(turns);
  const a = assessmentIssues(assessment, turns, ix);
  const c = coachingIssues(coaching, turns, ix);
  const located = [...a.located, ...c.located].sort((x, y) => x.start.number - y.start.number);
  const unlocated = [...a.unlocated, ...c.unlocated];
  return { status: located.length ? 'issues' : unlocated.length ? 'insufficient' : 'none', located, unlocated };
}
