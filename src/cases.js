/**
 * What the student sets up on the landing page (index.html), in three steps:
 *   1. patient     which avatar to load (key in PATIENTS, config.js)
 *   2. Big Five    each trait lower than usual / average / higher than usual
 *   3. situation   the difficult situation to train (body language preset: ranges, emotion, arms)
 * No three.js here: the landing page imports this file and should stay light.
 *
 * Options that are not modelled yet stay visible but disabled (`enabled: false`, AVAILABLE_LEVELS).
 * The 3D page is opened as consult.html?patient=<key>&extraversion=high&situation=<key>;
 * traits missing from the URL are average. The URL can be bookmarked or shared.
 */

export const PATIENT_OPTIONS = [
  { key: 'young-woman', title: 'Woman', who: 'No visible condition', image: '/landing/young-woman.jpg', enabled: true },
  { key: 'young-man', title: 'Man', who: 'No visible condition', image: '/landing/young-man.jpg', enabled: true },
  { key: 'man-wheelchair', title: 'Man in a wheelchair', who: 'Physical disability', image: '/landing/man-wheelchair.jpg', enabled: true }
];

export const TRAITS = [
  { key: 'openness', label: 'Openness', adjective: 'open' },
  { key: 'conscientiousness', label: 'Conscientiousness', adjective: 'conscientious' },
  { key: 'extraversion', label: 'Extraversion', adjective: 'extraverted' },
  { key: 'agreeableness', label: 'Agreeableness', adjective: 'agreeable' },
  { key: 'neuroticism', label: 'Neuroticism', adjective: 'neurotic' }
];

/** Three levels per trait. `value` is the 0..1 trait value used by personality.js. */
export const LEVELS = [
  { key: 'low', label: 'Lower than usual', value: 0.2 },
  { key: 'average', label: 'Average', value: 0.5 },
  { key: 'high', label: 'Higher than usual', value: 0.85 }
];

/**
 * Trait levels that can be picked today. Only a highly extraverted patient is modelled, so every other
 * trait is fixed at average. Add levels here once the patient prompt and body language support them.
 */
export const AVAILABLE_LEVELS = {
  openness: ['average'],
  conscientiousness: ['average'],
  extraversion: ['high'],
  agreeableness: ['average'],
  neuroticism: ['average']
};

/**
 * Difficult situations. `body` is the body-language part, in the format of Personality.define()
 * (personality.js) minus the traits, which come from step 2. `profile` tells the live director (agent.js)
 * who the patient is, so her body language can follow the live conversation with the ElevenLabs patient
 * agent (ai-patient-voice/, played as Mary Keller).
 */
export const SITUATIONS = [
  {
    key: 'distracted',
    label: 'Easily distracted',
    blurb: 'Talks a lot, drifts into anecdotes and loses the thread. Train steering the interview back to your question.',
    enabled: true,
    profile: 'Mary Keller, 34, event manager. Very sociable, extremely talkative, warm and humorous. Easily distracted: any keyword starts a chain of anecdotes, she comments on the room, glances at her buzzing phone and forgets the question. Once the therapist calmly names her tangents she stays clearly more focused, with only small tangents. Wants to be liked and plays problems down; never hostile. She came because her partner Lena suggested it; the topic is her drinking, which she minimises.',
    body: {
      description: 'easily distracted: looks around the room, restless hands, behaviour drifts a lot',
      ranges: { lookAround: { min: 0.5, max: 1 }, fidget: { min: 0.4, max: 1 } },
      variability: 0.45,
      default_emotion: 'neutral',
      default_intensity: 0.5
    }
  },
  {
    key: 'aggressive',
    label: 'Aggressive',
    blurb: 'Irritable and confrontational. Stares at you, sits with arms crossed, frowns and moves restlessly. Train staying calm and de-escalating.',
    enabled: true,
    profile: 'An irritable, confrontational patient who stares at the therapist, sits with arms crossed and moves restlessly. Show irritation in the body even when the words are mild; calm down only after real empathy.',
    body: {
      description: 'confrontational: irritable, stares, arms crossed, restless',
      ranges: { gazeStudent: { min: 0.75, max: 1 }, headMotion: { min: 0.5, max: 1 } },
      variability: 0.25,
      default_emotion: 'angry',
      default_intensity: 0.65,
      arms: 'crossed'
    }
  }
];

const enabled = (list, key) => list.find((x) => x.key === key && x.enabled);
// any level is accepted from the URL (handy for testing); the landing page only offers AVAILABLE_LEVELS
const level = (v) => (LEVELS.some((l) => l.key === v) ? v : 'average');

/** The setup pre-selected on the landing page. */
export function defaultSession() {
  return {
    patient: PATIENT_OPTIONS.find((p) => p.enabled).key,
    traits: Object.fromEntries(TRAITS.map((t) => [t.key, AVAILABLE_LEVELS[t.key][0]])),
    situation: SITUATIONS.find((s) => s.enabled).key
  };
}

/** The session in a URL's search params, or null if it names no known patient + situation. */
export function selectedSession(search = globalThis.location?.search ?? '') {
  const q = new URLSearchParams(search);
  const patient = enabled(PATIENT_OPTIONS, q.get('patient'));
  const situation = enabled(SITUATIONS, q.get('situation'));
  if (!patient || !situation) return null;
  return {
    patient: patient.key,
    traits: Object.fromEntries(TRAITS.map((t) => [t.key, level(q.get(t.key))])),
    situation: situation.key
  };
}

/** Link from the landing page into the 3D room. */
export function consultUrl(s) {
  const q = new URLSearchParams({ patient: s.patient });
  for (const t of TRAITS) if (s.traits[t.key] !== 'average') q.set(t.key, s.traits[t.key]);
  q.set('situation', s.situation);
  return `/consult.html?${q}`;
}

/** Short parts for summaries: { who, traits: ['more extraverted than usual'], situation: 'easily distracted' }. */
export function describeSession(s) {
  return {
    who: PATIENT_OPTIONS.find((p) => p.key === s.patient)?.title ?? 'Patient',
    traits: TRAITS.filter((t) => s.traits[t.key] !== 'average')
      .map((t) => `${s.traits[t.key] === 'high' ? 'more' : 'less'} ${t.adjective} than usual`),
    situation: SITUATIONS.find((x) => x.key === s.situation)?.label.toLowerCase() ?? ''
  };
}

/** Who she is, for the live director: the situation's profile plus the Big Five levels that differ from average. */
export function sessionProfile(s) {
  const x = SITUATIONS.find((y) => y.key === s.situation);
  const traits = describeSession(s).traits;
  return [x?.profile || x?.body.description || '', traits.length ? `Personality: ${traits.join(', ')}.` : ''].filter(Boolean).join(' ');
}

/** Personality definition for Personality.define(): Big Five from step 2 + body language of the situation. */
export function sessionPersonality(s) {
  const { body } = SITUATIONS.find((x) => x.key === s.situation);
  return {
    name: `session_${s.situation}`,
    ...body,
    traits: Object.fromEntries(TRAITS.map((t) => [t.key, LEVELS.find((l) => l.key === s.traits[t.key]).value]))
  };
}
