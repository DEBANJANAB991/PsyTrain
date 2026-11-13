/**
 * Control surface for the virtual patient, written once and used by every kind of agent:
 *   - the in-app "director" (Claude, via server/agent.js)
 *   - an ElevenLabs conversational agent (register these as client tools, same names and parameters)
 *   - anything else that can call tools (the browser exposes window.patient.agent.execute(name, args))
 *
 * Plain data only (no DOM, no imports) so both the browser and the Node server can load it.
 * Tools use the Anthropic tool format { name, description, input_schema }.
 */

export const EMOTION_NAMES = ['neutral', 'tense', 'anxious', 'angry', 'sad', 'withdrawn', 'dismissive', 'relieved', 'excited'];
export const GAZE_NAMES = ['student', 'away', 'down', 'around'];
export const GESTURE_NAMES = ['nod', 'shake', 'shrug'];
export const ARM_NAMES = ['rest', 'clasped', 'crossed'];
export const TRAIT_NAMES = ['openness', 'conscientiousness', 'extraversion', 'agreeableness', 'neuroticism'];
export const EVENT_NAMES = ['sensitive_question', 'reassurance', 'accusation', 'interruption', 'long_silence', 'good_news', 'bad_news', 'rapport_built'];
export const PRESET_NAMES = ['default', 'cooperative', 'anxious', 'guarded', 'hostile', 'depressed', 'talkative', 'evasive', 'distractible', 'stoic'];

/** The body-language knobs: what each one does and its allowed range. */
export const BEHAVIOR_META = {
  fidget:      { min: 0,   max: 1,   what: 'hands, fingers and forearms keep busy (wringing, picking at fingers)' },
  footTap:     { min: 0,   max: 1,   what: 'bursts of toe tapping' },
  legBounce:   { min: 0,   max: 1,   what: 'bursts of knee bouncing' },
  shift:       { min: 0,   max: 1,   what: 'posture shifts: leaning, twisting, changing weight' },
  lookAround:  { min: 0,   max: 1,   what: 'how often she looks around the room instead of at the student' },
  gazeStudent: { min: 0,   max: 1,   what: 'probability of keeping eye contact (1 = never looks away, 0 = avoids the student)' },
  blink:       { min: 0.2, max: 3,   what: 'blink rate multiplier (1 = normal)' },
  breath:      { min: 0.5, max: 2.5, what: 'breathing rate multiplier (1 = normal)' },
  headMotion:  { min: 0,   max: 1,   what: 'amount of small idle head movement' }
};
export const BEHAVIOR_KEYS = Object.keys(BEHAVIOR_META);

const num = (description, min, max) => ({ type: 'number', description, minimum: min, maximum: max });
const behaviorProps = () => Object.fromEntries(BEHAVIOR_KEYS.map((k) => [k, num(`${BEHAVIOR_META[k].what} (${BEHAVIOR_META[k].min} to ${BEHAVIOR_META[k].max})`, BEHAVIOR_META[k].min, BEHAVIOR_META[k].max)]));
const rangeProps = () => Object.fromEntries(BEHAVIOR_KEYS.map((k) => [k, {
  type: 'object', description: `allowed range for ${k}`,
  properties: { min: num('lower bound', BEHAVIOR_META[k].min, BEHAVIOR_META[k].max), max: num('upper bound', BEHAVIOR_META[k].min, BEHAVIOR_META[k].max) },
  additionalProperties: false
}]));
const traitProps = () => Object.fromEntries(TRAIT_NAMES.map((t) => [t, num(`Big Five trait ${t}, 0 (low) to 1 (high)`, 0, 1)]));

export const AGENT_TOOLS = [
  {
    name: 'get_state',
    description: 'Return the patient\'s current state: emotion, intensity, personality (traits, ranges, variability), the live effective value of every body-language behavior, and active events.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'list_options',
    description: 'List every valid value: emotions, gazes, gestures, arm postures, personality presets (with their traits), events, Big Five trait names and the behavior knobs with their allowed ranges. Call this if unsure what is valid.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'set_personality',
    description:
      'Give the patient a personality. A personality shapes HOW SHE MOVES in every emotion: it shifts the behavior values (fidgeting, eye contact, looking around...), limits them to ranges, and makes them drift slowly and naturally within those ranges. ' +
      'Use a preset, or set the Big Five traits directly (0 to 1; 0.5 is average), or both (traits override the preset). Optionally set how much the behaviors wander (variability) and an emotion to start in.',
    input_schema: {
      type: 'object',
      properties: {
        preset: { type: 'string', enum: PRESET_NAMES, description: 'named personality type (or a custom one you defined with define_personality)' },
        traits: { type: 'object', properties: traitProps(), additionalProperties: false, description: 'Big Five traits to set' },
        variability: num('how much behaviors drift within their ranges: 0 = frozen, 0.3 = natural, 1 = restless', 0, 1),
        emotion: { type: 'string', enum: EMOTION_NAMES, description: 'emotion to switch to as well' },
        intensity: num('emotion intensity 0..1', 0, 1)
      },
      additionalProperties: false
    }
  },
  {
    name: 'define_personality',
    description:
      'Define a NEW named personality type (saved for this session and the browser) and optionally activate it. Give it Big Five traits, optional ranges per behavior, variability, a default emotion and arm posture. ' +
      'Example: name "evasive_teen", extraversion 0.3, agreeableness 0.2, ranges {gazeStudent: {min: 0, max: 0.35}}, arms "crossed".',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'short snake_case name, 2-30 characters' },
        description: { type: 'string', description: 'one sentence describing this type of patient' },
        traits: { type: 'object', properties: traitProps(), additionalProperties: false },
        ranges: { type: 'object', properties: rangeProps(), additionalProperties: false, description: 'min/max limits per behavior for this personality' },
        variability: num('0..1', 0, 1),
        default_emotion: { type: 'string', enum: EMOTION_NAMES },
        default_intensity: num('0..1', 0, 1),
        arms: { type: 'string', enum: ARM_NAMES },
        activate: { type: 'boolean', description: 'switch to it immediately (default true)' }
      },
      required: ['name', 'traits'],
      additionalProperties: false
    }
  },
  {
    name: 'set_behavior',
    description:
      'Set body-language behaviors directly. Values become the new CENTER of each behavior; it still drifts within its range by the personality\'s variability, and everything resets when the emotion changes. ' +
      'Set exact=true to pin a value exactly (no drifting, ignores range). Use for fine adjustments after set_personality / set_affect.',
    input_schema: {
      type: 'object',
      properties: { ...behaviorProps(), arms: { type: 'string', enum: ARM_NAMES, description: 'arm posture' }, exact: { type: 'boolean', description: 'pin the given values exactly' } },
      additionalProperties: false
    }
  },
  {
    name: 'set_behavior_range',
    description:
      'Define the allowed range (min and max) for one or more behaviors. Her live value drifts and reacts only inside these limits. ' +
      'Narrow range = predictable (min equal to max freezes it); wide range = lots of variation. Pass null for a behavior to restore its full range.',
    input_schema: {
      type: 'object',
      properties: { ranges: { type: 'object', properties: Object.fromEntries(BEHAVIOR_KEYS.map((k) => [k, { ...rangeProps()[k], type: ['object', 'null'] }])), additionalProperties: false } },
      required: ['ranges'],
      additionalProperties: false
    }
  },
  {
    name: 'set_affect',
    description: 'Set her emotional state and expression right now: emotion (face + posture), its intensity, where she looks, and a one-off gesture.',
    input_schema: {
      type: 'object',
      properties: {
        emotion: { type: 'string', enum: EMOTION_NAMES },
        intensity: num('0..1', 0, 1),
        gaze: { type: 'string', enum: GAZE_NAMES, description: 'student = eye contact now; away / down / around = look somewhere else for a moment' },
        gesture: { type: 'string', enum: GESTURE_NAMES }
      },
      additionalProperties: false
    }
  },
  {
    name: 'trigger_event',
    description:
      'Tell her something happened in the consultation. She reacts according to her personality: behaviors shift for a while and then settle back, and her emotion may change. ' +
      'sensitive_question (touchy topic), reassurance (empathy, calming), accusation (blame, confrontation), interruption, long_silence, good_news, bad_news, rapport_built (slow trust).',
    input_schema: {
      type: 'object',
      properties: { event: { type: 'string', enum: EVENT_NAMES }, strength: num('how strong 0..1 (default 0.7)', 0, 1) },
      required: ['event'],
      additionalProperties: false
    }
  }
];

export const DIRECTOR_SYSTEM = `You are the director of a virtual patient in a medical history-taking training simulation. A medical student interviews the patient (a 3D avatar). You never speak as the patient; you only control how she behaves, using the tools.

What you control:
- emotion: neutral, tense, anxious, angry, sad, withdrawn, dismissive, relieved, excited. It sets her face and posture.
- personality: Big Five traits (0 to 1) or a preset. It shapes how she moves in every emotion: fidgeting, foot tapping, knee bouncing, posture shifts, looking around, eye contact, blink and breathing rate, head movement. Each behavior has a range; its live value drifts slowly inside that range and reacts to events.
- events: sensitive_question, reassurance, accusation, interruption, long_silence, good_news, bad_news, rapport_built. She reacts according to her personality.

How to work:
- Translate the instruction into the smallest set of tool calls that does the job. Call independent tools in the same turn.
- For a type of patient: set_personality with a preset, or define_personality for a new type. Then set_affect for the starting emotion. Use set_behavior_range to bound behaviors the instruction is explicit about ("never looks at the student" is a low gazeStudent range). Use set_behavior only for fine adjustments.
- Keep it realistic: most people are moderate, so avoid pushing many values to their extremes at once. Intensity around 0.5 to 0.7 reads as natural; use more only for a strong reaction.
- If you are unsure what is valid, call list_options. If a tool returns an error, read it and correct the call.
- When done, reply in one or two plain sentences saying what you set up, with no lists or markup.`;
