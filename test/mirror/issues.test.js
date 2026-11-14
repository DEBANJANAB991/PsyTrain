import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { analyseCoaching } from '../../src/mirror/coaching.js';
import { buildIssueTimeline } from '../../src/mirror/issues.js';

const hints = JSON.parse(readFileSync(new URL('../../ai-patient-voice/hints.json', import.meta.url), 'utf8'));
const T0 = Date.parse('2026-11-13T09:00:00Z');
const mk = (spec) => spec.map(([speaker, text], i) => ({ id: `turn-${i + 1}`, speaker, text, timestamp: new Date(T0 + i * 10000).toISOString() }));
const run = (turns, assessment = {}) => buildIssueTimeline({ communication_evaluation: { improvement_opportunities: [] }, ...assessment }, turns, analyseCoaching(turns, hints));

test('distraction: the issue starts at the FIRST reply that followed the tangent (not the last), with exact wording and context', () => {
  const turns = mk([
    ['doctor', 'How much alcohol do you drink in a typical week?'],
    ['patient', 'Oh, by the way, last weekend we went to this amazing wedding and the band played all night.'],
    ['doctor', 'A wedding! What kind of band was it?'],
    ['patient', 'A swing band, and that reminds me, my friend Paula wants to learn swing dancing now.'],
    ['doctor', 'Swing dancing sounds fun, does Paula take classes?'],
    ['patient', 'Yes, on Tuesdays, she loves it.']
  ]);
  const r = run(turns);
  assert.equal(r.status, 'issues');
  const issue = r.located.find((x) => x.key === 'distraction-1');
  assert.ok(issue);
  assert.equal(issue.start.number, 3);
  assert.equal(issue.start.text, 'A wedding! What kind of band was it?');
  assert.equal(issue.before.number, 2);
  assert.equal(issue.before.text, turns[1].text);
  assert.equal(issue.anchor.number, 1);
  assert.equal(issue.after.number, 4);
  assert.equal(issue.start.timestamp, turns[2].timestamp);
  assert.equal(issue.strategy.shortHint, 'Narrow the topic');
  assert.ok(issue.strategy.sources.length >= 2);
  assert.ok(issue.context.some((t) => t.number === 5), 'surrounding conversation available');
});

test('assessment finding with turn evidence: earliest evidence turn, preceding patient turn, saved timestamp', () => {
  const turns = mk([
    ['doctor', 'Hello, what brings you in today?'],
    ['patient', 'My partner thinks I drink too much.'],
    ['doctor', 'How much alcohol do you drink?'],
    ['patient', 'Not that much.'],
    ['doctor', 'Do you use drugs as well?']
  ]);
  const r = run(turns, { communication_evaluation: { improvement_opportunities: [
    { category: 'sensitive_topic_permission', observation: 'A sensitive-topic question was observed without a preceding permission cue.', evidence_ids: ['turn-5', 'turn-3'],
      why_it_matters: 'Checking readiness before sensitive questions supports patient autonomy.', suggestion: 'Ask permission before continuing with a sensitive topic.' }
  ] } });
  const issue = r.located.find((x) => x.category === 'sensitive_topic_permission');
  assert.equal(issue.start.number, 3);
  assert.equal(issue.start.text, 'How much alcohol do you drink?');
  assert.equal(issue.before.text, 'My partner thinks I drink too much.');
  assert.equal(issue.start.timestamp, '2026-11-13T09:00:20.000Z');
  assert.equal(issue.why, 'Checking readiness before sensitive questions supports patient autonomy.');
  assert.equal(issue.suggestion, 'Ask permission before continuing with a sensitive topic.');
  assert.equal(issue.occurrences, 2);
});

test('distress: starts at the first doctor turn after the explicit distress statement', () => {
  const turns = mk([
    ['doctor', 'How have you been?'], ['patient', 'Honestly I feel overwhelmed and scared.'],
    ['doctor', 'When did the symptoms start?'], ['patient', 'Two weeks ago.'], ['doctor', 'Any medication?']
  ]);
  const r = run(turns, { communication_evaluation: { improvement_opportunities: [
    { category: 'responding_to_distress', observation: 'x', evidence_ids: ['turn-2', 'turn:turn-3', 'turn:turn-5'], why_it_matters: 'w', suggestion: 's' }
  ] } });
  const issue = r.located.find((x) => x.category === 'responding_to_distress');
  assert.equal(issue.start.number, 3);
  assert.equal(issue.before.number, 2);
});

test('nothing is fabricated: "missing across the consultation" findings and unknown evidence ids are not located', () => {
  const turns = mk([['doctor', 'What brings you in?'], ['patient', 'I am tired.'], ['doctor', 'How is your sleep?'], ['patient', 'Not great.']]);
  const r = run(turns, { communication_evaluation: { improvement_opportunities: [
    { category: 'focused_questioning', observation: 'The available doctor questions did not match the configured cues for this behaviour.', evidence_ids: ['turn-1', 'turn-3'], why_it_matters: 'w', suggestion: 's' },
    { category: 'clear_language', observation: 'x', evidence_ids: ['turn-99'], why_it_matters: 'w', suggestion: 's' },
    { category: 'interruptions', observation: 'x', evidence_ids: ['event-7'], why_it_matters: 'w', suggestion: 's' }
  ] } });
  assert.equal(r.located.length, 0);
  assert.equal(r.status, 'insufficient');
  assert.deepEqual(r.unlocated.map((u) => u.category).sort(), ['clear_language', 'focused_questioning', 'interruptions']);
});

test('aggression escalation: starts at the first escalating reply; a demonstrated strategy is not an issue', () => {
  const esc = run(mk([
    ['doctor', 'How often do you drink alcohol?'],
    ['patient', 'Are you even qualified to ask me that? You are just a student.'],
    ['doctor', 'I am fully qualified and I know what I am doing.'],
    ['patient', 'You do not understand anything. This is ridiculous.'],
    ['doctor', 'There is no need to be rude. Just calm down.']
  ]));
  const issue = esc.located.find((x) => x.key === 'aggressive-2');
  assert.equal(issue.start.number, 3);
  assert.equal(issue.before.text, 'Are you even qualified to ask me that? You are just a student.');
  assert.match(issue.title, /Drawn into the confrontation/);

  const ok = run(mk([
    ['doctor', 'Can you tell me how you have been sleeping?'], ['patient', 'This is pointless. Talking does not help anyway.'],
    ['doctor', 'I can hear how frustrating this feels, and I would like us to stay with this question for a moment.'], ['patient', 'Fine. Four hours.']
  ]));
  assert.equal(ok.located.length, 0);
  assert.equal(ok.status, 'none');
});

test('empty or insufficient transcripts give the neutral fallback', () => {
  assert.equal(buildIssueTimeline({}, [], null).status, 'insufficient');
  const noReply = run(mk([['doctor', 'How are you?'], ['patient', 'This is pointless, talking does not help anyway.']]));
  assert.equal(noReply.located.length, 0);
  assert.ok(noReply.unlocated.some((u) => u.source === 'coaching'));
});
