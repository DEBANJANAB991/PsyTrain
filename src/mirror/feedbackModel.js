/**
 * Pure presentation mapping of a saved MIRROR ConsultationAssessment (app/models/assessment.py).
 * No scoring, inference or new findings: every value shown comes from the assessment as saved by MIRROR.
 * Only lookups are added (evidence id -> transcript text) so evidence can be read in place.
 */

const readable = (v) => String(v ?? '').replace(/[_-]+/g, ' ').trim();

export function formatDuration(seconds) {
  if (seconds == null) return 'Not available';
  const m = Math.floor(seconds / 60), s = Math.round(seconds % 60);
  return `${m} min${s ? ` ${s} sec` : ''}`;
}

/** Build lookups for evidence references: "turn:<id>", "event:<id>" or a bare turn/event id. */
function evidenceIndex(a) {
  const byId = new Map();
  for (const item of a.timeline ?? []) {
    if (item.turn_id) byId.set(item.turn_id, { kind: 'turn', speaker: item.speaker, text: item.original_text ?? item.summary, timestamp: item.timestamp });
    if (item.event_id) byId.set(item.event_id, { kind: 'event', text: item.summary, eventType: item.event_type, timestamp: item.timestamp });
  }
  for (const ev of a.contextual_feedback?.transcript_evidence ?? []) {
    if (!byId.has(ev.turn_id)) byId.set(ev.turn_id, { kind: 'turn', speaker: ev.speaker, text: ev.excerpt });
  }
  return (ref) => {
    const raw = String(ref);
    const id = raw.replace(/^(turn|event):/, '');
    const hit = byId.get(id);
    return { ref: raw, id, ...(hit ?? { kind: raw.startsWith('event:') ? 'event' : 'turn', text: null }) };
  };
}

export function buildFeedbackModel(a) {
  if (!a || typeof a !== 'object' || !a.session_id || !a.overall_feedback) throw new Error('Not a MIRROR assessment.');
  const resolve = evidenceIndex(a);
  const evalr = a.communication_evaluation ?? {};
  const overallEvidence = a.overall_feedback.evidence ?? [];
  const evidenceFor = (section, text) => (overallEvidence.find((e) => e.section === section && e.feedback_text === text)?.evidence_ids ?? []).map(resolve);
  const fact = (f) => ({ id: f.fact_id, description: f.description, importance: f.importance, category: readable(f.category), evidence: (f.evidence ?? []).map(resolve) });
  const obs = (status) => (o) => ({ status, category: readable(o.category), observation: o.observation, why: o.why_it_matters, suggestion: o.suggestion ?? null, evidence: (o.evidence_ids ?? []).map(resolve) });
  const cf = a.contextual_feedback;
  const timeline = [...(a.timeline ?? [])].sort((x, y) => new Date(x.timestamp) - new Date(y.timestamp));
  const criteria = evalr.criterion_results ?? [];

  return {
    sessionId: a.session_id,
    patientId: a.patient_id ?? null,
    scenarioId: a.scenario_id ?? null,
    attempt: a.attempt_number ?? null,
    humanReviewRequired: Boolean(a.human_review_required),
    metrics: {
      criteriaEvidenced: criteria.filter((c) => c.score != null).length,
      criteriaTotal: criteria.length,
      factsDiscovered: (a.information_discovered ?? []).length,
      factsTotal: (a.information_discovered ?? []).length + (a.information_explored_but_not_disclosed ?? []).length + (a.information_not_explored ?? []).length,
      // improvement findings; if there are none, the rubric criteria marked "improvement" (never a misleading 0)
      areasToPractise: (evalr.improvement_opportunities ?? []).length || criteria.filter((c) => c.status === 'improvement').length,
      insufficient: (evalr.insufficient_evidence ?? []).length,
      duration: formatDuration(a.statistics?.duration_seconds),
      statistics: a.statistics ?? null
    },
    overall: {
      summary: a.overall_feedback.summary,
      strengths: (a.overall_feedback.strengths ?? []).map((t) => ({ text: t, evidence: evidenceFor('strength', t) })),
      improvements: (a.overall_feedback.areas_to_improve ?? []).map((t) => ({ text: t, evidence: evidenceFor('improvement', t) })),
      nextSteps: (a.overall_feedback.next_steps ?? []).map((t) => ({ text: t, evidence: evidenceFor('next_step', t) }))
    },
    criteria: criteria.map((c) => ({
      id: c.criterion_id, name: c.name, category: readable(c.category), weight: c.weight, status: c.status,
      score: c.score, weightedScore: c.weighted_score ?? null, explanation: c.explanation, evidence: (c.evidence_ids ?? []).map(resolve)
    })),
    observations: [
      ...(evalr.positive_observations ?? []).map(obs('positive')),
      ...(evalr.improvement_opportunities ?? []).map(obs('improvement')),
      ...(evalr.insufficient_evidence ?? []).map(obs('insufficient_evidence'))
    ],
    information: {
      discovered: (a.information_discovered ?? []).map(fact),
      exploredNotDisclosed: (a.information_explored_but_not_disclosed ?? []).map(fact),
      notExplored: (a.information_not_explored ?? []).map(fact)
    },
    emotions: timeline.filter((t) => t.event_type === 'patient_emotion_state_changed' && t.emotion_state)
      .map((t) => ({ timestamp: t.timestamp, state: t.emotion_state })),
    // the saved transcript, numbered from 1 in saved order (same numbering as issues.js), for display + download
    transcriptTurns: (a.timeline ?? []).filter((t) => t.entry_type === 'transcript_turn').map((t, i) => ({
      number: i + 1, turnId: t.turn_id, speaker: t.speaker, timestamp: t.timestamp, text: t.original_text ?? t.summary
    })),
    timeline: timeline.map((t) => ({
      turnNumber: t.entry_type === 'transcript_turn' ? (a.timeline ?? []).filter((x) => x.entry_type === 'transcript_turn').indexOf(t) + 1 : null,
      timestamp: t.timestamp,
      kind: t.entry_type === 'transcript_turn' ? 'turn' : 'event',
      speaker: t.speaker ?? null,
      text: t.entry_type === 'transcript_turn' ? (t.original_text ?? t.summary) : t.summary,
      eventType: t.event_type ? readable(t.event_type) : null,
      annotations: (t.annotations ?? []).map((n) => ({
        category: readable(n.category), explanation: n.explanation, suggestion: n.learning_suggestion ?? null,
        evidence: (n.evidence_references ?? []).map((r) => resolve(r.id))
      }))
    })),
    contextual: cf ? {
      status: cf.status,
      observations: (cf.observations ?? []).map((o) => ({
        topic: readable(o.topic), finding: o.finding, summary: o.behavior_summary, why: o.why_it_matters ?? null,
        tryThis: o.what_to_try ?? null, example: o.example_response ?? null, principles: o.principle_ids ?? [],
        evidence: (o.evidence_turn_ids ?? []).map(resolve)
      })),
      references: (cf.knowledge_references ?? []).map((r) => ({ principle: r.principle_id, title: r.source_title, author: r.author_or_organisation, section: r.section, url: r.source_url }))
    } : null,
    frameworks: a.framework_assessment ? {
      version: a.framework_assessment.mapping_version,
      items: (a.framework_assessment.frameworks ?? []).map((f) => ({
        id: f.framework_id, name: f.framework_name, version: f.version, description: f.description,
        domains: (f.domains ?? []).map((d) => ({
          id: d.domain_id, name: d.domain_name, description: d.description, status: d.status, explanation: d.explanation,
          mappings: (d.criterion_mappings ?? []).map((m) => ({ criterion: readable(m.criterion_id), type: m.mapping_type, explanation: m.explanation, supporting: (m.supporting_frameworks ?? []).map(readable) })),
          evidence: (d.evidence_turn_ids ?? []).map(resolve)
        }))
      }))
    } : null,
    warnings: (a.data_quality_warnings ?? []).map((w) => ({ eventId: w.event_id, factId: w.fact_id, message: w.message }))
  };
}
