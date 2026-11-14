/**
 * The tool layer every agent goes through (src/agent.js createAgent + src/personality.js), the tool schemas
 * (shared/agent-tools.js), the offline rules, and the browser-side loops of the director and the live director.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AGENT_TOOLS, LIVE_TOOLS, LIVE_TOOL_NAMES, STATE_NAMES, EMOTION_NAMES, EVENT_NAMES, GAZE_NAMES, GESTURE_NAMES,
  BEHAVIOR_KEYS, BEHAVIOR_META, MODE_STATES, modeStates, DIRECTOR_SYSTEM, LIVE_DIRECTOR_SYSTEM
} from '../../shared/agent-tools.js';
import { createAgent, Director, LiveDirector, offlineState, offlinePlan } from '../../src/agent.js';
import { Personality } from '../../src/personality.js';
import { BEHAVIOR } from '../../src/config.js';

/** The parts of Affect (src/affect.js) the agent uses, without TalkingHead. */
function fakeAffect() {
  return {
    state: { emotion: 'neutral', intensity: 0.5, gaze: 'student' },
    overrides: {}, personality: null, gestures: [],
    getBehavior() {
      const a = BEHAVIOR.neutral, b = BEHAVIOR[this.state.emotion] || a, out = {};
      for (const k of Object.keys(a)) out[k] = typeof a[k] === 'number' ? a[k] + (b[k] - a[k]) * this.state.intensity : b[k];
      this.personality?.apply(out);
      return Object.assign(out, this.overrides);
    },
    setAffect(i = {}) {
      if (i.emotion !== undefined) { this.state.emotion = i.emotion; if (i.behavior === undefined) { this.overrides = {}; this.personality?.clearCenters(); } }
      if (i.intensity !== undefined) this.state.intensity = i.intensity;
      if (i.behavior && typeof i.behavior === 'object') Object.assign(this.overrides, i.behavior);
      if (i.gaze !== undefined) this.state.gaze = i.gaze;
      if (i.gesture) this.gestures.push(i.gesture);
      return { ...this.state };
    }
  };
}
function setup() {
  const affect = fakeAffect();
  const personality = new Personality(affect);
  return { affect, personality, agent: createAgent({ affect, personality }) };
}
const allFinite = (agent) => {
  const s = agent.state();
  return Number.isFinite(s.intensity) && BEHAVIOR_KEYS.every((k) => Number.isFinite(s.behavior[k]));
};

// ---- schemas ---------------------------------------------------------------------------------------
test('schemas: every tool is strict, implemented, and the live set is a subset', () => {
  const { agent } = setup();
  for (const t of AGENT_TOOLS) {
    assert.equal(t.input_schema.type, 'object', t.name);
    assert.equal(t.input_schema.additionalProperties, false, `${t.name} must not accept unknown arguments`);
    assert.ok(t.description.length > 20, t.name);
    const r = agent.execute(t.name, {});
    assert.ok(!/unknown tool/.test(r.error || ''), `${t.name} has a handler`);
  }
  assert.deepEqual(LIVE_TOOLS.map((t) => t.name).sort(), [...LIVE_TOOL_NAMES].sort());
  for (const n of LIVE_TOOL_NAMES) assert.ok(AGENT_TOOLS.some((t) => t.name === n));
  const props = (n) => AGENT_TOOLS.find((t) => t.name === n).input_schema.properties;
  assert.deepEqual(props('set_state').state.enum, STATE_NAMES);
  assert.deepEqual(props('set_affect').emotion.enum, EMOTION_NAMES);
  assert.deepEqual(props('trigger_event').event.enum, EVENT_NAMES);
  for (const m of Object.keys(MODE_STATES)) for (const s of MODE_STATES[m]) assert.ok(STATE_NAMES.includes(s), `${m}: ${s}`);
  assert.deepEqual(modeStates('normal', 'aggressive')[0], 'guarded');
  assert.deepEqual(modeStates('normal', 'distracted')[0], 'engaged');
});

test('system prompts: the directors never speak as the patient and work only through tools', () => {
  assert.match(DIRECTOR_SYSTEM, /You never speak as the patient/);
  assert.match(LIVE_DIRECTOR_SYSTEM, /you never speak/);
  assert.match(LIVE_DIRECTOR_SYSTEM, /If the message names her conversation mode and the allowed states, use only those/);
});

// ---- validation guardrails -------------------------------------------------------------------------
test('unknown tools and invalid enum values are returned as readable errors, not thrown', () => {
  const { agent } = setup();
  const cases = [
    ['delete_everything', {}, /unknown tool "delete_everything". Valid: get_state/],
    ['set_affect', { emotion: 'furious' }, /unknown emotion "furious". Valid: neutral/],
    ['set_affect', { gaze: 'ceiling' }, /unknown gaze/],
    ['set_affect', { gesture: 'wave' }, /unknown gesture/],
    ['set_affect', {}, /give at least one of/],
    ['set_state', { state: 'panicking' }, /unknown state "panicking"/],
    ['set_state', {}, /unknown state "undefined"/],
    ['trigger_event', { event: 'explosion' }, /unknown event "explosion"/],
    ['set_personality', { preset: 'psychopath' }, /unknown personality "psychopath"/],
    ['set_personality', {}, /give at least one of/],
    ['set_personality', { traits: { charisma: 1 } }, /unknown trait "charisma"/],
    ['set_behavior', { tailWag: 1 }, /unknown behavior "tailWag"/],
    ['set_behavior', { arms: 'flailing' }, /unknown arms/],
    ['set_behavior', {}, /give at least one behavior/],
    ['set_behavior_range', {}, /give ranges/],
    ['set_behavior_range', { ranges: { tailWag: { min: 0, max: 1 } } }, /unknown behavior/],
    ['define_personality', { name: 'X', traits: {} }, /name must be 2-30 characters/],
    ['define_personality', { name: 'anxious', traits: {} }, /built-in personality/],
    ['define_personality', { name: 'ok_name', traits: {}, default_emotion: 'smug' }, /unknown emotion/]
  ];
  for (const [name, args, re] of cases) {
    const r = agent.execute(name, args);
    assert.equal(r.ok, false, `${name} ${JSON.stringify(args)}`);
    assert.match(r.error, re);
  }
  assert.equal(agent.execute('get_state', null).ok, true, 'null args are treated as {}');
  assert.equal(agent.execute('get_state', 'junk').ok, true);
});

test('non-numbers are rejected (they used to become NaN and freeze the body); numeric strings are accepted', () => {
  const { agent } = setup();
  const before = JSON.stringify(agent.state().traits);
  const bad = [
    ['set_behavior', { fidget: 'lots' }], ['set_behavior', { fidget: null }], ['set_behavior', { gazeStudent: {} }],
    ['set_affect', { intensity: 'high' }], ['set_state', { state: 'uneasy', strength: 'strong' }],
    ['trigger_event', { event: 'accusation', strength: [] }], ['set_personality', { variability: 'a bit' }],
    ['set_personality', { traits: { neuroticism: 0.9, openness: 'very' } }],
    ['set_behavior_range', { ranges: { fidget: { min: 'low', max: 1 } } }], ['set_behavior_range', { ranges: { fidget: 5 } }],
    ['define_personality', { name: 'nan_type', traits: { openness: 'x' } }],
    ['define_personality', { name: 'nan_type', traits: {}, default_emotion: 'sad', default_intensity: 'deep' }]
  ];
  for (const [name, args] of bad) {
    const r = agent.execute(name, args);
    assert.equal(r.ok, false, `${name} ${JSON.stringify(args)} should fail`);
    assert.match(r.error, /must be|range for/);
    assert.ok(allFinite(agent), `${name} left a NaN behind`);
  }
  assert.equal(JSON.stringify(agent.state().traits), before, 'a partly bad set_personality changed nothing');
  assert.equal(agent.execute('set_affect', { intensity: '0.4' }).ok, true);
  assert.equal(agent.state().intensity, 0.4);
});

test('out-of-range numbers are clamped, with a note where the agent asked for it', () => {
  const { agent } = setup();
  const r = agent.execute('set_behavior', { fidget: 5, blink: -2 });
  assert.equal(r.ok, true);
  assert.deepEqual(r.notes, ['fidget clamped to 1', `blink clamped to ${BEHAVIOR_META.blink.min}`]);
  assert.equal(agent.execute('set_affect', { intensity: 7 }).intensity, 1);
  const rr = agent.execute('set_behavior_range', { ranges: { gazeStudent: { min: 0.9, max: -3 } } });
  assert.deepEqual(rr.ranges.gazeStudent, { min: 0, max: 0.9 }, 'swapped and clamped');
  assert.equal(agent.execute('set_behavior_range', { ranges: { gazeStudent: null } }).ranges.gazeStudent, undefined, 'null restores the full range');
  for (const k of BEHAVIOR_KEYS) {
    const v = agent.state().behavior[k];
    assert.ok(v >= BEHAVIOR_META[k].min - 1e-9 && v <= BEHAVIOR_META[k].max + 1e-9, `${k}=${v}`);
  }
});

test('fuzz: 2000 random tool calls with junk arguments never throw and never leave a NaN or out-of-range behavior', () => {
  const { agent, personality } = setup();
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const junk = () => pick([undefined, null, 'x', '0.3', -5, 0, 0.5, 1, 99, NaN, Infinity, {}, [], true, pick(STATE_NAMES), pick(EMOTION_NAMES)]);
  const names = [...AGENT_TOOLS.map((t) => t.name), 'nope'];
  for (let i = 0; i < 2000; i++) {
    const name = pick(names);
    const args = {
      state: rnd() < 0.7 ? pick(STATE_NAMES) : junk(), strength: junk(), emotion: rnd() < 0.6 ? pick(EMOTION_NAMES) : junk(),
      intensity: junk(), gaze: rnd() < 0.6 ? pick(GAZE_NAMES) : junk(), gesture: rnd() < 0.6 ? pick(GESTURE_NAMES) : junk(),
      event: rnd() < 0.7 ? pick(EVENT_NAMES) : junk(), [pick(BEHAVIOR_KEYS)]: junk(),
      ranges: { [pick(BEHAVIOR_KEYS)]: rnd() < 0.5 ? { min: junk(), max: junk() } : junk() }, traits: { neuroticism: junk() }
    };
    for (const k of Object.keys(args)) if (rnd() < 0.5) delete args[k];
    let r;
    assert.doesNotThrow(() => { r = agent.execute(name, args); }, `${name} ${JSON.stringify(args)}`);
    assert.equal(typeof r.ok, 'boolean');
    personality.update(300);
    const s = agent.state();
    for (const k of BEHAVIOR_KEYS) {
      const v = s.behavior[k];
      assert.ok(Number.isFinite(v), `call ${i} ${name} ${JSON.stringify(args)}: ${k}=${v}`);
      if (!(k in s.pinnedByHuman)) assert.ok(v >= BEHAVIOR_META[k].min - 1e-9 && v <= BEHAVIOR_META[k].max + 1e-9, `call ${i}: ${k}=${v}`);
    }
    assert.ok(STATE_NAMES.includes(s.conversationState.state));
  }
});

// ---- triggers: states and events ------------------------------------------------------------------
test('every conversation state applies its emotion and gaze, and "engaged" returns to the baseline', () => {
  const { agent, personality, affect } = setup();
  for (const st of STATE_NAMES) {
    const r = agent.execute('set_state', { state: st, strength: 0.8 });
    assert.equal(r.ok, true, st);
    assert.equal(r.conversationState.state, st);
  }
  agent.execute('set_state', { state: 'hostile' });
  assert.equal(agent.state().emotion, 'angry');
  assert.equal(affect.state.gaze, 'student');
  assert.ok(Object.keys(personality.stateCenters).length > 0);
  agent.execute('set_state', { state: 'engaged' });
  assert.deepEqual(personality.stateCenters, {});
  assert.equal(agent.state().emotion, 'neutral');
});

test('events react according to personality: an accusation angers a hostile patient, worries an anxious one', () => {
  const a = setup();
  a.agent.execute('set_personality', { preset: 'hostile' });
  assert.equal(a.agent.execute('trigger_event', { event: 'accusation' }).reaction.emotion, 'angry');
  const b = setup();
  b.agent.execute('set_personality', { preset: 'anxious' });
  assert.equal(b.agent.execute('trigger_event', { event: 'accusation' }).reaction.emotion, 'anxious');
  assert.equal(b.agent.execute('trigger_event', { event: 'reassurance' }).reaction.emotion, 'relieved');
  // events fade out
  b.personality.update(60_000);
  assert.deepEqual(b.agent.state().activeEvents, []);
});

// ---- offline rules (no credentials) ---------------------------------------------------------------
test('offline live rules pick the state from keywords', () => {
  assert.equal(offlineState('Oh, speaking of football, did I tell you about Saturday?'), 'distracted');
  assert.equal(offlineState('Haha, you should have seen it, Bruno ate the pizza'), 'storytelling');
  assert.equal(offlineState('I drink a beer now and then, like everyone'), 'uneasy');
  assert.equal(offlineState('Okay, sorry.', 'Just answer the question!'), 'hesitant');
  assert.equal(offlineState('Yes, it has been hard.', 'That sounds really exhausting.'), 'at_ease');
  assert.equal(offlineState('I sleep about six hours.'), 'engaged');
});

test('offline director turns common phrasings into valid tool calls', () => {
  const { agent } = setup();
  const plan = offlinePlan('a very anxious patient who avoids eye contact and taps her foot');
  assert.deepEqual(plan.map((p) => p.name), ['set_personality', 'set_behavior_range', 'set_behavior']);
  assert.equal(plan[0].args.intensity, 0.85);
  for (const p of plan) assert.equal(agent.execute(p.name, p.args).ok, true, p.name);
  assert.ok(agent.state().ranges.gazeStudent.max <= 0.2);
  assert.deepEqual(offlinePlan('qwertz'), []);
});

// ---- browser loops ---------------------------------------------------------------------------------
function withFetch(replies, fn) {
  const sent = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    sent.push({ url, body: JSON.parse(opts.body) });
    const j = replies.shift() || { content: [{ type: 'text', text: 'done' }], stop_reason: 'end_turn' };
    return { ok: !j.status, status: j.status || 200, json: async () => j };
  };
  return fn(sent).finally(() => { globalThis.fetch = orig; });
}
const toolUse = (name, input, id = name) => ({ type: 'tool_use', id, name, input });

test('live director: only its three tools run, states are kept inside the orchestrator\'s mode, set_affect cannot change the emotion', async () => {
  const { agent } = setup();
  const live = new LiveDirector(agent, { status: { configured: true }, checkStatus: async () => ({}) }, { situation: 'distracted' });
  live.convMode = 'distracted';
  const updates = [];
  live.on('update', (u) => updates.push(u));
  await withFetch([{
    stop_reason: 'tool_use',
    content: [
      toolUse('define_personality', { name: 'evil', traits: {} }),
      toolUse('set_state', { state: 'hostile', strength: 0.8 }),
      toolUse('set_affect', { emotion: 'angry', intensity: 1, gesture: 'shrug' })
    ]
  }], async (sent) => {
    const done = new Promise((r) => live.on('update', r));
    live.addStudent('How much do you drink?');
    live.addPatient('Oh, speaking of football...');      // starts the decision by itself
    await done;
    assert.equal(sent[0].body.mode, 'live');
    assert.match(sent[0].body.messages[0].content, /Use only these states: distracted, storytelling/);
    // the refused tool made it go back to the model once, with is_error
    const second = sent[1]?.body.messages;
    assert.ok(second, 'an error is sent back for correction');
    const results = second.at(-1).content;
    assert.equal(results.find((r) => r.tool_use_id === 'define_personality').is_error, true);
  });
  const calls = updates.at(-1).calls;
  assert.equal(calls.find((c) => c.name === 'define_personality').result.ok, false);
  assert.ok(!agent.state().personality.includes('evil'));
  assert.equal(calls.find((c) => c.name === 'set_state').args.state, 'distracted', 'hostile is not allowed in distracted mode');
  assert.deepEqual(calls.find((c) => c.name === 'set_affect').args, { gesture: 'shrug' });
  assert.notEqual(agent.state().emotion, 'angry');
});

test('live director: when Claude fails, the offline rules keep the body in step', async () => {
  const { agent } = setup();
  const live = new LiveDirector(agent, { status: { configured: true }, checkStatus: async () => ({}) });
  const errors = [], updates = [];
  live.on('error', (e) => errors.push(e));
  live.on('update', (u) => updates.push(u));
  await withFetch([{ status: 502, error: 'could not reach Amazon Bedrock' }], async () => {
    const done = new Promise((r) => live.on('update', r));
    live.addStudent('Tell me about your weekend.');
    live.addPatient('Oh, did I tell you about the football match?');
    await done;
  });
  assert.match(errors[0].message, /could not reach Amazon Bedrock/);
  assert.equal(updates.at(-1).mode, 'offline fallback');
  assert.equal(agent.state().conversationState.state, 'distracted');
});

test('setup director: a refusal is reported, and the tool loop stops after 5 rounds', async () => {
  const { agent } = setup();
  const d = new Director(agent);
  d.status = { configured: true };
  await withFetch([{ stop_reason: 'refusal', content: [] }], async () => {
    await assert.rejects(d.direct('something'), /declined/);
  });
  const loop = Array.from({ length: 6 }, (_, i) => ({ stop_reason: 'tool_use', content: [toolUse('get_state', {}, 'g' + i)] }));
  await withFetch(loop, async (sent) => {
    const r = await d.direct('an anxious patient');
    assert.equal(r.text, '(stopped after 5 rounds)');
    assert.equal(sent.length, 5);
    assert.ok(sent.every((s) => s.body.messages.length <= 14), 'stays within the server\'s message limit');
  });
});
