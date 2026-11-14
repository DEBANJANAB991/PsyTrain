import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProgressModel } from '../../src/mirror/progressModel.js';
import { createHistoryStore } from '../../src/mirror/history.js';

// A saved ConsultationRecord shaped like GET /api/consultations/{id} (only the fields the dashboard reads).
function record(id, completedAt, skills, { turns = 6, rubric = null, criteria = [], review = false, scenario = 'defensive-001' } = {}) {
  const timeline = Array.from({ length: turns }, (_, i) => ({
    timestamp: `2026-01-01T10:00:${String(i).padStart(2, '0')}Z`, entry_type: 'transcript_turn',
    speaker: i % 2 ? 'patient' : 'doctor', turn_id: `${id}-t${i + 1}`, summary: `turn ${i + 1}`, original_text: `turn ${i + 1}`
  }));
  const fb = (category, status) => ({ category, observation: `${category} ${status}`, evidence_ids: status === 'insufficient_evidence' ? [] : [`${id}-t1`], why_it_matters: 'why', suggestion: `try ${category}` });
  const by = (st) => Object.entries(skills).filter(([, v]) => v === st).map(([k]) => fb(k, st));
  return {
    session: { session_id: id, scenario_id: scenario, assessment_rubric: rubric },
    created_at: completedAt, completed_at: completedAt,
    assessment: {
      session_id: id, scenario_id: scenario, attempt_number: null, human_review_required: review, timeline,
      overall_feedback: { summary: 's', strengths: [], areas_to_improve: [], next_steps: [], evidence: [] },
      communication_evaluation: {
        positive_observations: by('positive'), improvement_opportunities: by('improvement'), insufficient_evidence: by('insufficient_evidence'),
        criterion_results: criteria
      }
    }
  };
}

test('empty history gives an empty model with no trend', () => {
  const m = buildProgressModel([]);
  assert.equal(m.overview.completed, 0);
  assert.equal(m.overview.trend.kind, 'insufficient');
  assert.deepEqual(m.insights, []);
});

test('one assessment: latest values only, no trend and no insights', () => {
  const m = buildProgressModel([record('a', '2026-01-01T10:00:00Z', { opening: 'positive', listening: 'improvement', closing: 'insufficient_evidence' })]);
  assert.equal(m.overview.completed, 1);
  assert.equal(m.overview.scored, 1);
  assert.equal(m.overview.trend.kind, 'insufficient');
  assert.equal(m.overview.strongest.id, 'opening');
  assert.equal(m.overview.weakest.id, 'listening');
  assert.deepEqual(m.insights, []);
  const closing = m.rows.find((r) => r.id === 'closing');
  assert.equal(closing.points[0].state, 'insufficient');
  assert.equal(closing.points[0].score, null, 'insufficient evidence is never a 0');
  assert.equal(m.rows.find((r) => r.id === 'listening').trend.kind, 'single');
});

test('sessions are ordered by completion time; trends use only evidenced sessions', () => {
  const m = buildProgressModel([
    record('c', '2026-01-03T10:00:00Z', { listening: 'positive', opening: 'positive' }),
    record('a', '2026-01-01T10:00:00Z', { listening: 'improvement', opening: 'positive' }),
    record('b', '2026-01-02T10:00:00Z', { listening: 'insufficient_evidence', opening: 'positive' })
  ]);
  assert.deepEqual(m.sessions.map((s) => s.sessionId), ['a', 'b', 'c']);
  const listening = m.rows.find((r) => r.id === 'listening');
  assert.deepEqual(listening.points.map((p) => p.score), [0, null, 1]);
  assert.equal(listening.trend.kind, 'improved');
  assert.equal(listening.trend.previous.number, 1);
  assert.equal(listening.trend.latest.number, 3);
  assert.equal(m.rows.find((r) => r.id === 'opening').trend.kind, 'consistent_strong');
  const kinds = m.insights.map((i) => `${i.kind}:${i.skillId}`);
  assert.ok(kinds.includes('improved:listening'));
  assert.ok(kinds.includes('strength:opening'));
  // overall: last two scored sessions (b, c), only skills evidenced in both (opening)
  assert.equal(m.overview.trend.compared, 1);
  assert.equal(m.overview.trend.kind, 'steady');
});

test('a consultation with too little conversation shows no scores and is left out of trends', () => {
  const m = buildProgressModel([
    record('a', '2026-01-01T10:00:00Z', { listening: 'improvement' }),
    record('b', '2026-01-02T10:00:00Z', { listening: 'positive' }, { turns: 2 })
  ]);
  const b = m.sessions[1];
  assert.equal(b.limited, true);
  assert.equal(b.scored, false);
  assert.equal(m.rows[0].points[1].state, 'withheld');
  assert.equal(m.rows[0].points[1].score, null);
  assert.equal(m.rows[0].trend.kind, 'single');
  assert.equal(m.overview.scored, 1);
  assert.equal(m.overview.trend.kind, 'insufficient');
});

test('a skill missing from a session is "not assessed", not 0', () => {
  const m = buildProgressModel([
    record('a', '2026-01-01T10:00:00Z', { listening: 'positive' }),
    record('b', '2026-01-02T10:00:00Z', { opening: 'positive' })
  ]);
  const listening = m.rows.find((r) => r.id === 'listening');
  assert.equal(listening.points[1].state, 'not_assessed');
  assert.equal(listening.points[1].score, null);
  assert.equal(m.overview.trend.kind, 'insufficient');   // no skill evidenced in both
  assert.equal(m.overview.trend.reason, 'no-common-skills');
});

test('rubric scores are compared only for the same rubric and weights', () => {
  const crit = (score, weight = 1) => [{ criterion_id: 'open-questions', name: 'Open questions', category: 'communication', weight, status: score ? 'positive' : 'improvement', score, weighted_score: score * weight, evidence_ids: ['t1'], explanation: 'x' }];
  const rubric = { rubric_id: 'consultation-basics-v1', criteria: [] };
  const same = buildProgressModel([
    record('a', '2026-01-01T10:00:00Z', { open_ended_questions: 'improvement' }, { rubric, criteria: crit(0) }),
    record('b', '2026-01-02T10:00:00Z', { open_ended_questions: 'positive' }, { rubric, criteria: crit(1) })
  ]);
  assert.deepEqual(same.overview.trend.rubric, { previous: 0, latest: 1, id: 'consultation-basics-v1' });
  const different = buildProgressModel([
    record('a', '2026-01-01T10:00:00Z', { open_ended_questions: 'improvement' }, { rubric, criteria: crit(0) }),
    record('b', '2026-01-02T10:00:00Z', { open_ended_questions: 'positive' }, { rubric, criteria: crit(1, 2) })
  ]);
  assert.equal(different.overview.trend.rubric, null);
});

test('records that are not saved assessments are ignored', () => {
  const m = buildProgressModel([{ assessment: null }, record('a', '2026-01-01T10:00:00Z', { opening: 'positive' })], { missing: 2 });
  assert.equal(m.overview.completed, 1);
  assert.equal(m.missing, 2);
});

test('history store keeps unique session IDs and survives bad storage data', () => {
  const data = new Map();
  const storage = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) };
  const h = createHistoryStore(storage);
  h.add('s1'); h.add('s1'); h.add('s2'); h.add('');
  assert.deepEqual(h.list().map((x) => x.sessionId), ['s1', 's2']);
  data.set('mirror.progress.v1', '{not json');
  assert.deepEqual(h.list(), []);
  assert.equal(createHistoryStore(null).available, false);
  assert.deepEqual(createHistoryStore(null).list(), []);
});
