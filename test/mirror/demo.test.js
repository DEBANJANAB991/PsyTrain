import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEMO_ASSESSMENT, DEMO_TRANSCRIPT, DEMO_LABEL, DEMO_TRANSCRIPT_LABEL, demoOptions } from '../../src/mirror/demo.js';
import { buildFeedbackModel } from '../../src/mirror/feedbackModel.js';

const hints = JSON.parse(readFileSync(new URL('../../ai-patient-voice/hints.json', import.meta.url), 'utf8'));
const opts = demoOptions(hints, () => {});
const byId = new Map(DEMO_TRANSCRIPT.map((t, i) => [t.turn_id, { ...t, number: i + 1 }]));
const ref = (e) => byId.get(String(e).replace(/^turn:/, ''));

test('labels and no separate overall score in the fixture', () => {
  assert.equal(DEMO_LABEL, 'DEMO ASSESSMENT — SIMULATED FEEDBACK, NOT BASED ON A REAL CONSULTATION');
  assert.equal(DEMO_TRANSCRIPT_LABEL, 'SIMULATED CONSULTATION TRANSCRIPT — DEMO ONLY');
  assert.equal(JSON.stringify(DEMO_ASSESSMENT).match(/overall_score|0\.66/), null);
  assert.equal(opts.demo.label, DEMO_LABEL);
});

test('ten dimensions on the 0..1 scale with varied scores, levels, good practice and recommendations', () => {
  const c = DEMO_ASSESSMENT.communication_evaluation.criterion_results;
  assert.deepEqual(c.map((x) => x.name), ['Opening and introduction', 'Rapport and empathy', 'Active listening', 'Questioning skills', 'Information gathering',
    'Conversation structure', 'Clarity of communication', 'Patient-centred approach', 'Summarisation', 'Closing the consultation']);
  assert.ok(c.every((x) => x.score >= 0 && x.score <= 1 && x.score < 1));
  assert.ok(new Set(c.map((x) => x.score)).size >= 6);
  for (const x of c) {
    const d = opts.criterionDetails[x.criterion_id];
    assert.ok(d.level && d.good, x.name);
    if (x.score < 0.85) assert.ok(d.recommendation, `${x.name} needs a recommendation`);
    assert.ok(x.evidence_ids.every((e) => byId.has(e)), `${x.name} evidence turns exist`);
  }
  const m = buildFeedbackModel(DEMO_ASSESSMENT);
  assert.equal(m.metrics.areasToPractise, c.filter((x) => x.status === 'improvement').length, 'no misleading "0 areas to practise"');
  assert.equal(m.transcriptTurns.length, 20);
});

test('transcript: consistent ids, chronological timestamps, speakers alternate, labelled story beats present', () => {
  DEMO_TRANSCRIPT.forEach((t, i) => {
    assert.equal(t.turn_id, `demo-turn-${String(i + 1).padStart(2, '0')}`);
    if (i) assert.ok(t.timestamp > DEMO_TRANSCRIPT[i - 1].timestamp);
  });
  const text = DEMO_TRANSCRIPT.map((t) => t.text).join(' ');
  for (const beat of ['I’m Alex, a medical student', 'What brings you in today?', 'five or six weeks ago', 'football tournament', 'drink alcohol', 'getting worried', 'Take care']) assert.ok(text.includes(beat), beat);
});

test('patient information: "discovered" only cites turns that contain it', () => {
  const words = { 'sleep-difficulty': 'lie awake', 'sleep-onset-timing': 'five or six weeks', 'night-waking': 'three', 'sleep-duration': 'four or five hours',
    'alcohol-frequency': 'four or five evenings', 'work-impact': 'two mistakes', medication: 'nothing regular' };
  for (const f of DEMO_ASSESSMENT.information_discovered) {
    assert.ok(f.evidence.length, f.fact_id);
    assert.ok(f.evidence.some((e) => ref(e).text.includes(words[f.fact_id])), `${f.fact_id} is in the transcript`);
  }
  assert.ok(DEMO_ASSESSMENT.information_not_explored.every((f) => f.evidence.length === 0));
});

test('strategy statuses come from the real coaching logic on the simulated transcript, with exact hints', () => {
  const items = Object.fromEntries(opts.coaching.items.map((i) => [`${i.behaviour}-${i.level}`, i]));
  assert.deepEqual(Object.keys(items), ['distraction-1', 'distraction-2']);
  assert.equal(items['distraction-1'].outcome, 'partially_demonstrated');
  assert.equal(items['distraction-2'].outcome, 'not_demonstrated');
  for (const [k, lvl] of [['distraction-1', 1], ['distraction-2', 2]]) {
    const s = hints.distraction.strategies.find((x) => x.level === lvl);
    assert.equal(items[k].strategy, s.short_hint);
    assert.equal(items[k].longExplanation, s.long_explanation);
    assert.ok(items[k].evidence.every((e) => ref(e.turnId).text.startsWith(e.text.replace(/…$/, ''))), 'evidence quotes the transcript');
    assert.ok(opts.strategyDetails[k].alternative && opts.strategyDetails[k].behaviour);
  }
  assert.deepEqual(opts.coaching.tips.map((t) => t.tip.short_hint), ['Prioritize with patient']);
  assert.equal(opts.coaching.tips[0].tip.long_explanation, hints.distraction.general_tips.find((t) => t.short_hint === 'Prioritize with patient').long_explanation);
});

test('issue excerpts, turn numbers and timestamps match the transcript exactly', () => {
  assert.equal(opts.issues.located.length, 4);
  for (const i of opts.issues.located) {
    for (const t of [i.anchor, i.before, i.start, i.after, ...i.context].filter(Boolean)) {
      const src = byId.get(t.id);
      assert.equal(t.text, src.text);
      assert.equal(t.number, src.number);
      assert.equal(t.timestamp, src.timestamp);
    }
    assert.equal(i.start.speaker, 'doctor');
  }
  assert.deepEqual(opts.issues.located.map((i) => i.start.number), [7, 15, 17, 19]);
});

test('practice steps and progress are populated and labelled as fictional', () => {
  assert.equal(opts.practiceSteps.length, 4);
  assert.ok(opts.practiceSteps.every((s) => s.skill && s.phrase && s.when && s.why && s.objective));
  assert.ok(/fictional/i.test(opts.progress.attempts.join(' ')));
  const c = Object.fromEntries(DEMO_ASSESSMENT.communication_evaluation.criterion_results.map((x) => [x.criterion_id, x.score]));
  assert.deepEqual(opts.progress.rows.map((r) => r.scores[1]), [c.structure, c.questioning, c.rapport, c.summarising], 'attempt 2 = this demo');
});
