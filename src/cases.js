/**
 * Patients offered on the landing page (index.html) and the behaviours a student can pick for them.
 * No three.js here: the landing page imports this file and should stay light.
 *
 *   patient    key in PATIENTS (config.js): which avatar and visible conditions to load
 *   behaviors  how the patient acts in this consultation. `personality` is a personality definition in the
 *              format of Personality.define() (personality.js): Big Five traits, behaviour ranges, the
 *              emotion she starts in and her arm posture. It drives face, posture, gaze and body language;
 *              the voice is not affected.
 *   enabled    false = shown on the landing page as "coming soon"
 *
 * The 3D page is opened as consult.html?case=<key>&behavior=<key>&patient=<patient>.
 */

// Big Five profile of an outgoing, expressive person; the behaviours below start from it
const EXTROVERT = { openness: 0.7, conscientiousness: 0.5, extraversion: 0.85, agreeableness: 0.6, neuroticism: 0.4 };

export const CASES = [
  {
    key: 'extrovert',
    title: 'Extrovert patient',
    who: 'Young woman',
    image: '/landing/young-woman.jpg',
    blurb: 'Outgoing and expressive by nature. Choose how she comes across in today\'s consultation.',
    patient: 'young-woman',
    enabled: true,
    behaviors: {
      shy: {
        label: 'Shy',
        blurb: 'Embarrassed and hesitant. Looks down and away, keeps her hands clasped, fidgets, and only holds eye contact for moments.',
        personality: {
          description: 'outgoing by nature but shy and embarrassed here: looks down, little eye contact, clasped hands, fidgets',
          traits: { ...EXTROVERT, extraversion: 0.7, agreeableness: 0.7, neuroticism: 0.65 },
          ranges: { gazeStudent: { min: 0.15, max: 0.55 }, lookAround: { min: 0.1, max: 0.5 }, fidget: { min: 0.3, max: 0.8 }, headMotion: { min: 0.2, max: 0.6 } },
          variability: 0.3,
          default_emotion: 'withdrawn',
          default_intensity: 0.55,
          arms: 'clasped'
        }
      },
      aggressive: {
        label: 'Aggressive',
        blurb: 'Irritable and confrontational. Stares at you, sits with her arms crossed, frowns, and moves restlessly.',
        personality: {
          description: 'outgoing and confrontational: irritable, stares, arms crossed, restless',
          traits: { ...EXTROVERT, extraversion: 0.9, agreeableness: 0.1, neuroticism: 0.65, conscientiousness: 0.35 },
          ranges: { gazeStudent: { min: 0.75, max: 1 }, headMotion: { min: 0.5, max: 1 } },
          variability: 0.25,
          default_emotion: 'angry',
          default_intensity: 0.65,
          arms: 'crossed'
        }
      }
    }
  },
  { key: 'young-man', title: 'Young man', who: 'No visible condition', image: '/landing/young-man.jpg', enabled: false },
  { key: 'wheelchair', title: 'Man in a wheelchair', who: 'Physical disability', image: '/landing/man-wheelchair.jpg', enabled: false },
  { key: 'face-paint', title: 'Red paint on face', who: 'Young woman', image: '/landing/face-paint.jpg', enabled: false },
  { key: 'head-wound', title: 'Head injury', who: 'Young man', image: '/landing/head-wound.jpg', enabled: false },
  { key: 'child', title: 'Child', who: '3D model not available yet', image: null, enabled: false },
  { key: 'older-man', title: 'Older man', who: '3D model not available yet', image: null, enabled: false },
  { key: 'older-woman', title: 'Older woman', who: '3D model not available yet', image: null, enabled: false }
];

/** The enabled case + behaviour named in a URL's search params, or null. */
export function selectedCase(search = globalThis.location?.search ?? '') {
  const q = new URLSearchParams(search);
  const c = CASES.find((x) => x.key === q.get('case') && x.enabled);
  const b = c?.behaviors?.[q.get('behavior')];
  return c && b ? { caseDef: c, behaviorKey: q.get('behavior'), behavior: b } : null;
}

/** Link from the landing page into the 3D room. */
export function consultUrl(caseDef, behaviorKey) {
  const q = new URLSearchParams({ case: caseDef.key, behavior: behaviorKey, patient: caseDef.patient });
  return `/consult.html?${q}`;
}
