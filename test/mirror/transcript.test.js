import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTranscriptRecorder, instrumentVoice } from '../../src/mirror/transcript.js';

let n = 0;
const uuid = () => `id-${++n}`;
const clock = (start = Date.parse('2026-11-13T09:00:00Z')) => { let t = start; return () => new Date((t += 1000)); };

/** Same shape as src/voice.js: sayRecording() calls this.transcribe() then this.speak() (the echo). */
class FakeVoice {
  constructor({ transcript = 'Where does it hurt?', speakFails = false } = {}) { this.calls = []; this.transcript = transcript; this.speakFails = speakFails; }
  async speak(text) { this.calls.push(['speak', text]); if (this.speakFails) throw new Error('voice server error 503'); return String(text ?? '').trim() ? { text, source: 'demo' } : null; }
  async startRecording() { this.calls.push(['startRecording']); }
  async stopRecording() { return { size: 1 }; }
  async transcribe() { this.calls.push(['transcribe']); return { text: this.transcript, words: [] }; }
  async sayRecording(blob, { replyIn = 'her' } = {}) {
    const t = await this.transcribe(blob);
    if (!t.text) return { text: '', source: 'none' };
    if (replyIn === 'mine') return { text: t.text, source: 'your recording' };
    return this.speak(t.text);
  }
}

test('records nothing before start and after stop', () => {
  const r = createTranscriptRecorder({ uuid, now: clock() });
  assert.equal(r.addDoctor('hello?'), null);
  r.start();
  assert.ok(r.addDoctor('hello?'));
  r.stop();
  assert.equal(r.addPatient('late reply'), null);
  assert.equal(r.count, 1);
});

test('turns use the MIRROR TranscriptTurn shape and ignore empty text', () => {
  const r = createTranscriptRecorder({ uuid, now: clock() });
  r.start();
  r.addDoctor('  What brings you in today?  ');
  r.addDoctor('   ');
  r.addPatient('My chest feels tight.');
  const turns = r.turns();
  assert.equal(turns.length, 2);
  assert.deepEqual(Object.keys(turns[0]).sort(), ['speaker', 'text', 'timestamp', 'turn_id']);
  assert.equal(turns[0].text, 'What brings you in today?');
  assert.equal(turns[0].speaker, 'doctor');
  assert.equal(turns[1].speaker, 'patient');
  assert.match(turns[0].timestamp, /Z$/);
  assert.ok(turns[0].timestamp < turns[1].timestamp);
});

test('microphone: student speech is a doctor turn; the avatar echo is NOT a patient turn', async () => {
  const r = createTranscriptRecorder({ uuid, now: clock() });
  r.start();
  const v = instrumentVoice(new FakeVoice(), r, { now: clock() });
  await v.startRecording();
  const out = await v.sayRecording({}, { replyIn: 'her' });
  assert.deepEqual(out, { text: 'Where does it hurt?', source: 'demo' }, 'return value passes through');
  assert.deepEqual(v.calls.map((c) => c[0]), ['startRecording', 'transcribe', 'speak'], 'original behaviour unchanged');
  assert.deepEqual(r.turns().map((t) => [t.speaker, t.text]), [['doctor', 'Where does it hurt?']]);
});

test('microphone in "my voice" mode records only the doctor turn', async () => {
  const r = createTranscriptRecorder({ uuid, now: clock() });
  r.start();
  const v = instrumentVoice(new FakeVoice(), r);
  await v.startRecording();
  await v.sayRecording({}, { replyIn: 'mine' });
  assert.deepEqual(r.turns().map((t) => t.speaker), ['doctor']);
});

test('empty transcription records nothing', async () => {
  const r = createTranscriptRecorder({ uuid, now: clock() });
  r.start();
  const v = instrumentVoice(new FakeVoice({ transcript: '' }), r);
  await v.sayRecording({});
  assert.equal(r.count, 0);
});

test('speak() outside the echo is a patient turn; failed speech is not recorded and the error propagates', async () => {
  const r = createTranscriptRecorder({ uuid, now: clock() });
  r.start();
  const v = instrumentVoice(new FakeVoice(), r);
  await v.speak('It started this morning.');
  assert.deepEqual(r.turns().map((t) => [t.speaker, t.text]), [['patient', 'It started this morning.']]);

  const failing = instrumentVoice(new FakeVoice({ speakFails: true }), r);
  await assert.rejects(failing.speak('Never heard'), /voice server error/);
  assert.equal(r.count, 1);
});

test('live conversation: student/patient events become turns; a correction edits the interrupted patient reply only', async () => {
  const { listenToConversation } = await import('../../src/mirror/transcript.js');
  const ls = {};
  const conv = { on: (n, fn) => { (ls[n] ||= new Set()).add(fn); return () => ls[n].delete(fn); }, emit: (n, d) => ls[n]?.forEach((f) => f(d)) };
  const r = createTranscriptRecorder({ uuid, now: clock() });
  conv.emit('student', 'before start');
  r.start();
  const off = listenToConversation(conv, r);
  conv.emit('student', 'Hello, what brings you in today?');
  conv.emit('patient', 'Oh, it is a long story, you see my partner Lena thinks that');
  conv.emit('student', 'Sorry to interrupt, how much do you drink?');
  conv.emit('correction', 'Oh, it is a long story');
  conv.emit('student', '   ');
  assert.deepEqual(r.turns().map((t) => [t.speaker, t.text]), [
    ['doctor', 'Hello, what brings you in today?'],
    ['patient', 'Oh, it is a long story'],
    ['doctor', 'Sorry to interrupt, how much do you drink?']
  ]);
  off();
  conv.emit('patient', 'after unsubscribe');
  assert.equal(r.count, 3);
});

test('instrumentVoice is idempotent', async () => {
  const r = createTranscriptRecorder({ uuid, now: clock() });
  r.start();
  const v = new FakeVoice();
  instrumentVoice(v, r);
  instrumentVoice(v, r);
  await v.speak('Once.');
  assert.equal(r.count, 1);
});
