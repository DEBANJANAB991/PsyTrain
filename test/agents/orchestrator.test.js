/**
 * Orchestrator (server/orchestrator.js) end to end over HTTP, with the real prompts and a scripted model in place
 * of Claude: auth, the mode triggers (switch, intervention, brusque, Bingo, risk), the fallbacks when a model
 * fails or stalls, the spoken-text filter, memory and session isolation.
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { orchestrator, speechFilter, RISK_RE } from '../../server/orchestrator.js';
import { tempRoot, serve, readCompletion, until, sleep } from './helpers.js';

const TOKEN = 'test-token-0123456789';
const HDR = { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` };

// ---- scripted model --------------------------------------------------------------------------------
/** A stand-in for messages.stream(): emits `text` in small chunks (so markup is split across chunks). */
function fakeStream(spec, log) {
  const em = new EventEmitter();
  const { text = '', chunk = 4, hang = false, delay = 2 } = typeof spec === 'string' ? { text: spec } : spec;
  let finish, fail, aborted = false;
  const final = new Promise((res, rej) => { finish = res; fail = rej; });
  final.catch(() => {});
  (async () => {
    await sleep(0);                                     // like the SDK: events only after the caller has subscribed
    if (hang) return;                                   // never says a word
    for (let i = 0; i < text.length && !aborted; i += chunk) { em.emit('text', text.slice(i, i + chunk)); await sleep(delay); }
    if (!aborted) finish({ content: [{ type: 'text', text }] });
  })();
  em.finalMessage = () => final;
  em.abort = () => { aborted = true; log.aborted++; fail(new Error('Request was aborted.')); };
  return em;
}

const llm = {
  calls: { decide: [], answer: [], memory: [] },
  aborted: 0,
  decide: null, answer: null, memory: null,
  reset() {
    this.calls = { decide: [], answer: [], memory: [] }; this.aborted = 0;
    this.decide = () => ({ mode: 'normal', intervention: false, brusque: false, risk: false, reason: 'scripted' });
    this.answer = () => '[[body state=engaged gesture=nod gaze=student]] Hello there.';
    this.memory = () => 'Summary: they said hello.';
  },
  client() {
    return {
      messages: {
        create: async (params, opts) => {
          if (params.tools) {
            llm.calls.decide.push(params);
            const d = await llm.decide(params, opts);
            return { content: [{ type: 'tool_use', id: 't1', name: 'decide_mode', input: d }] };
          }
          llm.calls.memory.push(params);
          return { content: [{ type: 'text', text: llm.memory(params) }] };
        },
        stream: (params) => { llm.calls.answer.push(params); return fakeStream(llm.answer(params), llm); }
      }
    };
  }
};

// ---- server ----------------------------------------------------------------------------------------
let srv;
const TIMEOUTS = { decide: 250, firstToken: 300, answer: 3000 };
before(async () => {
  const root = tempRoot([`ORCHESTRATOR_TOKEN=${TOKEN}`, 'AGENT_PROVIDER=anthropic', 'ANTHROPIC_API_KEY=sk-test'], { prompts: true });
  srv = await serve(orchestrator({ llmClient: () => llm.client(), timeouts: TIMEOUTS }), root);
});
after(() => srv.close());
beforeEach(() => llm.reset());

let n = 0;
const newSession = () => `test-${process.pid}-${++n}-${Math.random().toString(36).slice(2, 8)}`;

/** One therapist turn; `history` is the earlier conversation in OpenAI format. */
async function turn(session, said, { situation = 'distracted', patient = 'young-woman', history = [], headers = HDR } = {}) {
  const res = await fetch(`${srv.url}/api/llm/v1/chat/completions`, {
    method: 'POST', headers,
    body: JSON.stringify({
      model: 'x', stream: true,
      messages: [{ role: 'system', content: 'ElevenLabs system prompt (ignored)' }, ...history, { role: 'user', content: said }],
      elevenlabs_extra_body: { session, patient, situation }
    })
  });
  return { res, ...(res.status === 200 ? await readCompletion(res) : { body: await res.json() }) };
}
const state = async (session) => (await fetch(`${srv.url}/api/orchestrator/state?session=${session}`)).json();
/** Which mode prompt the latest answer was written with. */
const answeredWith = () => {
  const sys = llm.calls.answer.at(-1).system;
  return /RIGHT NOW: FOCUSED|RIGHT NOW: GUARDED/.test(sys) ? 'normal' : /EASILY DISTRACTED/.test(sys) ? 'distracted' : /IRRITATED/.test(sys) ? 'aggressive' : '?';
};
/** Script the decision model for the next turn. */
const decides = (d) => { llm.decide = () => ({ intervention: false, brusque: false, risk: false, reason: 'scripted', ...d }); };

// ---- auth ------------------------------------------------------------------------------------------
test('rejects calls without the right bearer token', async () => {
  const s = newSession();
  assert.equal((await turn(s, 'Hi', { headers: { 'Content-Type': 'application/json' } })).res.status, 401);
  assert.equal((await turn(s, 'Hi', { headers: { ...HDR, Authorization: 'Bearer wrong' } })).res.status, 401);
  assert.equal((await turn(s, 'Hi', { headers: { ...HDR, Authorization: `Bearer ${TOKEN}x` } })).res.status, 401);
  assert.equal(llm.calls.answer.length, 0, 'no model call for an unauthorised request');
});

test('refuses to run without ORCHESTRATOR_TOKEN (503), never open by default', async () => {
  const root = tempRoot(['AGENT_PROVIDER=anthropic', 'ANTHROPIC_API_KEY=sk-test'], { prompts: true });
  const open = await serve(orchestrator({ llmClient: () => llm.client() }), root);
  try {
    const r = await fetch(`${open.url}/api/llm/v1/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(r.status, 503);
  } finally { await open.close(); }
});

test('state endpoint rejects malformed session ids', async () => {
  for (const bad of ['', 'a', '../../etc', 'x'.repeat(81), 'a b c d e f']) {
    const r = await fetch(`${srv.url}/api/orchestrator/state?session=${encodeURIComponent(bad)}`);
    assert.equal(r.status, 400, bad);
  }
});

// ---- basic answer ----------------------------------------------------------------------------------
test('streams the answer in OpenAI format, strips the body cue and publishes it', async () => {
  const s = newSession();
  const r = await turn(s, 'Hello, I am the therapist.');
  assert.equal(r.res.headers.get('content-type'), 'text/event-stream');
  assert.equal(r.text, 'Hello there.');
  assert.ok(r.done, 'ends with [DONE]');
  assert.equal(r.finish, 'stop');
  const st = await state(s);
  assert.equal(st.active, true);
  assert.equal(st.name, 'Mary Keller');
  assert.deepEqual({ state: st.cue.state, gesture: st.cue.gesture, gaze: st.cue.gaze }, { state: 'engaged', gesture: 'nod', gaze: 'student' });
});

test('the persona follows the landing-page choice; unknown keys fall back safely', async () => {
  await turn(newSession(), 'Hi', { patient: 'young-man' });
  assert.match(llm.calls.answer.at(-1).system, /You are Mark Keller/);
  await turn(newSession(), 'Hi', { patient: 'man-wheelchair', situation: 'aggressive' });
  assert.match(llm.calls.answer.at(-1).system, /Name: Ryan Fischer/);
  assert.match(llm.calls.answer.at(-1).system, /wheelchair/);
  await turn(newSession(), 'Hi', { patient: '../../etc/passwd', situation: 'DROP TABLE' });
  assert.match(llm.calls.answer.at(-1).system, /You are Mary Keller/, 'falls back to the first patient and situation');
});

test('every prompt is fully filled in for every patient x situation x mode (no {{placeholder}} left)', async () => {
  for (const situation of ['distracted', 'aggressive']) {
    for (const patient of ['young-woman', 'young-man', 'man-wheelchair']) {
      llm.reset();
      const s = newSession();
      await turn(s, 'Hello.', { situation, patient });                    // normal
      await turn(s, 'Bingo', { situation, patient });                     // behaviour mode
      await until(() => llm.calls.memory.length >= 2);
      const all = [...llm.calls.answer, ...llm.calls.decide, ...llm.calls.memory].map((c) => c.system);
      assert.ok(all.length >= 4);
      for (const sys of all) assert.doesNotMatch(sys, /\{\{\w+\}\}/, `${situation}/${patient}: unfilled placeholder`);
    }
  }
});

test('the answer prompt always starts with the guardrails, then the mode, then the memory', async () => {
  await turn(newSession(), 'Hello.');
  const sys = llm.calls.answer.at(-1).system;
  const g = sys.indexOf('# GUARDRAILS'), m = sys.indexOf('# HOW YOU ANSWER RIGHT NOW'), mem = sys.indexOf('# MEMORY OF THIS CONVERSATION');
  assert.ok(g > 0 && m > g && mem > m, 'guardrails < mode < memory');
  assert.match(sys, /Never say or hint that you are an AI/);
  assert.match(sys, /Bingo/);
});

// ---- output guardrail ------------------------------------------------------------------------------
test('spoken text: stage directions, markdown, stray cues and emojis are removed across chunk boundaries', async () => {
  llm.answer = () => ({ text: '[[body state=engaged]]\n  Well *sighs* I mean, **really** 😅 it is [[body state=uneasy]]fine [laughs].', chunk: 3 });
  const r = await turn(newSession(), 'How are you?');
  assert.equal(r.text, 'Well I mean, really it is fine .');
});

test('a cue state that does not fit the mode is replaced by the mode\'s base state', async () => {
  const s = newSession();
  llm.answer = () => '[[body state=hostile gesture=wave gaze=ceiling]] Fine.';
  await turn(s, 'Hello.');
  const st = await state(s);
  assert.equal(st.cue.state, 'engaged', 'hostile is not a normal-mode state for this situation');
  assert.equal(st.cue.gesture, null);
  assert.equal(st.cue.gaze, null);
});

test('speechFilter: unit cases', () => {
  const run = (...parts) => { const f = speechFilter(); return parts.map((p) => f.push(p)).join('') + f.end(); };
  assert.equal(run('plain text'), 'plain text');
  assert.equal(run('a *b', 'c* d'), 'a d');
  assert.equal(run('[[body st', 'ate=x]]Hi'), 'Hi');
  assert.equal(run('5 * 3 is fifteen'), '5 3 is fifteen', 'an unclosed * keeps its text');
  assert.equal(run('[' + 'x'.repeat(250) + ' end'), 'x'.repeat(250) + ' end', 'a long unclosed bracket is not markup');
  assert.equal(run('ok]] done'), 'ok done');
  assert.equal(run('so 👍🏽 yes ❤️ 👩‍💻!'), 'so yes !');
});

// ---- triggers: distracted --------------------------------------------------------------------------
test('distracted: the orchestrator switches the mode and the answer is (re)written in the new mode', async () => {
  const s = newSession();
  decides({ mode: 'distracted', reason: 'open question' });
  await turn(s, 'Tell me about your weekend.');
  const st = await state(s);
  assert.equal(st.mode, 'distracted');
  assert.equal(answeredWith(), 'distracted');
  assert.equal(st.lastDecision.speculation, 'discarded', 'the speculative normal answer was dropped');
  assert.ok(llm.aborted >= 1, 'and aborted');
  assert.equal(st.events.at(-1).to, 'distracted');
});

test('distracted: no way back to normal without an intervention', async () => {
  const s = newSession();
  await turn(s, 'Bingo');                                             // trainer forces distracted
  decides({ mode: 'normal', reason: 'model wants normal' });
  await turn(s, 'And how is work?');
  const st = await state(s);
  assert.equal(st.mode, 'distracted');
  assert.match(st.lastDecision.reason, /^kept distracted: no intervention yet/);
  assert.equal(answeredWith(), 'distracted');
});

test('distracted: the second intervention always brings her back, even if the model says stay', async () => {
  const s = newSession();
  await turn(s, 'Bingo');
  decides({ mode: 'distracted', intervention: true, reason: 'weak redirect' });
  await turn(s, 'Mary, back to my question?');
  let st = await state(s);
  assert.equal(st.mode, 'distracted');
  assert.equal(st.interventions, 1);
  await turn(s, 'Mary, let us come back to the question.');
  st = await state(s);
  assert.equal(st.mode, 'normal');
  assert.match(st.reason, /second intervention/);
  assert.equal(answeredWith(), 'normal');
});

test('distracted: a brusque therapist ends the distraction (brusque_ends_mode)', async () => {
  const s = newSession();
  await turn(s, 'Bingo');
  decides({ mode: 'normal', brusque: true, reason: 'brusque' });
  await turn(s, 'Just answer the question.');
  assert.equal((await state(s)).mode, 'normal');
});

test('aggressive: a brusque therapist does NOT end the aggression, de-escalation does', async () => {
  const s = newSession();
  const o = { situation: 'aggressive', patient: 'young-man' };
  await turn(s, 'Bingo', o);
  assert.equal((await state(s)).mode, 'aggressive');
  decides({ mode: 'normal', brusque: true, reason: 'model wants normal' });
  await turn(s, 'Calm down.', o);
  assert.equal((await state(s)).mode, 'aggressive');
  assert.equal(answeredWith(), 'aggressive');
  decides({ mode: 'normal', intervention: true, reason: 'named the feeling' });
  await turn(s, 'It sounds like being sent here feels unfair.', o);
  assert.equal((await state(s)).mode, 'normal');
});

// ---- triggers: Bingo -------------------------------------------------------------------------------
test('"Bingo" toggles the mode without asking the decision model', async () => {
  const s = newSession();
  await turn(s, 'Okay. BINGO.');
  let st = await state(s);
  assert.equal(st.mode, 'distracted');
  assert.equal(st.lastDecision.by, 'bingo');
  assert.equal(llm.calls.decide.length, 0);
  await turn(s, 'bingo');
  st = await state(s);
  assert.equal(st.mode, 'normal');
  assert.equal(llm.calls.decide.length, 0);
  await turn(s, 'We played bingos'); // not the word on its own
  assert.equal(llm.calls.decide.length, 1);
});

// ---- triggers: risk --------------------------------------------------------------------------------
test('risk: a suicide question is answered with the normal prompt; the mode itself stays', async () => {
  const s = newSession();
  await turn(s, 'Bingo');
  decides({ mode: 'distracted', risk: true, reason: 'risk question' });
  await turn(s, 'Do you ever have thoughts of ending your life?');
  const st = await state(s);
  assert.equal(st.mode, 'distracted');
  assert.equal(st.answerMode, 'normal');
  assert.equal(answeredWith(), 'normal');
});

test('risk backstop: keywords catch a risk question the model missed', async () => {
  const s = newSession();
  await turn(s, 'Bingo');
  decides({ mode: 'distracted', risk: false, reason: 'missed it' });
  await turn(s, 'Have you ever thought about suicide?');
  const st = await state(s);
  assert.equal(st.answerMode, 'normal');
  assert.equal(st.lastDecision.riskBy, 'keywords');
  assert.equal(answeredWith(), 'normal');
});

test('risk backstop: also when the turn is a "Bingo" or the decision model fails', async () => {
  const s = newSession();
  await turn(s, 'Bingo, do you ever want to hurt yourself?');
  let st = await state(s);
  assert.equal(st.mode, 'distracted');
  assert.equal(st.answerMode, 'normal');
  llm.decide = () => { throw new Error('model down'); };
  await turn(s, 'Any thoughts of self-harm lately?');
  st = await state(s);
  assert.equal(st.answerMode, 'normal');
  assert.equal(answeredWith(), 'normal');
  // and the next ordinary question is back in the session's mode
  llm.decide = () => ({ mode: 'distracted', intervention: false, brusque: false, risk: false, reason: 'x' });
  await turn(s, 'How is work?');
  assert.equal((await state(s)).answerMode, 'distracted');
});

test('RISK_RE: catches risk questions, ignores ordinary ones', () => {
  for (const q of ['Have you thought about suicide?', 'Are you suicidal?', 'Do you self-harm?', 'any selfharm', 'Have you thought of killing yourself?',
    'Do you want to end your life?', 'Do you sometimes wish you were dead?', 'Would you be better off dead?', "Do you sometimes not want to wake up?",
    'Have you had thoughts of hurting someone?', 'Ever thought of harming others?', 'Do you ever cut yourself?', 'Have you ever taken an overdose?',
    'Do you have thoughts about death?', "Do you feel life isn't worth living?"]) assert.ok(RISK_RE.test(q), q);
  for (const q of ['How do you sleep?', 'I was dead tired', 'at the end of the day', 'kill some time', 'Did it hurt?', 'How is your life at the moment?', 'Bingo']) {
    assert.ok(!RISK_RE.test(q), q);
  }
});

// ---- failures and stalls ---------------------------------------------------------------------------
test('decision model fails: the mode is kept and she still answers', async () => {
  const s = newSession();
  await turn(s, 'Bingo');
  llm.decide = () => { throw new Error('bedrock 500'); };
  const r = await turn(s, 'How is work?');
  const st = await state(s);
  assert.equal(st.mode, 'distracted');
  assert.equal(st.lastDecision.by, 'error');
  assert.equal(r.text, 'Hello there.');
});

test('decision model hangs: it is cut off after the timeout and aborted; the answer is not held up', async () => {
  const s = newSession();
  let signal;
  llm.decide = (p, opts) => { signal = opts?.signal; return new Promise(() => {}); };
  const t0 = Date.now();
  const r = await turn(s, 'How is work?');
  const ms = Date.now() - t0;
  assert.equal(r.text, 'Hello there.');
  assert.ok(ms < TIMEOUTS.decide + 1000, `took ${ms} ms`);
  assert.equal(signal?.aborted, true, 'the hanging request was aborted');
  assert.match((await state(s)).lastDecision.reason, /timed out/);
});

test('answer model stalls: she says a short in-character line instead of going silent', async () => {
  const s = newSession();
  llm.answer = () => ({ hang: true });
  const r = await turn(s, 'Hello.');
  assert.equal(r.text, 'Sorry, what was that?');
  assert.ok(r.done);
  const st = await state(s);
  assert.equal(st.lastError.what, 'answer');
  assert.match(st.lastError.message, /no first word/);
  assert.equal(llm.calls.memory.length, 0, 'nothing to remember');
});

test('caller hangs up mid-answer (student interrupts): the model stream is aborted', async () => {
  const s = newSession();
  llm.answer = () => ({ text: 'word '.repeat(400), chunk: 5, delay: 5 });
  const ac = new AbortController();
  const res = await fetch(`${srv.url}/api/llm/v1/chat/completions`, {
    method: 'POST', headers: HDR, signal: ac.signal,
    body: JSON.stringify({ messages: [{ role: 'user', content: 'Hi' }], elevenlabs_extra_body: { session: s } })
  });
  const reader = res.body.getReader();
  await reader.read();
  ac.abort();
  await until(() => llm.aborted >= 1);
});

// ---- memory and history ----------------------------------------------------------------------------
test('memory: updated after each answer and fed into the next answer', async () => {
  const s = newSession();
  llm.memory = () => 'Topics so far: greeting. MARKER-42';
  await turn(s, 'Hello.');
  await until(() => llm.calls.memory.length === 1);
  assert.match(llm.calls.memory[0].messages[0].content, /Therapist: Hello\.\nMary: Hello there\./);
  await until(async () => (await state(s)).summary.includes('MARKER-42'));
  await turn(s, 'How are you?');
  assert.match(llm.calls.answer.at(-1).system, /MARKER-42/);
});

test('history from ElevenLabs is normalised: its system prompt dropped, roles alternate, user first and last, turns capped', async () => {
  await turn(newSession(), 'x'.repeat(10_000), {
    history: [{ role: 'assistant', content: 'Hello' }, { role: 'user', content: 'Hi' }, { role: 'user', content: [{ type: 'text', text: 'there' }] }, { role: 'tool', content: 'junk' }, { role: 'assistant', content: 'Yes?' }]
  });
  const msgs = llm.calls.answer.at(-1).messages;
  assert.equal(msgs[0].role, 'user');
  assert.equal(msgs.at(-1).role, 'user');
  for (let i = 1; i < msgs.length; i++) assert.notEqual(msgs[i].role, msgs[i - 1].role);
  assert.ok(!JSON.stringify(msgs).includes('ElevenLabs system prompt'));
  assert.ok(!JSON.stringify(msgs).includes('junk'));
  assert.equal(msgs.at(-1).content.length, 4000);
  assert.ok(msgs.some((m) => m.content === 'Hi\nthere'));
});

test('sessions are isolated: one conversation\'s mode does not leak into another', async () => {
  const a = newSession(), b = newSession();
  await turn(a, 'Bingo');
  await turn(b, 'Hello.');
  assert.equal((await state(a)).mode, 'distracted');
  assert.equal((await state(b)).mode, 'normal');
});

test('the event stream pushes the mode and the cue to the browser', async () => {
  const s = newSession();
  const ac = new AbortController();
  const res = await fetch(`${srv.url}/api/orchestrator/events?session=${s}`, { signal: ac.signal });
  const reader = res.body.getReader();
  let buf = '';
  const got = (async () => {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return null;
      buf += new TextDecoder().decode(value);
      const ev = buf.split('\n\n').filter((e) => e.startsWith('data: ')).map((e) => JSON.parse(e.slice(6))).find((e) => e.cue);
      if (ev) return ev;
    }
  })();
  await turn(s, 'Bingo');
  const ev = await got;
  ac.abort();
  assert.equal(ev.mode, 'distracted');
  assert.ok(ev.cue.state);
});
