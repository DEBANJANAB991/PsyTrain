// All tunable numbers live here: room layout, seated pose, emotions, body-language profiles.
// Angles are radians (TalkingHead pose format: 'Bone.rotation': {x,y,z}).

export const ROOM = {
  eyeHeight: 1.2,          // seated eye level of the student (m); XR 'local' space is lifted to this
  patientDistance: 1.4,    // student eye -> patient (m)
  seatHeight: 0.46,        // chair seat surface height (m)
  width: 4.5, depth: 5, height: 2.7
};

export const AVATAR = {
  url: '/avatars/mpfb.glb',
  body: 'F',
  seatOffset: { x: 0, y: 0, z: 0 }
};

// ---------------------------------------------------------------------------------------------
// Seated base pose (derived from TalkingHead's 'straight' pose with new hips/legs/feet/arms).
// ---------------------------------------------------------------------------------------------
export const SEATED_POSE = {
  'Hips.position': { x: 0, y: 0.60, z: 0 },
  'Hips.rotation': { x: 0.0, y: 0, z: 0 },
  'Spine.rotation': { x: -0.05, y: 0, z: 0 },
  'Spine1.rotation': { x: -0.02, y: 0, z: 0 },
  'Spine2.rotation': { x: 0.02, y: 0, z: 0 },
  'Neck.rotation': { x: 0.05, y: 0, z: 0 },
  'Head.rotation': { x: 0.03, y: 0, z: 0 },
  'LeftUpLeg.rotation': { x: -1.5, y: -0.08, z: 3.1 },
  'RightUpLeg.rotation': { x: -1.5, y: 0.08, z: -3.1 },
  'LeftLeg.rotation': { x: -1.5, y: 0, z: 0 },
  'RightLeg.rotation': { x: -1.5, y: 0, z: 0 },
  'LeftFoot.rotation': { x: 1.4, y: 0, z: 0 },
  'RightFoot.rotation': { x: 1.4, y: 0, z: 0 }
};

// Arm / hand placements. 'rest' = hands on thighs. Applied on top of SEATED_POSE.
export const ARMS = {
  rest: {
    'LeftArm.rotation': { x: 1.0, y: 0.75, z: -0.1 },
    'RightArm.rotation': { x: 1.0, y: -0.75, z: 0.1 },
    'LeftForeArm.rotation': { x: 0, y: 0, z: 1.15 },
    'RightForeArm.rotation': { x: 0, y: 0, z: -1.15 }
  },
  // hands held together in the lap
  clasped: {
    'LeftArm.rotation': { x: 1.0, y: 1.0, z: -0.1 },
    'RightArm.rotation': { x: 1.0, y: -1.0, z: 0.1 },
    'LeftForeArm.rotation': { x: 0, y: 0, z: 1.75 },
    'RightForeArm.rotation': { x: 0, y: 0, z: -1.75 }
  },
  // forearms folded across the belly
  crossed: {
    'LeftArm.rotation': { x: 1.0, y: 1.0, z: 0.4 },
    'RightArm.rotation': { x: 1.0, y: -1.0, z: -0.4 },
    'LeftForeArm.rotation': { x: 0, y: 0, z: 1.9 },
    'RightForeArm.rotation': { x: 0, y: 0, z: -1.9 }
  }
};

// ---------------------------------------------------------------------------------------------
// Emotions
// ---------------------------------------------------------------------------------------------
export const EMOTIONS = ['neutral', 'tense', 'anxious', 'angry', 'sad', 'withdrawn', 'dismissive', 'relieved', 'excited'];
export const GAZES = ['student', 'away', 'down', 'around'];
export const GESTURES = ['none', 'nod', 'shake', 'shrug'];

// Face: ARKit morph baselines at intensity 1 (scaled by intensity; neutral is the starting point).
export const FACE = {
  neutral: { eyesLookDown: 0.1 },
  tense: {
    browInnerUp: 0.7, browDownLeft: 0.35, browDownRight: 0.2,
    mouthPressLeft: 0.9, mouthPressRight: 0.9, mouthRollLower: 0.3,
    eyeWideLeft: 0.7, eyeWideRight: 0.7, eyesLookDown: 0.0, jawForward: 0.1
  },
  anxious: {
    browInnerUp: 1.0, browOuterUpLeft: 0.55, browOuterUpRight: 0.45,
    eyeWideLeft: 0.8, eyeWideRight: 0.75,
    mouthStretchLeft: 0.45, mouthStretchRight: 0.35, mouthPressLeft: 0.25, mouthPressRight: 0.25,
    mouthFrownLeft: 0.2, mouthFrownRight: 0.2, eyesLookDown: 0.0
  },
  angry: {
    // glare: brows hard down, upper lids a touch raised, nose wrinkled, lips tight / snarling
    browDownLeft: 1.0, browDownRight: 1.0, browInnerUp: 0.0,
    eyeSquintLeft: 0.3, eyeSquintRight: 0.35, eyeWideLeft: 0.25, eyeWideRight: 0.25,
    noseSneerLeft: 0.7, noseSneerRight: 0.6,
    mouthPressLeft: 0.45, mouthPressRight: 0.45, mouthFrownLeft: 0.35, mouthFrownRight: 0.35,
    mouthUpperUpLeft: 0.55, mouthUpperUpRight: 0.4, mouthLowerDownLeft: 0.25, mouthLowerDownRight: 0.2,
    jawForward: 0.35, eyesLookDown: 0.0
  },
  sad: {
    browInnerUp: 1.0, browDownLeft: 0.2, browDownRight: 0.2,
    mouthFrownLeft: 0.7, mouthFrownRight: 0.7, mouthShrugLower: 0.45, mouthRollLower: 0.3,
    eyeSquintLeft: 0.25, eyeSquintRight: 0.25, eyeBlinkLeft: 0.08, eyeBlinkRight: 0.08, eyesLookDown: 0.15
  },
  withdrawn: {
    browInnerUp: 0.5, mouthFrownLeft: 0.3, mouthFrownRight: 0.3,
    eyeBlinkLeft: 0.08, eyeBlinkRight: 0.08, eyesLookDown: 0.15, mouthClose: 0.0
  },
  dismissive: {
    // asymmetric smirk, half-lidded, one brow up
    mouthSmileLeft: 0.2, mouthFrownRight: 0.5, mouthLeft: 0.25, mouthShrugUpper: 0.35,
    browOuterUpLeft: 0.6, browDownRight: 0.35,
    eyeBlinkLeft: 0.42, eyeBlinkRight: 0.4, noseSneerLeft: 0.4, eyesLookDown: 0.0
  },
  excited: {
    // bright smile, wide eyes, raised brows (kept natural: over-stretching the mouth looks uncanny)
    mouthSmile: 0.55, mouthSmileLeft: 0.5, mouthSmileRight: 0.5, jawOpen: 0.1, mouthUpperUpLeft: 0.12, mouthUpperUpRight: 0.12,
    mouthDimpleLeft: 0.3, mouthDimpleRight: 0.3, cheekSquintLeft: 0.45, cheekSquintRight: 0.45,
    eyeSquintLeft: 0.12, eyeSquintRight: 0.12, eyeWideLeft: 0.4, eyeWideRight: 0.4,
    browInnerUp: 0.45, browOuterUpLeft: 0.5, browOuterUpRight: 0.5
  },
  relieved: {
    mouthSmile: 0.5, mouthSmileLeft: 0.5, mouthSmileRight: 0.45,
    cheekSquintLeft: 0.35, cheekSquintRight: 0.35, eyeSquintLeft: 0.2, eyeSquintRight: 0.2,
    browInnerUp: 0.15, browDownLeft: 0.1, browDownRight: 0.1, eyeBlinkLeft: 0.12, eyeBlinkRight: 0.12, eyesLookDown: 0.1
  }
};

// Micro-expressions: tiny random facial flickers while idle (morph -> max amplitude at intensity 1).
export const MICRO = {
  neutral:    { browInnerUp: 0.2, mouthLeft: 0.15, mouthRight: 0.15, eyeSquintLeft: 0.15, eyeSquintRight: 0.15 },
  tense:      { mouthPressLeft: 0.4, mouthPressRight: 0.4, mouthRollLower: 0.35, browInnerUp: 0.3, jawLeft: 0.15, jawRight: 0.15 },
  anxious:    { mouthStretchLeft: 0.4, mouthStretchRight: 0.4, browInnerUp: 0.3, mouthRollLower: 0.4, mouthPucker: 0.2 },
  angry:      { noseSneerLeft: 0.4, noseSneerRight: 0.4, mouthPressLeft: 0.3, mouthPressRight: 0.3, jawForward: 0.2, mouthUpperUpLeft: 0.3 },
  sad:        { mouthRollLower: 0.4, browInnerUp: 0.25, mouthFrownLeft: 0.2, mouthFrownRight: 0.2, mouthPucker: 0.15 },
  withdrawn:  { mouthRollLower: 0.3, mouthRollUpper: 0.2, browInnerUp: 0.15 },
  dismissive: { mouthLeft: 0.3, noseSneerLeft: 0.3, browOuterUpLeft: 0.25, mouthShrugUpper: 0.25 },
  relieved:   { mouthSmileLeft: 0.2, mouthSmileRight: 0.2, browInnerUp: 0.15, mouthRollLower: 0.15 },
  excited:    { mouthSmileLeft: 0.25, mouthSmileRight: 0.25, browOuterUpLeft: 0.3, browOuterUpRight: 0.3, jawOpen: 0.1, eyeWideLeft: 0.2, eyeWideRight: 0.2 }
};

// Body: euler DELTAS added on top of the seated pose at intensity 1 (posture / lean / shoulders).
export const BODY_DELTAS = {
  neutral: {},
  tense: {
    'LeftShoulder.rotation':  { x: 0, y: 0, z: 0.22 },
    'RightShoulder.rotation': { x: 0, y: 0, z: -0.22 },
    'Spine2.rotation': { x: -0.06, y: 0, z: 0 },
    'Neck.rotation':   { x: -0.05, y: 0, z: 0 }
  },
  anxious: {
    'LeftShoulder.rotation':  { x: 0, y: 0, z: 0.3 },
    'RightShoulder.rotation': { x: 0, y: 0, z: -0.3 },
    'Spine.rotation':  { x: 0.08, y: 0, z: 0 },
    'Spine1.rotation': { x: 0.08, y: 0, z: 0 },
    'Spine2.rotation': { x: 0.06, y: 0, z: 0 },
    'Neck.rotation':   { x: 0.08, y: 0, z: 0 }
  },
  angry: {
    // lean forward, chin down, shoulders squared and a bit raised
    'Spine.rotation':  { x: 0.10, y: 0, z: 0 },
    'Spine1.rotation': { x: 0.10, y: 0, z: 0 },
    'Spine2.rotation': { x: 0.05, y: 0, z: 0 },
    'Neck.rotation':   { x: 0.10, y: 0, z: 0 },
    'Head.rotation':   { x: 0.10, y: 0, z: 0 },
    'LeftShoulder.rotation':  { x: 0, y: 0, z: 0.14 },
    'RightShoulder.rotation': { x: 0, y: 0, z: -0.14 }
  },
  sad: {
    'Spine.rotation':  { x: 0.16, y: 0, z: 0 },
    'Spine1.rotation': { x: 0.14, y: 0, z: 0 },
    'Spine2.rotation': { x: 0.12, y: 0, z: 0 },
    'Neck.rotation':   { x: 0.22, y: 0, z: 0 },
    'Head.rotation':   { x: 0.14, y: 0, z: 0.04 },
    'LeftShoulder.rotation':  { x: 0, y: 0, z: -0.10 },
    'RightShoulder.rotation': { x: 0, y: 0, z: 0.10 }
  },
  withdrawn: {
    'Spine.rotation':  { x: 0.12, y: 0, z: 0 },
    'Spine1.rotation': { x: 0.10, y: 0, z: 0 },
    'Spine2.rotation': { x: 0.10, y: 0, z: 0 },
    'Neck.rotation':   { x: 0.18, y: 0, z: 0 },
    'Head.rotation':   { x: 0.12, y: 0, z: 0 },
    'LeftShoulder.rotation':  { x: 0, y: 0, z: -0.06 },
    'RightShoulder.rotation': { x: 0, y: 0, z: 0.06 }
  },
  dismissive: {
    // lean back, head tilted and slightly back
    'Spine.rotation':  { x: -0.08, y: 0, z: 0.05 },
    'Spine1.rotation': { x: -0.06, y: 0, z: 0.04 },
    'Neck.rotation':   { x: 0.04, y: 0, z: 0.08 },
    'Head.rotation':   { x: 0.03, y: 0.08, z: 0.08 },
    'LeftShoulder.rotation':  { x: 0, y: 0, z: -0.04 },
    'RightShoulder.rotation': { x: 0, y: 0, z: 0.04 }
  },
  excited: {
    // sits forward on the edge of the seat, chest up, head up, shoulders a little raised
    'Spine.rotation':  { x: 0.06, y: 0, z: 0 },
    'Spine1.rotation': { x: 0.04, y: 0, z: 0 },
    'Spine2.rotation': { x: -0.05, y: 0, z: 0 },
    'Neck.rotation':   { x: -0.06, y: 0, z: 0 },
    'Head.rotation':   { x: -0.04, y: 0, z: 0 },
    'LeftShoulder.rotation':  { x: 0, y: 0, z: 0.10 },
    'RightShoulder.rotation': { x: 0, y: 0, z: -0.10 }
  },
  relieved: {
    'Spine.rotation':  { x: -0.03, y: 0, z: 0 },
    'Spine2.rotation': { x: 0.06, y: 0, z: 0 },
    'LeftShoulder.rotation':  { x: 0, y: 0, z: -0.12 },
    'RightShoulder.rotation': { x: 0, y: 0, z: 0.12 },
    'Head.rotation': { x: -0.04, y: 0, z: 0.06 }
  }
};

// ---------------------------------------------------------------------------------------------
// Behaviour profiles: how the patient MOVES for each emotion. All values 0..1 unless noted.
// These are the knobs for "body language"; setAffect({behavior:{...}}) and the debug sliders
// override them live.
//   fidget      hands / fingers / forearms keep busy (wringing, picking at fingers)
//   footTap     toe tapping bursts
//   legBounce   knee bouncing bursts
//   shift       postural shifts (lean, weight change), how often and how big
//   lookAround  how often the patient looks around the room instead of at the student
//   gazeStudent probability to keep eye contact (0 = avoids, 1 = stares)
//   blink       blink rate multiplier (1 = normal, ~1 blink / 4 s)
//   breath      breathing rate multiplier (1 = normal)
//   headMotion  amount of small idle head movement
//   arms        'rest' | 'clasped' | 'crossed'
// ---------------------------------------------------------------------------------------------
export const BEHAVIOR = {
  neutral:    { fidget: 0.10, footTap: 0.00, legBounce: 0.00, shift: 0.25, lookAround: 0.10, gazeStudent: 0.80, blink: 1.0, breath: 1.0, headMotion: 0.5, arms: 'rest' },
  tense:      { fidget: 0.55, footTap: 0.30, legBounce: 0.15, shift: 0.40, lookAround: 0.25, gazeStudent: 0.45, blink: 1.6, breath: 1.3, headMotion: 0.5, arms: 'clasped' },
  anxious:    { fidget: 0.95, footTap: 0.20, legBounce: 0.70, shift: 0.60, lookAround: 0.65, gazeStudent: 0.30, blink: 2.0, breath: 1.7, headMotion: 0.8, arms: 'clasped' },
  angry:      { fidget: 0.15, footTap: 0.55, legBounce: 0.10, shift: 0.20, lookAround: 0.05, gazeStudent: 0.95, blink: 0.5, breath: 1.4, headMotion: 0.3, arms: 'crossed' },
  sad:        { fidget: 0.10, footTap: 0.00, legBounce: 0.00, shift: 0.10, lookAround: 0.05, gazeStudent: 0.15, blink: 1.2, breath: 0.8, headMotion: 0.2, arms: 'rest' },
  withdrawn:  { fidget: 0.15, footTap: 0.00, legBounce: 0.00, shift: 0.10, lookAround: 0.05, gazeStudent: 0.10, blink: 1.0, breath: 0.85, headMotion: 0.15, arms: 'clasped' },
  dismissive: { fidget: 0.20, footTap: 0.25, legBounce: 0.00, shift: 0.45, lookAround: 0.60, gazeStudent: 0.35, blink: 0.8, breath: 0.95, headMotion: 0.6, arms: 'crossed' },
  excited:    { fidget: 0.55, footTap: 0.25, legBounce: 0.55, shift: 0.75, lookAround: 0.30, gazeStudent: 0.92, blink: 1.3, breath: 1.5, headMotion: 0.95, arms: 'rest' },
  relieved:   { fidget: 0.05, footTap: 0.00, legBounce: 0.00, shift: 0.25, lookAround: 0.10, gazeStudent: 0.90, blink: 0.9, breath: 0.85, headMotion: 0.5, arms: 'rest' }
};

// ---------------------------------------------------------------------------------------------
// Gaze. The patient looks at the student's real position (the camera / headset), so she follows
// you as you move. On top of that she looks away in "aversions" depending on the emotion.
// Angles in radians (36 deg = 0.63 rad is about the eyeball's full range).
//   yaw / pitch   range of the look-away offset (pitch > 0 = up)
//   away          [min, max] seconds a look-away lasts
//   contact       [min, max] seconds of eye contact between look-aways
//   head          share of a gaze shift the head takes over from the eyes (0 = eyes only)
//   jitter        size of the tiny saccades while holding eye contact
// How OFTEN she looks away is BEHAVIOR[emotion].gazeStudent (1 = never, 0 = always).
// ---------------------------------------------------------------------------------------------
export const EYE_STYLE = {
  neutral:    { yaw: [-0.35, 0.35], pitch: [-0.10, 0.25], away: [0.8, 2.0], contact: [2.0, 6.0], head: 0.45, jitter: 0.015 },
  tense:      { yaw: [-0.60, 0.60], pitch: [-0.25, 0.30], away: [0.2, 0.9], contact: [0.8, 2.5], head: 0.30, jitter: 0.03 },
  anxious:    { yaw: [-0.70, 0.70], pitch: [-0.30, 0.30], away: [0.15, 0.7], contact: [0.5, 1.8], head: 0.30, jitter: 0.045 },
  angry:      { yaw: [-0.15, 0.15], pitch: [-0.05, 0.10], away: [0.6, 1.5], contact: [3.0, 9.0], head: 0.55, jitter: 0.008 },
  sad:        { yaw: [-0.30, 0.30], pitch: [-0.60, -0.30], away: [1.0, 3.5], contact: [0.6, 1.5], head: 0.35, jitter: 0.012 },
  withdrawn:  { yaw: [-0.30, 0.30], pitch: [-0.55, -0.25], away: [1.5, 4.0], contact: [0.4, 1.2], head: 0.30, jitter: 0.01 },
  dismissive: { yaw: [-0.80, 0.80], pitch: [0.0, 0.40], away: [0.8, 2.5], contact: [1.0, 3.0], head: 0.55, jitter: 0.015 },
  relieved:   { yaw: [-0.35, 0.35], pitch: [-0.10, 0.20], away: [0.8, 2.0], contact: [2.5, 7.0], head: 0.45, jitter: 0.012 },
  excited:    { yaw: [-0.45, 0.45], pitch: [-0.05, 0.30], away: [0.5, 1.4], contact: [2.5, 7.0], head: 0.50, jitter: 0.02 }
};
