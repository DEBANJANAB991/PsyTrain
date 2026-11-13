import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { analyseCoaching, turnsFromAssessment, sourcesOf, OUTCOME } from '../../src/mirror/coaching.js';

const HINTS_PATH = new URL('../../ai-patient-voice/hints.json', import.meta.url);
const raw = readFileSync(HINTS_PATH);
const hints = JSON.parse(raw.toString('utf8'));
const hintsHash = createHash('sha256').update(raw).digest('hex');

let n = 0;
const D = (text) => ({ id: `t${++n}`, speaker: 'doctor', text });
const P = (text) => ({ id: `t${++n}`, speaker: 'patient', text });
const byKey = (r) => Object.fromEntries(r.items.map((i) => [`${i.behaviour}-${i.level}`, i]));
const strategy = (b, l) => hints[b].strategies.find((s) => s.level === l);

test('A distraction, student steers back: level 1 demonstrated, no long explanation, no higher levels', () => {
  const r = analyseCoaching([
    D('How much alcohol do you drink in a typical week?'),
    P('Oh, that reminds me, last weekend we went to this amazing wedding in the countryside and the band was fantastic.'),
    D('That sounds like a nice day. Coming back to my question: how much alcohol do you drink in a typical week?'),
    P('Maybe a bottle of wine over the week, a bit more at weekends.'),
    D('Thank you. And when did that start?'),
    P('Probably two years ago, when work got stressful.')
  ], hints);
  assert.equal(r.status, 'coaching');
  const k = byKey(r);
  assert.deepEqual(Object.keys(k), ['distraction-1']);
  assert.equal(k['distraction-1'].outcome, OUTCOME.demonstrated);
  assert.equal(k['distraction-1'].strategy, 'Narrow the topic');
  assert.equal(k['distraction-1'].longExplanation, null);
  assert.equal(k['distraction-1'].shortHint, null);
  assert.ok(k['distraction-1'].evidence.some((e) => /Coming back to my question/.test(e.text)));
  assert.equal(r.tips.length, 0);
});

test('B distraction, student follows every tangent: level 1 not demonstrated with exact hint text + relevant tips only', () => {
  const r = analyseCoaching([
    D('How much alcohol do you drink in a typical week?'),
    P('Oh, by the way, last weekend we went to this amazing wedding and the band played all night.'),
    D('A wedding! What kind of band was it?'),
    P('A swing band, and that reminds me, my friend Paula wants to learn swing dancing now.'),
    D('Swing dancing sounds fun, does Paula take classes?'),
    P('Yes, on Tuesdays, she loves it.')
  ], hints);
  const k = byKey(r);
  assert.deepEqual(Object.keys(k), ['distraction-1']);
  const it = k['distraction-1'];
  assert.equal(it.outcome, OUTCOME.missed);
  assert.equal(it.shortHint, strategy('distraction', 1).short_hint);
  assert.equal(it.longExplanation, strategy('distraction', 1).long_explanation, 'exact wording from hints.json');
  assert.deepEqual(it.sources, sourcesOf(strategy('distraction', 1).long_explanation));
  assert.ok(it.sources.length >= 2 && it.sources.every((s) => s.url.startsWith('https://')));
  assert.match(it.improvement, /How much alcohol do you drink/);
  assert.deepEqual(r.tips.map((t) => t.tip.short_hint).sort(), ['Prioritize with patient', 'Therapist leads']);
  assert.equal(r.tips[0].tip.long_explanation, hints.distraction.general_tips.find((t) => t.short_hint === r.tips[0].tip.short_hint).long_explanation);
});

test('B2 distraction, steering does not hold twice: level 1 demonstrated, levels 2 and 3 not demonstrated (progression)', () => {
  const r = analyseCoaching([
    D('How much alcohol do you drink in a typical week?'),
    P('Oh, that reminds me, last weekend we went to this amazing wedding with a swing band.'),
    D('Let us come back to my question: how much alcohol do you drink in a week?'),
    P('By the way, this room is lovely, is that painting new? My aunt paints too.'),
    D('Coming back to the question about alcohol: how much do you drink in a week?'),
    P('Anyway, my phone keeps buzzing, sorry, it is my sister about her birthday party.'),
    D('I see. How much alcohol do you drink in a week?'),
    P('About a bottle of wine, I suppose.')
  ], hints);
  const k = byKey(r);
  assert.equal(k['distraction-1'].outcome, OUTCOME.demonstrated);
  assert.equal(k['distraction-2'].outcome, OUTCOME.missed);
  assert.equal(k['distraction-2'].longExplanation, strategy('distraction', 2).long_explanation);
  assert.equal(k['distraction-3'].outcome, OUTCOME.missed);
  assert.ok(r.tips.some((t) => t.tip.short_hint === 'Set goal upfront'));
});

test('C aggressive, student validates and sets a limit: level 1 demonstrated, no long explanation, no safety advice', () => {
  const r = analyseCoaching([
    D('Can you tell me a bit about how you have been sleeping?'),
    P('This is pointless. Talking does not help anyway.'),
    D('I can hear how frustrating this feels, and I would like us to stay with this question for a moment.'),
    P('Fine. I sleep maybe four hours a night.')
  ], hints);
  const k = byKey(r);
  assert.deepEqual(Object.keys(k), ['aggressive-1']);
  assert.equal(k['aggressive-1'].outcome, OUTCOME.demonstrated);
  assert.equal(k['aggressive-1'].strategy, 'Validate, set limit');
  assert.equal(k['aggressive-1'].longExplanation, null);
  assert.ok(!r.tips.some((t) => ['Agree a safe word', 'Seek supervision'].includes(t.tip.short_hint)));
});

test('D aggressive, student escalates: level 2 not demonstrated with hint + "No power struggle"; no level 3 without a threat', () => {
  const r = analyseCoaching([
    D('How often do you drink alcohol?'),
    P('Are you even qualified to ask me that? You are just a student.'),
    D('I am fully qualified and I know what I am doing. You need to answer the questions.'),
    P('You do not understand anything. This is ridiculous.'),
    D('There is no need to be rude. Just calm down.')
  ], hints);
  const k = byKey(r);
  assert.deepEqual(Object.keys(k), ['aggressive-2']);
  assert.equal(k['aggressive-2'].outcome, OUTCOME.missed);
  assert.equal(k['aggressive-2'].shortHint, 'Slow, firm, meta');
  assert.equal(k['aggressive-2'].longExplanation, strategy('aggressive', 2).long_explanation);
  const tips = r.tips.map((t) => t.tip.short_hint);
  assert.ok(tips.includes('No power struggle'));
  assert.ok(tips.includes('Watch risk factors'), 'alcohol is in the transcript');
  assert.ok(!tips.includes('Agree a safe word'), 'no threat in the transcript');
});

test('D2 aggressive threat: level 3 only with transcript support; safety response demonstrated', () => {
  const r = analyseCoaching([
    D('Can we talk about your week?'),
    P('Back off or else you will regret it!'),
    D('I am going to pause the session here for our safety and step out for a moment.')
  ], hints);
  const k = byKey(r);
  assert.equal(k['aggressive-3'].outcome, OUTCOME.demonstrated);
  assert.equal(k['aggressive-3'].longExplanation, null);
  assert.ok(r.tips.some((t) => t.tip.short_hint === 'Agree a safe word'));
});

test('E insufficient evidence: no hint for an ordinary exchange, or when the student never replied', () => {
  const ordinary = analyseCoaching([
    D('What brings you in today?'), P('I have been feeling tired for a few weeks.'),
    D('How has your sleep been?'), P('Not great, I wake up early.')
  ], hints);
  assert.equal(ordinary.status, 'insufficient_evidence');
  assert.equal(ordinary.items.length, 0);
  assert.equal(ordinary.tips.length, 0);

  const noReply = analyseCoaching([D('How are you?'), P('This is pointless, talking does not help anyway.')], hints);
  assert.equal(noReply.items[0].outcome, OUTCOME.insufficient);
  assert.equal(noReply.items[0].longExplanation, null);
  assert.equal(noReply.items[0].shortHint, null);

  assert.equal(analyseCoaching([], hints).status, 'insufficient_evidence');
  assert.equal(analyseCoaching([P('hello')], hints).status, 'insufficient_evidence');
});

test('transcript turns come from the saved assessment timeline; evidence quotes only real turns', () => {
  const turns = turnsFromAssessment({ timeline: [
    { entry_type: 'interaction_event', event_type: 'consultation_started', summary: 'x' },
    { entry_type: 'transcript_turn', speaker: 'doctor', turn_id: 'a', original_text: 'How much alcohol do you drink?' },
    { entry_type: 'transcript_turn', speaker: 'patient', turn_id: 'b', original_text: 'Oh, by the way, my phone keeps buzzing, it is my sister.' },
    { entry_type: 'transcript_turn', speaker: 'doctor', turn_id: 'c', original_text: 'Is your sister okay?' }
  ] });
  assert.deepEqual(turns.map((t) => t.id), ['a', 'b', 'c']);
  const r = analyseCoaching(turns, hints);
  const texts = new Set(turns.map((t) => t.text));
  for (const i of r.items) for (const e of i.evidence) assert.ok(texts.has(e.text), `evidence is a real turn: ${e.text}`);
});

test('hints.json is read only and unchanged by the analysis', () => {
  const before = JSON.stringify(hints);
  analyseCoaching([D('How much do you drink?'), P('By the way, nice room!'), D('Thanks, who chose the plants?')], hints);
  assert.equal(JSON.stringify(hints), before);
  assert.equal(createHash('sha256').update(readFileSync(HINTS_PATH)).digest('hex'), hintsHash);
});
