/**
 * Records what actually happens in the existing PsyTrain interaction as MIRROR transcript turns
 * ({ turn_id, timestamp, speaker: 'doctor' | 'patient', text }). Nothing is generated or inferred.
 *
 *   doctor  <- the student's microphone recording, transcribed by the existing voice.transcribe()
 *   doctor  <- a typed student question (text fallback)
 *   doctor  <- LiveConversation 'student' event (the ElevenLabs patient agent's speech recognition)
 *   patient <- LiveConversation 'patient' event (what the patient agent said)
 *   (edit)  <- LiveConversation 'correction' event: the agent's text of an interrupted reply replaces it
 *   patient <- text the avatar speaks through voice.speak() (the ?debug=1 panel "Speak text")
 *   (none)  <- the avatar repeating the student's own words (voice.sayRecording echo): not a patient reply
 */

const defaultUuid = () => globalThis.crypto.randomUUID();

export function createTranscriptRecorder({ now = () => new Date(), uuid = defaultUuid } = {}) {
  const turns = [];
  const listeners = new Set();
  let active = false;

  const add = (speaker, text, at) => {
    text = String(text ?? '').trim();
    if (!active || !text) return null;
    const turn = { turn_id: uuid(), timestamp: (at ?? now()).toISOString(), speaker, text };
    turns.push(turn);
    listeners.forEach((fn) => fn(turn, turns.length));
    return turn;
  };

  return {
    start() { active = true; },
    stop() { active = false; },
    get active() { return active; },
    addDoctor: (text, at) => add('doctor', text, at),
    addPatient: (text, at) => add('patient', text, at),
    /**
     * Replace the text of the most recent patient turn with the agent's corrected (interrupted) reply.
     * The student's next transcript may already have arrived, so search back; doctor turns are never edited.
     */
    correctLastPatient(text) {
      text = String(text ?? '').trim();
      if (!active || !text) return null;
      for (let i = turns.length - 1; i >= 0; i--) {
        if (turns[i].speaker !== 'patient') continue;
        turns[i].text = text;
        listeners.forEach((fn) => fn(turns[i], turns.length));
        return turns[i];
      }
      return null;
    },
    turns: () => turns.map((t) => ({ ...t })),
    get count() { return turns.length; },
    onTurn(fn) { listeners.add(fn); return () => listeners.delete(fn); }
  };
}

/** Observe PsyTrain's LiveConversation through its public on() events (conversation.js is not modified). */
export function listenToConversation(conversation, recorder) {
  if (!conversation?.on) return () => {};
  const offs = [
    conversation.on('student', (t) => recorder.addDoctor(t)),
    conversation.on('patient', (t) => recorder.addPatient(t)),
    conversation.on('correction', (t) => recorder.correctLastPatient(t))
  ];
  return () => offs.forEach((off) => off?.());
}

/**
 * Wrap the existing Voice instance's methods (instance properties shadow the prototype; voice.js is
 * not modified). Arguments, return values and errors pass through unchanged.
 */
export function instrumentVoice(voice, recorder, { now = () => new Date() } = {}) {
  if (!voice || voice.__mirrorInstrumented) return voice;
  const orig = {
    speak: voice.speak,
    startRecording: voice.startRecording,
    transcribe: voice.transcribe,
    sayRecording: voice.sayRecording
  };
  let echoDepth = 0;           // > 0 while sayRecording() replays the student's words through the avatar
  let recordingStartedAt = null;

  voice.startRecording = async function (...args) {
    const at = now();
    const result = await orig.startRecording.apply(this, args);
    recordingStartedAt = at;   // the student's utterance starts here
    return result;
  };

  voice.transcribe = async function (...args) {
    const result = await orig.transcribe.apply(this, args);
    recorder.addDoctor(result?.text, recordingStartedAt ?? now());
    recordingStartedAt = null;
    return result;
  };

  voice.sayRecording = async function (...args) {
    echoDepth++;
    try { return await orig.sayRecording.apply(this, args); } finally { echoDepth--; }
  };

  voice.speak = async function (text, ...rest) {
    const at = now();
    const isEcho = echoDepth > 0;
    const result = await orig.speak.call(this, text, ...rest);
    if (!isEcho && result) recorder.addPatient(text, at);   // result is null when nothing was spoken
    return result;
  };

  voice.__mirrorInstrumented = true;
  return voice;
}
