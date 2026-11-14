import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFeedbackModel } from '../../src/mirror/feedbackModel.js';

// Trimmed real ConsultationAssessment shape (field names from MIRROR app/models/assessment.py).
const assessment = {
  session_id: 's-1', patient_id: 'patient-104', scenario_id: 'chest-pain-basic', attempt_number: null,
  information_discovered: [{ fact_id: 'symptom-onset', description: 'When the chest discomfort began.', category: 'history_of_present_illness', importance: 'high', evidence: ['event:e-2'] }],
  information_not_explored: [{ fact_id: 'medication-use', description: 'Current medicines.', category: 'medication_history', importance: 'medium', evidence: [] }],
  information_explored_but_not_disclosed: [],
  data_quality_warnings: [],
  timeline: [
    { timestamp: '2026-11-13T09:00:20Z', entry_type: 'transcript_turn', speaker: 'patient', turn_id: 't-2', original_text: 'Since this morning.', summary: 'Patient: Since this morning.', annotations: [] },
    { timestamp: '2026-11-13T09:00:10Z', entry_type: 'transcript_turn', speaker: 'doctor', turn_id: 't-1', original_text: 'When did it start?', summary: 'Doctor: When did it start?',
      annotations: [{ category: 'focused_follow_up_question', explanation: 'A focused question.', evidence_references: [{ source: 'turn', id: 't-1' }], learning_suggestion: null }] },
    { timestamp: '2026-11-13T09:00:20Z', entry_type: 'interaction_event', event_type: 'fact_disclosed', event_id: 'e-2', summary: 'Fact disclosed: symptom-onset', annotations: [] }
  ],
  statistics: { total_transcript_turns: 2, doctor_turns: 1, patient_turns: 1, interaction_events: 1, duration_seconds: 75 },
  communication_evaluation: {
    positive_observations: [{ category: 'focused_questioning', observation: 'Asked about onset.', evidence_ids: ['t-1'], why_it_matters: 'Timing matters.', suggestion: null }],
    improvement_opportunities: [], insufficient_evidence: [],
    criterion_results: [{ criterion_id: 'open-questions', name: 'Open questions', category: 'communication', weight: 1, status: 'insufficient_evidence', score: null, weighted_score: null, evidence_ids: [], explanation: 'No open question.' }]
  },
  framework_assessment: { mapping_version: 'mirror-framework-map-v1', frameworks: [{ framework_id: 'kalamazoo', framework_name: 'Kalamazoo Consensus Statement', version: 'v1', description: 'd',
    domains: [{ domain_id: 'gather_information', domain_name: 'Gather information', description: 'd', status: 'partially_assessed', explanation: 'Partial.', evidence_turn_ids: ['t-1'],
      criterion_mappings: [{ criterion_id: 'focused_questioning', mapping_type: 'partial', explanation: 'x', supporting_frameworks: ['kalamazoo', 'calgary_cambridge'] }] }] }] },
  contextual_feedback: { status: 'generated', observations: [{ topic: 'focused_questioning', finding: 'observed', behavior_summary: 'Focused onset question.', evidence_turn_ids: ['t-1'], why_it_matters: 'w', what_to_try: 't', example_response: null, principle_ids: ['focused-follow-up'] }],
    transcript_evidence: [{ turn_id: 't-1', speaker: 'doctor', excerpt: 'When did it start?', truncated: false }],
    knowledge_references: [{ principle_id: 'focused-follow-up', source_title: 'Skills for Communicating with Patients', author_or_organisation: 'Silverman, Kurtz, Draper', section: 'Gathering information', source_url: 'https://example.org/' }] },
  overall_feedback: { summary: 'One fact discovered.', strengths: ['Asked about onset.'], areas_to_improve: [], next_steps: ['Try an open opening.'],
    evidence: [{ section: 'strength', feedback_text: 'Asked about onset.', evidence_ids: ['turn:t-1'], related_fact_ids: [] }] },
  human_review_required: true
};

test('maps every saved section without adding or inferring content', () => {
  const m = buildFeedbackModel(assessment);
  assert.equal(m.sessionId, 's-1');
  assert.equal(m.humanReviewRequired, true);
  assert.deepEqual(m.metrics, { criteriaEvidenced: 0, criteriaTotal: 1, factsDiscovered: 1, factsTotal: 2, areasToPractise: 0, insufficient: 0, duration: '1 min 15 sec', statistics: assessment.statistics });
  assert.equal(m.overall.summary, 'One fact discovered.');
  assert.deepEqual(m.overall.improvements, []);
  assert.equal(m.criteria[0].score, null, 'no score is invented for a criterion without one');
  assert.equal(m.observations.length, 1);
  assert.equal(m.contextual.status, 'generated');
  assert.equal(m.contextual.references[0].title, 'Skills for Communicating with Patients');
  assert.equal(m.frameworks.items[0].domains[0].status, 'partially_assessed');
  assert.deepEqual(m.frameworks.items[0].domains[0].mappings[0].supporting, ['kalamazoo', 'calgary cambridge']);
});

test('evidence ids resolve to the saved transcript text', () => {
  const m = buildFeedbackModel(assessment);
  assert.deepEqual(m.overall.strengths[0].evidence.map((e) => [e.id, e.speaker, e.text]), [['t-1', 'doctor', 'When did it start?']]);
  assert.equal(m.information.discovered[0].evidence[0].kind, 'event');
  assert.equal(m.contextual.observations[0].evidence[0].text, 'When did it start?');
});

test('timeline is chronological and keeps annotations', () => {
  const m = buildFeedbackModel(assessment);
  assert.deepEqual(m.timeline.map((t) => t.text), ['When did it start?', 'Since this morning.', 'Fact disclosed: symptom-onset']);
  assert.equal(m.timeline[0].annotations[0].category, 'focused follow up question');
});

test('missing optional sections stay empty; non-assessments are rejected', () => {
  const m = buildFeedbackModel({ session_id: 'x', overall_feedback: { summary: 's' }, human_review_required: false });
  assert.equal(m.contextual, null);
  assert.equal(m.frameworks, null);
  assert.deepEqual(m.timeline, []);
  assert.throws(() => buildFeedbackModel({ detail: 'Consultation session not found.' }), /Not a MIRROR assessment/);
});
