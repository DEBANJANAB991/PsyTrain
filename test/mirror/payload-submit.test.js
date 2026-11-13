import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReplayPayload } from '../../src/mirror/payload.js';
import { createSubmission } from '../../src/mirror/submit.js';
import { createMirrorApi, MirrorApiError } from '../../src/mirror/api.js';

// Shape returned by POST /api/consultations/start (from a live response of the existing endpoint).
const startedSession = () => ({
  session_id: '07453564-0e1c-4f5f-af52-0cc124b458a0',
  learning_session_id: null, attempt_number: null, previous_attempt_session_id: null,
  patient_id: 'patient-104', scenario_id: 'chest-pain-basic',
  started_at: '2026-11-13T09:00:00Z', ended_at: null, transcript: [],
  events: [{ event_id: 'ev-start', timestamp: '2026-11-13T09:00:00Z', event_type: 'consultation_started', fact_id: null, emotion_state: null, details: 'Consultation started.' }],
  patient_profile: { patient_id: 'patient-104', scenario_id: 'chest-pain-basic', expected_facts: [
    { fact_id: 'symptom-onset', description: 'When the chest discomfort began.', category: 'history_of_present_illness', importance: 'high', related_keywords: ['when'] },
    { fact_id: 'medication-use', description: 'Current medicines.', category: 'medication_history', importance: 'medium', related_keywords: ['medication'] }
  ] },
  assessment_rubric: { rubric_id: 'consultation-basics-v1', criteria: [] }
});
const turns = [
  { turn_id: 't1', timestamp: '2026-11-13T09:00:10Z', speaker: 'doctor', text: 'What brings you in today?' },
  { turn_id: 't2', timestamp: '2026-11-13T09:00:20Z', speaker: 'patient', text: 'My chest feels tight.' }
];
const CONTRACT_FIELDS = ['assessment_rubric', 'attempt_number', 'ended_at', 'events', 'learning_session_id', 'patient_id', 'patient_profile',
  'previous_attempt_session_id', 'scenario_id', 'session_id', 'started_at', 'transcript'].sort();
let n = 0;
const uuid = () => `u-${++n}`;
const endedAt = new Date('2026-11-13T09:05:00Z');

test('payload keeps the /start session and adds only contract fields', () => {
  const p = buildReplayPayload({ session: startedSession(), turns, endedAt, uuid });
  assert.deepEqual(Object.keys(p).sort(), CONTRACT_FIELDS);
  assert.equal(p.session_id, '07453564-0e1c-4f5f-af52-0cc124b458a0');
  assert.deepEqual(p.patient_profile, startedSession().patient_profile);
  assert.equal(p.started_at, '2026-11-13T09:00:00Z');
  assert.equal(p.ended_at, '2026-11-13T09:05:00.000Z');
  assert.deepEqual(p.transcript, turns);
  assert.deepEqual(p.events.map((e) => e.event_type), ['consultation_started', 'consultation_ended']);
});

test('fact outcomes become events only for marked, real fact IDs; not_explored adds nothing', () => {
  const outcomes = { 'symptom-onset': 'disclosed', 'medication-use': 'declined', 'invented-fact': 'disclosed' };
  const p = buildReplayPayload({ session: startedSession(), turns, outcomes, endedAt, uuid });
  const factEvents = p.events.filter((e) => e.fact_id);
  assert.deepEqual(factEvents.map((e) => [e.event_type, e.fact_id]), [['fact_disclosed', 'symptom-onset'], ['patient_refused_to_disclose', 'medication-use']]);
  assert.ok(factEvents.every((e) => e.timestamp === '2026-11-13T09:05:00.000Z'));

  const none = buildReplayPayload({ session: startedSession(), turns, outcomes: { 'symptom-onset': 'not_explored' }, endedAt, uuid });
  assert.equal(none.events.filter((e) => e.fact_id).length, 0);
});

test('payload requires a started session', () => {
  assert.throws(() => buildReplayPayload({ session: null, turns, endedAt }), /No MIRROR consultation/);
});

function fakeApi({ replay = [], fetches = [] } = {}) {
  const calls = { replay: [], getAssessment: [] };
  return {
    calls,
    async replay(p) { calls.replay.push(p); const r = replay.shift(); if (r instanceof Error) throw r; return { session_id: p.session_id }; },
    async getAssessment(id) { calls.getAssessment.push(id); const r = fetches.shift(); if (r instanceof Error) throw r; return { session_id: r ?? id }; }
  };
}

test('double click shares one in-flight submission; no second submission after success', async () => {
  const api = fakeApi();
  let built = 0;
  const s = createSubmission(api, () => { built++; return { session_id: 's1' }; });
  const [a, b] = await Promise.all([s.submit(), s.submit()]);
  assert.equal(a, b);
  assert.equal(api.calls.replay.length, 1);
  assert.equal(built, 1);
  await s.submit();
  assert.equal(api.calls.replay.length, 1);
  assert.deepEqual(api.calls.getAssessment, ['s1']);
});

test('retry after a failed submission resends the identical frozen payload', async () => {
  const api = fakeApi({ replay: [new MirrorApiError('down', { status: 503 })] });
  let built = 0;
  const s = createSubmission(api, () => ({ session_id: 's2', build: ++built }));
  await assert.rejects(s.submit(), /down/);
  assert.equal(s.submitted, false);
  assert.equal(s.isRetryable(new MirrorApiError('down', { status: 503 })), true);
  const r = await s.submit();
  assert.equal(r.sessionId, 's2');
  assert.equal(built, 1);
  assert.equal(api.calls.replay[0], api.calls.replay[1]);
});

test('retry after a failed assessment GET does NOT submit the consultation again', async () => {
  const api = fakeApi({ fetches: [new MirrorApiError('timeout', { status: 0 })] });
  const s = createSubmission(api, () => ({ session_id: 's4' }));
  await assert.rejects(s.submit(), /timeout/);
  assert.equal(s.submitted, true);
  const r = await s.submit();
  assert.equal(r.sessionId, 's4');
  assert.equal(api.calls.replay.length, 1, 'replay sent exactly once');
  assert.deepEqual(api.calls.getAssessment, ['s4', 's4']);
});

test('409 (already saved) is treated as success and the saved assessment is retrieved', async () => {
  const api = fakeApi({ replay: [new MirrorApiError('already completed', { status: 409 })] });
  const s = createSubmission(api, () => ({ session_id: 's3' }));
  const r = await s.submit();
  assert.equal(r.assessment.session_id, 's3');
  assert.deepEqual(api.calls.getAssessment, ['s3']);
});

test('an assessment for a different session is rejected', async () => {
  const api = fakeApi({ fetches: ['someone-else'] });
  const s = createSubmission(api, () => ({ session_id: 's5' }));
  await assert.rejects(s.submit(), /different session/);
});

test('an async payload builder (case setup fetched at submit time) runs once and is reused on retry', async () => {
  const api = fakeApi({ replay: [new MirrorApiError('down', { status: 503 })] });
  let built = 0;
  const s = createSubmission(api, async () => { built++; await null; return { session_id: 's6' }; });
  await assert.rejects(s.submit(), /down/);
  await s.submit();
  assert.equal(built, 1);
  assert.equal(api.calls.replay.length, 2);
  assert.equal(api.calls.replay[0], api.calls.replay[1]);
});

test('422 is not retryable', () => {
  const s = createSubmission(fakeApi(), () => ({}));
  assert.equal(s.isRetryable(new MirrorApiError('invalid', { status: 422 })), false);
});

test('api client: endpoints, JSON body and error mapping', async () => {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push([init.method, url, init.body]);
    if (url.endsWith('/replay')) return { ok: false, status: 409, json: async () => ({ detail: "Consultation session_id 's' has already been completed." }) };
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  };
  const api = createMirrorApi({ fetchImpl });
  await api.getScenarios();
  await api.startConsultation('chest-pain-basic');
  await assert.rejects(api.replay({ session_id: 's' }), (e) => e instanceof MirrorApiError && e.status === 409 && /already been completed/.test(e.message));
  await api.getAssessment('a b');
  assert.deepEqual(seen, [
    ['GET', '/api/consultations/scenarios', undefined],
    ['POST', '/api/consultations/start', '{"scenario_id":"chest-pain-basic"}'],
    ['POST', '/api/consultations/replay', '{"session_id":"s"}'],
    ['GET', '/api/consultations/a%20b/assessment', undefined]
  ]);
  const down = createMirrorApi({ fetchImpl: async () => { throw new TypeError('fetch failed'); } });
  await assert.rejects(down.getScenarios(), (e) => e.status === 0 && /could not be reached/.test(e.message));
});
