/**
 * DEMO DATA for My Progress: five fictional consultations, shown only while this browser has no genuine
 * saved MIRROR consultation (progress.js). Never saved to localStorage or SQLite and never mixed with real history.
 *
 * The records have the same shape as GET /api/consultations/{id}, so the normal dashboard (buildProgressModel)
 * renders them. Every value below is invented for illustration; none comes from a real student.
 */
import { skillName } from './progressModel.js';

export const DEMO_PROGRESS_LABEL = 'DEMO DATA: five fictional consultations, not your real history';
export const DEMO_FEEDBACK = {
  label: 'DEMO DATA: simulated feedback from a fictional consultation, not a real student assessment',
  transcriptLabel: 'SIMULATED CONSULTATION TRANSCRIPT · DEMO DATA ONLY'
};
export const DEMO_SCENARIO_NAMES = {
  'demo-distracted': 'Distracted patient (demo)',
  'demo-defensive': 'Private history discussion (demo)',
  'demo-anxious': 'Anxious patient with chest discomfort (demo)'
};

const P = 'positive', I = 'improvement', N = 'insufficient_evidence';
// skill results per fictional consultation (oldest first): a plausible learning curve with setbacks and gaps
const STORY = {
  opening:                    [P, P, P, P, P],
  open_ended_questions:       [I, I, P, P, P],
  focused_questioning:        [P, P, P, P, I],
  listening:                  [N, P, P, P, P],
  summarisation:              [N, N, I, I, P],
  closing:                    [I, N, I, I, I],
  acknowledging_concerns:     [N, I, I, P, P],
  verbal_empathy:             [I, I, N, P, P],
  permission_seeking:         [N, N, I, I, I],
  sensitive_topic_permission: [N, N, N, N, N],
  responding_to_distress:     [N, I, P, I, P],
  clear_language:             [P, P, P, P, P]
};
const SESSIONS = [
  { id: 'demo-0001', scenario: 'demo-distracted', at: '2026-10-05T09:30:00Z', minutes: 7 },
  { id: 'demo-0002', scenario: 'demo-defensive', at: '2026-10-12T14:10:00Z', minutes: 9 },
  { id: 'demo-0003', scenario: 'demo-anxious', at: '2026-10-19T10:45:00Z', minutes: 11 },
  { id: 'demo-0004', scenario: 'demo-distracted', at: '2026-10-26T16:20:00Z', minutes: 10 },
  { id: 'demo-0005', scenario: 'demo-defensive', at: '2026-11-02T11:05:00Z', minutes: 12 }
];
// what the fictional student said: a good and a weaker example per skill
const SAID = {
  opening: ['What brings you in today, and what would you like us to focus on?', 'So, you are here about your drinking.'],
  open_ended_questions: ['How have things been for you at home lately?', 'Do you drink every day?'],
  focused_questioning: ['How often does that happen in a typical week?', 'Is it bad?'],
  listening: ['Please go on, I am listening.', 'Right, okay. Next question.'],
  summarisation: ['Let me check I have understood: work has been stressful and you drink more in the evenings?', 'Okay, moving on.'],
  closing: ['Is there anything else you would like to talk about before we finish?', 'That is all for today.'],
  acknowledging_concerns: ['I can see this has been worrying you.', 'Let us stay on topic.'],
  verbal_empathy: ['That sounds really difficult. I am sorry you have been going through this.', 'Everyone has stress.'],
  permission_seeking: ['Would it be okay if I asked you a few personal questions?', 'I need to ask about alcohol now.'],
  responding_to_distress: ['You seem upset. Would you like to take a moment?', 'Let us get back to the questions.'],
  clear_language: ['In other words, we want to understand how much you drink in a normal week.', 'We need to assess your consumption pattern.']
};
const REPLIES = [
  'Well, it has been a hard few months, to be honest.',
  'I suppose so. I had not really thought about it like that.',
  'Sorry, what was the question again? My phone keeps buzzing.',
  'It is mostly in the evenings, after work.',
  'I would rather not talk about that too much.',
  'Thank you. That helps.'
];
const WHY = {
  positive: 'This behaviour helps the patient share information and feel heard.',
  improvement: 'A different approach here would make it easier for the patient to open up.',
  insufficient_evidence: 'The conversation did not include a moment where this skill could be observed.'
};
// fictional rubric (same ID, criteria and weights in every demo session, so rubric scores are comparable)
const RUBRIC = { rubric_id: 'demo-communication-v1', criteria: [
  { criterion_id: 'demo-open-questions', skill: 'open_ended_questions', weight: 1 },
  { criterion_id: 'demo-empathy', skill: 'verbal_empathy', weight: 1 },
  { criterion_id: 'demo-summary', skill: 'summarisation', weight: 0.5 }
] };

function demoRecord(s, k) {
  const start = new Date(s.at).getTime();
  const at = (i) => new Date(start + i * 25000).toISOString();
  const timeline = [];
  const turnFor = {};
  let i = 0;
  for (const [skill, results] of Object.entries(STORY)) {
    const status = results[k];
    if (status === N || !SAID[skill]) continue;
    const doctorId = `${s.id}-t${String(i + 1).padStart(2, '0')}`;
    const text = SAID[skill][status === P ? 0 : 1];
    turnFor[skill] = doctorId;
    timeline.push({ timestamp: at(i), entry_type: 'transcript_turn', speaker: 'doctor', turn_id: doctorId, summary: text, original_text: text, annotations: [] });
    i += 1;
    const reply = REPLIES[(i + k) % REPLIES.length];
    timeline.push({ timestamp: at(i), entry_type: 'transcript_turn', speaker: 'patient', turn_id: `${s.id}-t${String(i + 1).padStart(2, '0')}`, summary: reply, original_text: reply, annotations: [] });
    i += 1;
  }
  const finding = (skill, status) => ({
    category: skill,
    observation: status === P ? `${skillName(skill)} was demonstrated (demo).` : status === I ? `${skillName(skill)} needed practice in this conversation (demo).` : `Not enough evidence to assess ${skillName(skill).toLowerCase()} (demo).`,
    evidence_ids: turnFor[skill] ? [turnFor[skill]] : [],
    why_it_matters: WHY[status],
    suggestion: status === P ? null : `Next time, try: “${SAID[skill]?.[0] ?? 'ask permission before raising a sensitive topic.'}”`
  });
  const by = (status) => Object.entries(STORY).filter(([, r]) => r[k] === status).map(([skill]) => finding(skill, status));
  const criteria = RUBRIC.criteria.map((c) => {
    const status = STORY[c.skill][k];
    const score = status === P ? 1 : status === I ? 0 : null;
    return { criterion_id: c.criterion_id, name: skillName(c.skill), category: 'communication', weight: c.weight,
      status: score == null ? 'not_assessable' : status, score, weighted_score: score == null ? null : score * c.weight,
      evidence_ids: turnFor[c.skill] ? [turnFor[c.skill]] : [], explanation: finding(c.skill, status).observation };
  });
  const names = (status) => Object.entries(STORY).filter(([, r]) => r[k] === status).map(([skill]) => skillName(skill));
  const doctorTurns = timeline.filter((t) => t.speaker === 'doctor').length;
  const assessment = {
    session_id: s.id, learning_session_id: null, attempt_number: null, patient_id: `${s.scenario}-patient`, scenario_id: s.scenario,
    information_discovered: [], information_not_explored: [], information_explored_but_not_disclosed: [], data_quality_warnings: [],
    communication_feedback: [], timeline,
    statistics: { total_transcript_turns: timeline.length, doctor_turns: doctorTurns, patient_turns: timeline.length - doctorTurns, interaction_events: 0, duration_seconds: s.minutes * 60 },
    communication_evaluation: { positive_observations: by(P), improvement_opportunities: by(I), insufficient_evidence: by(N), criterion_results: criteria },
    framework_assessment: null, contextual_feedback: null,
    overall_feedback: {
      summary: `Fictional demo consultation ${k + 1}: ${names(P).length} skills demonstrated, ${names(I).length} to practise.`,
      strengths: names(P).slice(0, 3), areas_to_improve: names(I).slice(0, 3), next_steps: names(I).slice(0, 1).map((n) => `Practise ${n.toLowerCase()} in your next consultation.`), evidence: []
    },
    human_review_required: false
  };
  return {
    session: { session_id: s.id, scenario_id: s.scenario, assessment_rubric: { rubric_id: RUBRIC.rubric_id, criteria: [] } },
    assessment, created_at: s.at, completed_at: s.at
  };
}

/** Built on demand (never stored). */
export function demoProgressRecords() {
  return SESSIONS.map(demoRecord);
}
