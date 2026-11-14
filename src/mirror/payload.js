/**
 * Build the existing MIRROR ConsultationReplayRequest (= ConsultationSession) from:
 *   - the ConsultationSession returned by POST /api/consultations/start (ids, profile, rubric, started_at, events)
 *   - the recorded transcript turns
 *   - fact outcomes the user marked on the End Session screen
 * Only fields defined by the backend contract are sent (it rejects unknown fields).
 */

export const FACT_OUTCOMES = {
  not_explored: { label: 'Not explored (no event)', eventType: null },
  disclosed: { label: 'Disclosed', eventType: 'fact_disclosed', details: 'Marked as disclosed by the user on the End Session screen.' },
  declined: { label: 'Declined', eventType: 'patient_refused_to_disclose', details: 'Marked as declined by the user on the End Session screen.' }
};

const defaultUuid = () => globalThis.crypto.randomUUID();

export function buildReplayPayload({ session, turns, outcomes = {}, endedAt, uuid = defaultUuid }) {
  if (!session?.session_id) throw new Error('No MIRROR consultation has been started.');
  const ended = (endedAt ?? new Date()).toISOString();
  const knownFacts = (session.patient_profile?.expected_facts ?? []).map((f) => f.fact_id);

  const factEvents = [];
  for (const factId of knownFacts) {           // order of expected_facts, only real fact IDs
    const outcome = FACT_OUTCOMES[outcomes[factId]];
    if (!outcome?.eventType) continue;
    factEvents.push({ event_id: uuid(), timestamp: ended, event_type: outcome.eventType, fact_id: factId, details: outcome.details });
  }

  return {
    session_id: session.session_id,
    learning_session_id: session.learning_session_id ?? null,
    attempt_number: session.attempt_number ?? null,
    previous_attempt_session_id: session.previous_attempt_session_id ?? null,
    patient_id: session.patient_id,
    scenario_id: session.scenario_id,
    started_at: session.started_at ?? null,
    ended_at: ended,
    transcript: turns.map(({ turn_id, timestamp, speaker, text }) => ({ turn_id, timestamp, speaker, text })),
    events: [
      ...(session.events ?? []),
      ...factEvents,
      { event_id: uuid(), timestamp: ended, event_type: 'consultation_ended', details: 'Consultation ended from the PsyTrain End Session screen.' }
    ],
    patient_profile: session.patient_profile,
    assessment_rubric: session.assessment_rubric ?? null
  };
}
