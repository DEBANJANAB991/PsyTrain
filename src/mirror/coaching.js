/**
 * Conversation-based personalised coaching from ai-patient-voice/hints.json.
 *
 * Input: the transcript as saved by MIRROR (assessment.timeline transcript turns: turn_id, speaker, text) and
 * the hints JSON (passed in, never modified). Output: only the strategies the conversation itself supports.
 *
 * Analysis (transparent rules, no scoring and nothing invented):
 *   1. Patient turns are classified as distraction episodes (tangent markers, losing the question, long replies
 *      unrelated to the question) or aggression episodes of level 1 (irritated comments), 2 (open confrontation /
 *      questioning competence) or 3 (threats, menacing or shouting language).
 *   2. The student's next turn after each episode is classified (redirect, naming the observation, interrupt and
 *      repeat, following the tangent / validation, limit setting, metacommunication, safety, escalation).
 *   3. A strategy level is shown only if the matching patient behaviour occurred (or the student used it), with
 *      the outcome demonstrated / partially demonstrated / not demonstrated / insufficient evidence.
 *   4. General tips are shown only when a specific, transcript-supported improvement matches them.
 *
 * Cue families cover common paraphrases (English), not single fixed phrases; when the student's reaction cannot
 * be classified the result is "insufficient evidence", never an assumed failure.
 */

export const OUTCOME = {
  demonstrated: 'demonstrated',
  partial: 'partially_demonstrated',
  missed: 'not_demonstrated',
  insufficient: 'insufficient_evidence'
};

// ---------------------------------------------------------------- text helpers
const STOP = new Set(('a an the and or but if so of to in on at for with from by about as into over after before than then this that these those ' +
  'is are was were be been being am do does did done have has had having i me my mine you your yours we us our ours he she it its they them their ' +
  'what which who whom whose when where why how can could would should will shall may might must just very really quite also too not no yes ok okay ' +
  'well oh um uh like know mean think thing things something anything there here out up down now then again more most much many some any all ' +
  'tell said say says get got go going come came let lets one two way bit kind sort sure right yeah').split(/\s+/));
const words = (t) => String(t ?? '').toLowerCase().replace(/[’']/g, "'").match(/[a-z][a-z']*/g) ?? [];
const stem = (w) => w.replace(/'s$/, '').replace(/(ing|edly|ed|ies|es|s|ly)$/, '').slice(0, 6);
const stems = (t) => new Set(words(t).filter((w) => w.length >= 3 && !STOP.has(w)).map(stem).filter((s) => s.length >= 3));
const overlap = (a, b) => { let n = 0; for (const x of a) if (b.has(x)) n++; return n; };
const any = (text, patterns) => patterns.some((p) => p.test(text));
const quote = (text, max = 180) => { const s = String(text ?? '').trim(); return s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s; };

// ---------------------------------------------------------------- patient behaviour cues
const TANGENT = [
  /\bby the way\b/i, /\bthat reminds me\b/i, /\bspeaking of\b/i, /\banyway\b/i, /\boh,? (did i|have i) (tell|mention)/i,
  /\bfunny (story|thing)\b/i, /\byou know what\b/i, /\b(last|this) (weekend|week|summer|year|month)\b.*\b(we|i) (went|had|were|did)\b/i,
  /\b(my|the) phone\b/i, /\b(nice|lovely|interesting) (room|picture|painting|chair|plant|view)\b/i, /\bthis room\b/i,
  /\boh,? (look|wait)\b/i, /\bsorry,? i('m| am) (rambling|going on)\b/i, /\bon (a|another) (side )?note\b/i, /\bthat's another story\b/i,
  /\bwhich reminds me\b/i, /\bincidentally\b/i, /\b(a|my) friend of mine\b/i
];
const LOST_THREAD = [
  /\bwhat was (the|your) question\b/i, /\bwhere was i\b/i, /\b(i )?(forgot|forget|lost) (what|the|my) (you asked|question|thread|train of thought)\b/i,
  /\blost my train of thought\b/i, /\bwhat were we talking about\b/i, /\bwhat did you (ask|want to know)\b/i
];
const AGG1 = [
  /\b(this|that|it)('s| is)? (doesn't|does not|won't|will not) help\b/i, /\b(pointless|useless|waste of (my )?time)\b/i, /\bwhatever\b/i,
  /\bwhy should i\b/i, /\bnone of your business\b/i, /\bi don'?t see the point\b/i, /\bwhy (do|would) you (even )?(care|need to know)\b/i,
  /\b(i('m| am)|i get) (sick|tired) of\b/i, /\bleave me alone\b/i, /\bi don'?t want to talk (about (it|this))?\b/i, /\bseriously\?/i,
  /\b(annoying|irritating)\b/i, /\bfor god'?s sake\b/i
];
const AGG2 = [
  /\b(are|r) you (even )?(qualified|a real doctor|trained|listening)\b/i, /\byou('re| are) (just|only) a (student|trainee|kid)\b/i,
  /\bdo you (even )?know what you('re| are) doing\b/i, /\byou (don'?t|do not) (understand|get it|know anything|listen)\b/i,
  /\b(incompetent|clueless|amateur)\b/i, /\bwhat kind of (doctor|therapist)\b/i, /\byou('re| are) not (listening|helping)\b/i,
  /\bwho do you think you are\b/i, /\bwhat (would|do) you know\b/i, /\bstupid (question|questions)\b/i, /\bridiculous\b/i
];
const AGG3 = [
  /\bor else\b/i, /\byou('ll| will) regret\b/i, /\bi('ll| will|'m going to| am going to) (hurt|hit|kill|punch|smash|break)\b/i,
  /\bwatch (yourself|your back|it)\b/i, /\bi swear i('ll| will)\b/i, /\bget out\b/i, /\bshut up\b/i, /\bi('m| am) (going to )?(stand(ing)? up|leaving)\b/i,
  /\bback off\b/i, /\bdon'?t (you )?(dare|push me)\b/i, /\b(f+u+c+k+|f\*+k|bloody|damn you|screw you)\b/i
];
const shouting = (t) => (String(t).match(/\b[A-Z]{3,}\b/g) ?? []).length >= 2 || /!{2,}/.test(t);

// ---------------------------------------------------------------- student response cues
const STEER = [
  /\b(coming|come|going|get|getting|go) back to\b/i, /\bback to (my|the|your|our) (question|topic|point)\b/i, /\blet'?s (return|get back|go back|stay with|focus|come back)\b/i,
  /\b(i'?d|i would) like to (come back|return|go back|focus|stay)\b/i, /\bto (get|come) back to\b/i, /\byou mentioned\b/i,
  /\b(focus|stay) on\b/i, /\bbefore we (go on|move on|continue)\b/i, /\b(my|the) (original )?question was\b/i, /\bas i (was )?ask(ed|ing)\b/i,
  /\breturning to\b/i, /\bif we (could )?(stay|focus)\b/i
];
const NAME_OBS = [
  /\b(i|i'?ve|i have) (notice|noticed|realise|realised|realize|realized|see|observe) (that )?(we|our|the conversation|it'?s|you|this)\b.*\b(drift|topic|track|side|jump|wander|focus|away|lot of|many)\b/i,
  /\bwe('ve| have)? (drifted|wandered|moved away|jumped|gone off|got(ten)? (off|side)|strayed)\b/i, /\b(off|off the) (topic|track)\b/i,
  /\b(side-?tracked|sidetracked)\b/i, /\bdoes (that|this) (match|fit|sound right|ring true)\b/i, /\b(hard|difficult) to (stay|focus|keep)\b/i
];
const INTERRUPT = [
  /\b(may|can|could) i (briefly |just |quickly )?(interrupt|stop you|jump in|cut in|add something)\b/i, /\b(sorry|excuse me),? (to|for) interrupt(ing)?\b/i,
  /\blet me (briefly |just )?(interrupt|stop you|add something)\b/i, /\bi('m| am) going to (stop|interrupt) you\b/i, /\bif i (may|could) (interrupt|stop you)\b/i,
  /\bmay i give (your|this) (account|story) a different direction\b/i, /\bsorry to cut you off\b/i
];
const VALIDATE = [
  /\bi (can )?(see|hear|understand|sense|notice) (that |how |why )?(you('re| are)|this|it'?s|that|your)\b/i, /\bthat sounds (really )?(frustrating|difficult|hard|annoying|exhausting|tough)\b/i,
  /\b(it|that) makes sense\b/i, /\bunderstandable\b/i, /\byou('re| are|'re feeling| feel| seem) (frustrated|angry|annoyed|upset|irritated|fed up)\b/i,
  /\bi understand (why|that|your|how)\b/i, /\bthat must be\b/i, /\bi('m| am) sorry (you|this|that)\b/i, /\byour (frustration|anger|feelings?) (is|are|make)\b/i,
  /\bi (get|appreciate) (that|why|it)\b/i, /\bit('s| is) (okay|ok|fine|understandable) to (feel|be)\b/i,
  /\bi (can )?(see|hear|understand|sense|imagine) (how|that|why) (frustrat|annoy|upset|angry|difficult|hard|exhaust|tir|stress|irritat)\w*/i,
  /\b(how|so) (frustrat|annoy|upset|difficult|hard|exhaust|stress|irritat)\w* (this|it|that|all this) (is|feels|must|has)\b/i,
  /\b(this|it|that) (must be|is|feels|seems) (really |so |very )?(frustrat|annoy|upset|difficult|hard|exhaust|stress|irritat)\w*/i,
  /\byou (sound|seem|look) (really |quite |very )?(frustrated|angry|annoyed|upset|irritated|fed up|tired of)\b/i
];
const LIMIT = [
  /\b(i'?d|i would) like (us )?to\b/i, /\blet'?s (keep|stay|focus|take|try|slow|continue|pause)\b/i, /\bi (need|want|ask) (us|you) to\b/i,
  /\b(it'?s|that'?s|this is) not (okay|ok|acceptable|helpful)\b/i, /\bplease (don'?t|do not|stop|lower|let)\b/i, /\bwe can (only )?(continue|go on) (if|when)\b/i,
  /\bi('m| am) not going to\b/i, /\b(can|could) we (slow|calm|take|try|keep|continue|go back)\b/i, /\bi('m| am) here to (help|understand|listen)\b/i,
  /\b(with )?respect\b/i, /\bi (won'?t|will not) (accept|continue|tolerate)\b/i, /\bin a calm\b/i, /\bone (thing|step) at a time\b/i
];
const META = [
  /\bi (notice|noticed|sense|have the impression|feel) (that )?(you|we|this|there|our|the conversation)\b/i, /\bit (seems|feels|sounds) (like )?(we|you|this conversation)\b/i,
  /\bwhat('s| is) (happening|going on) (here|between us|right now)\b/i, /\bhow (is|are) (this|our) (conversation|talk)\b/i, /\bi('m| am) wondering (if|whether)\b/i,
  /\bthis (isn'?t|is not) about (who('s| is) right|winning)\b/i, /\bnot a (contest|competition|fight)\b/i, /\bcan we talk about how (we|this)\b/i,
  /\bwhat (would|could) (help|make) (you|this)\b/i, /\bstep back (for a moment|and look)\b/i
];
const ESCALATE = [
  /\byou('re| are) (being )?(rude|ridiculous|unreasonable|impossible|difficult|aggressive|childish)\b/i, /\b(just )?calm down\b/i,
  /\bdon'?t (talk|speak) to me like that\b/i, /\bi('m| am) (a|the) (doctor|professional|expert)\b/i, /\bi know what i('m| am) doing\b/i,
  /\bi('m| am) (fully )?(qualified|trained)\b/i, /\b(that'?s|that is) (not true|nonsense|wrong)\b/i, /\byou('re| are) wrong\b/i, /\blisten to me\b/i,
  /\bif you don'?t (want|like) (it|this)\b/i, /\bfine,? then\b/i, /\byou need to (stop|calm|answer|cooperate)\b/i, /\bstop being\b/i,
  /\bactually,? (it|this|therapy) (does|will) help\b/i, /\bthere'?s no need to (be|get)\b/i, /\bwho do you think\b/i
];
const SAFETY = [
  /\blet'?s (stop|pause|end|take a break)\b/i, /\bi('m| am) going to (end|stop|pause|step out|leave|get)\b/i, /\b(we('ll| will)|i('ll| will)) (stop|end|pause) (here|now|the session|for today)\b/i,
  /\bfor (our|my|your|everyone'?s) safety\b/i, /\bi('ll| will) (call|get|ask) (someone|security|a colleague|help|my supervisor)\b/i,
  /\b(keep|give) (some |a little )?(distance|space)\b/i, /\bstep back\b/i, /\bend (the|this) (session|conversation|consultation)\b/i, /\bfeel (un)?safe\b/i
];
const RISK_CONTEXT = [/\b(alcohol|drink|drinking|drunk|beer|wine|vodka|drugs?|cannabis|weed|cocaine|pills|violence|violent|fight|fights|police|weapon)\b/i];

// ---------------------------------------------------------------- transcript
/** Transcript turns from a saved MIRROR assessment (timeline), in saved order. */
export function turnsFromAssessment(assessment) {
  return (assessment?.timeline ?? [])
    .filter((t) => t.entry_type === 'transcript_turn' && (t.speaker === 'doctor' || t.speaker === 'patient'))
    .map((t) => ({ id: t.turn_id, speaker: t.speaker, text: String(t.original_text ?? t.summary ?? '').trim(), timestamp: t.timestamp }))
    .filter((t) => t.text);
}

function previous(turns, i, speaker) { for (let j = i - 1; j >= 0; j--) if (turns[j].speaker === speaker) return { turn: turns[j], index: j }; return null; }
function next(turns, i, speaker) { for (let j = i + 1; j < turns.length; j++) if (turns[j].speaker === speaker) return { turn: turns[j], index: j }; return null; }

// ---------------------------------------------------------------- detection
function aggressionLevel(text) {
  if (any(text, AGG3) || shouting(text)) return 3;
  if (any(text, AGG2)) return 2;
  if (any(text, AGG1)) return 1;
  return 0;
}

function isDistraction(p, q) {
  if (any(p.text, LOST_THREAD) || any(p.text, TANGENT)) return true;
  // long reply that does not touch the question at all
  return Boolean(q) && words(p.text).length >= 35 && stems(q.text).size >= 2 && overlap(stems(p.text), stems(q.text)) === 0;
}

function classifyRedirect(r, anchor, tangent) {
  const types = [];
  if (any(r.text, NAME_OBS)) types.push('name');
  const interrupt = any(r.text, INTERRUPT);
  const aStems = stems(anchor?.text), rStems = stems(r.text);
  const tangentOnly = new Set([...stems(tangent.text)].filter((s) => !aStems.has(s)));
  const backToQuestion = aStems.size > 0 && overlap(rStems, aStems) >= 1;
  const repeated = aStems.size > 0 && overlap(rStems, aStems) / aStems.size >= 0.5;
  if (interrupt) types.push(repeated ? 'interrupt_repeat' : 'interrupt');
  if (any(r.text, STEER) || (backToQuestion && overlap(rStems, aStems) >= overlap(rStems, tangentOnly))) types.push('narrow');
  if (!types.length && overlap(rStems, tangentOnly) >= 1) types.push('followed');
  return types;
}

function classifyAggressionResponse(r) {
  return {
    validate: any(r.text, VALIDATE), limit: any(r.text, LIMIT), meta: any(r.text, META),
    escalate: any(r.text, ESCALATE), safety: any(r.text, SAFETY)
  };
}

export function detectEpisodes(turns) {
  const distraction = [], aggression = [];
  turns.forEach((t, i) => {
    if (t.speaker !== 'patient') return;
    const q = previous(turns, i, 'doctor');
    const level = aggressionLevel(t.text);
    const r = next(turns, i, 'doctor');
    if (level) {
      // the student's reply, plus their following turn (a validation and a limit may be split over two turns)
      const r2 = r ? next(turns, r.index, 'doctor') : null;
      const between = r && r2 ? turns.slice(r.index + 1, r2.index).some((x) => x.speaker === 'patient') : true;
      const flags = r ? classifyAggressionResponse(r.turn) : null;
      if (flags && r2 && !between) {
        const f2 = classifyAggressionResponse(r2.turn);
        for (const k of Object.keys(flags)) flags[k] = flags[k] || f2[k];
      }
      aggression.push({ patient: t, index: i, level, response: r?.turn ?? null, flags });
      return;
    }
    if (isDistraction(t, q?.turn)) {
      const anchor = findAnchor(turns, i, distraction);
      const types = r ? classifyRedirect(r.turn, anchor, t) : null;
      const after = r ? next(turns, r.index, 'patient') : null;
      const held = r && after ? !isDistraction(after.turn, r.turn) && !aggressionLevel(after.turn.text) : null;
      distraction.push({ patient: t, index: i, anchor, response: r?.turn ?? null, types, held, after: after?.turn ?? null });
    }
  });
  return { distraction, aggression };
}

/** The interview question the patient drifted away from: the doctor turn before the first episode of this run. */
function findAnchor(turns, i, previousEpisodes) {
  const last = previousEpisodes[previousEpisodes.length - 1];
  const q = previous(turns, i, 'doctor');
  if (last && last.response && last.response === q?.turn && !(last.types ?? []).some((x) => x !== 'followed')) return last.anchor;
  return q?.turn ?? null;
}

// ---------------------------------------------------------------- hints
const LINK = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
/** Source references in a long_explanation: [{ label, url }] (exact text and links from hints.json). */
export function sourcesOf(longExplanation) {
  const out = []; let m;
  LINK.lastIndex = 0;
  while ((m = LINK.exec(longExplanation ?? ''))) out.push({ label: m[1], url: m[2] });
  return out;
}
const strategy = (hints, behaviour, level) => hints?.[behaviour]?.strategies?.find((s) => s.level === level) ?? null;
const tip = (hints, behaviour, short) => hints?.[behaviour]?.general_tips?.find((t) => t.short_hint === short) ?? null;

function item(hints, behaviour, level, outcome, observed, evidence, improvement) {
  const s = strategy(hints, behaviour, level);
  if (!s) return null;
  const showLong = outcome === OUTCOME.partial || outcome === OUTCOME.missed;
  return {
    behaviour, level, strategy: s.short_hint, outcome, observed, evidence,
    shortHint: outcome === OUTCOME.missed || outcome === OUTCOME.partial ? s.short_hint : null,
    longExplanation: showLong ? s.long_explanation : null,
    improvement: outcome === OUTCOME.missed || outcome === OUTCOME.partial ? improvement ?? null : null,
    sources: sourcesOf(s.long_explanation)
  };
}

// evidence keeps the exact, complete transcript wording plus the saved timestamp
const ev = (turn, role) => turn ? { turnId: turn.id, speaker: turn.speaker, role, text: String(turn.text ?? '').trim(), timestamp: turn.timestamp ?? null } : null;
const pair = (e, roleP, roleS) => [ev(e.patient, roleP), ev(e.response, roleS)].filter(Boolean);
const aggregate = (outcomes) => {
  const known = outcomes.filter((o) => o !== OUTCOME.insufficient);
  if (!known.length) return OUTCOME.insufficient;
  if (known.every((o) => o === OUTCOME.demonstrated)) return OUTCOME.demonstrated;
  if (known.every((o) => o === OUTCOME.missed)) return OUTCOME.missed;
  return OUTCOME.partial;
};

// ---------------------------------------------------------------- distraction coaching
function distractionCoaching(hints, eps, turns = []) {
  const items = [], tips = [];
  if (!eps.length) return { items, tips };
  // turn numbers (1-based, saved order) so every count names its turns; each episode is listed exactly once
  const numberOf = new Map(turns.map((t, i) => [t.id, i + 1]));
  const at = (list, pick) => list.map(pick).map((t) => numberOf.get(t?.id)).filter(Boolean);
  const turnList = (nums) => (nums.length === 1 ? `turn ${nums[0]}` : `turns ${nums.slice(0, -1).join(', ')} and ${nums.at(-1)}`);
  const times = (k) => (k === 1 ? 'once' : k === 2 ? 'twice' : `${k} times`);
  const roleOf = (e) => (e.types?.includes('followed') ? 'you follow the tangent'
    : e.types?.some((x) => x === 'narrow' || x === 'name' || x.startsWith('interrupt')) ? 'you steer back'
      : 'your reply (neither follows the tangent nor returns to the question)');
  const allEpisodes = () => eps.flatMap((e) => pair(e, 'patient drifts', roleOf(e)));   // chronological, no duplicates
  const responded = eps.filter((e) => e.response);
  const redirected = responded.filter((e) => e.types.some((x) => x === 'narrow' || x === 'name' || x.startsWith('interrupt')));
  const followed = responded.filter((e) => e.types.includes('followed'));
  const unclear = responded.filter((e) => !e.types.length);
  const failedRedirects = redirected.filter((e) => e.held === false);
  const named = responded.filter((e) => e.types.includes('name'));
  const interrupted = responded.filter((e) => e.types.some((x) => x.startsWith('interrupt')));
  const n = eps.length;
  const driftTurns = at(eps, (e) => e.patient);
  const drifts = `The patient drifted away from the interview question ${times(n)}${driftTurns.length === n ? ` (${turnList(driftTurns)})` : ''}`;
  // each of your replies is counted in exactly one group: followed / steered back / neither / no reply
  const part = (k, list, text) => (k ? `${text} ${times(k)} (${turnList(at(list, (e) => e.response))})` : null);
  const noReply = eps.length - responded.length;
  const breakdown = () => [
    part(followed.length, followed, 'you followed the side topic'),
    part(redirected.length, redirected, 'you steered back to your question'),
    part(unclear.length, unclear, 'you replied without following the side topic or returning to your question'),
    noReply ? `${times(noReply)} the consultation ended before you replied` : null
  ].filter(Boolean);
  const sentence = (parts) => (parts.length ? ` ${parts[0][0].toUpperCase()}${parts[0].slice(1)}${parts.length > 1 ? `${parts.length > 2 ? ', ' + parts.slice(1, -1).join(', ') + ',' : ''} and ${parts.at(-1)}` : ''}.` : '');

  // Level 1: narrow the topic (relevant whenever the patient drifted)
  let l1;
  if (!responded.length || redirected.length + followed.length === 0) {
    l1 = item(hints, 'distraction', 1, OUTCOME.insufficient,
      `${drifts}, but there is insufficient transcript evidence to evaluate how you steered the conversation.${sentence(breakdown())}`,
      allEpisodes());
  } else if (followed.length === 0) {
    l1 = item(hints, 'distraction', 1, OUTCOME.demonstrated,
      `${drifts}.${sentence(breakdown())} You did not follow any side topic, keeping the interview on track.`,
      allEpisodes());
  } else if (redirected.length === 0) {
    const e = followed[0];
    l1 = item(hints, 'distraction', 1, OUTCOME.missed,
      `${drifts}.${sentence(breakdown())} You did not lead back to your question.`,
      allEpisodes(),
      e.anchor ? `After “${quote(e.patient.text, 90)}”, picking up one aspect and narrowing back to your question (“${quote(e.anchor.text, 90)}”) would have kept the interview on the topic you needed.` : null);
  } else {
    l1 = item(hints, 'distraction', 1, OUTCOME.partial,
      `${drifts}.${sentence(breakdown())}`,
      allEpisodes(),
      `Apply the same redirection you already used (“${quote(redirected[0].response.text, 90)}”) to the moments where you followed the new topic.`);
  }
  if (l1) items.push(l1);

  // Level 2: name the observation, only after level 1 was tried and did not hold (the patient drifted again
  // right after being steered back). Never because of the scenario, and not when level 1 was simply missed.
  const l2Needed = failedRedirects.length >= 1;
  if (named.length) {
    const held = named.filter((e) => e.held !== false);
    items.push(item(hints, 'distraction', 2, held.length === named.length ? OUTCOME.demonstrated : OUTCOME.partial,
      held.length === named.length ? 'You named the drifting as an observation, which helps the patient notice the pattern without feeling criticised.'
        : 'You named the drifting as an observation, but the patient drifted again straight afterwards; offering a pause or switching to short, closed questions was the missing step.',
      named.slice(0, 2).flatMap((e) => pair(e, 'patient drifts', 'you name the observation')),
      'After naming it, ask whether the observation fits and continue with short, closed or multiple-choice questions.'));
  } else if (l2Needed) {
    const e = failedRedirects[0];
    items.push(item(hints, 'distraction', 2, OUTCOME.missed,
      'Steering back alone did not hold: the patient drifted again right after you redirected, and the drifting was not named as an observation.',
      [ev(e.patient, 'patient drifts'), ev(e.response, 'you steer back'), ev(e.after, 'patient drifts again')].filter(Boolean),
      'Naming the pattern (“I notice we have drifted from the topic, does that match your experience?”) and offering short, closed questions could have helped here.'));
  }

  // Level 3: interrupt and repeat (needed when steering repeatedly failed, or naming did not help)
  const l3Needed = failedRedirects.length >= 2 || named.some((e) => e.held === false);
  if (interrupted.length) {
    const repeated = interrupted.filter((e) => e.types.includes('interrupt_repeat'));
    items.push(item(hints, 'distraction', 3, repeated.length ? OUTCOME.demonstrated : OUTCOME.partial,
      repeated.length ? 'You interrupted politely and repeated your question, a legitimate way to keep the interview focused.'
        : 'You interrupted politely, but did not repeat the interview question afterwards.',
      interrupted.slice(0, 2).flatMap((e) => pair(e, 'patient drifts', 'you interrupt')),
      interrupted[0].anchor ? `After interrupting, repeat the question word for word: “${quote(interrupted[0].anchor.text, 90)}”.` : null));
  } else if (l3Needed) {
    const e = failedRedirects[failedRedirects.length - 1] ?? named.filter((x) => x.held === false).pop();
    items.push(item(hints, 'distraction', 3, OUTCOME.missed,
      'The patient kept drifting even after you steered back, and the long tangents were not interrupted.',
      [ev(e.patient, 'patient drifts'), ev(e.response, 'your reply'), ev(e.after, 'patient drifts again')].filter(Boolean),
      e.anchor ? `Interrupting with the patient's name (“May I interrupt you briefly?”) and repeating “${quote(e.anchor.text, 90)}” verbatim would have brought the interview back.` : null));
  }

  // general tips, only for transcript-supported improvements
  if (followed.length >= 2) tips.push({ behaviour: 'distraction', tip: tip(hints, 'distraction', 'Prioritize with patient'), reason: `You followed ${followed.length} different side topics; agreeing on a priority with the patient helps when topics fragment.`, evidence: followed.slice(0, 2).map((e) => ev(e.response, 'your reply')) });
  if (redirected.length === 0 && followed.length >= 1) tips.push({ behaviour: 'distraction', tip: tip(hints, 'distraction', 'Therapist leads'), reason: 'The patient set the direction throughout; the interview benefits when you explicitly lead it.', evidence: [ev(followed[0].response, 'your reply')] });
  if (failedRedirects.length >= 2) tips.push({ behaviour: 'distraction', tip: tip(hints, 'distraction', 'Set goal upfront'), reason: 'You steered back repeatedly without progress; a clear goal helps you decide when to steer harder or close the topic.', evidence: failedRedirects.slice(0, 2).map((e) => ev(e.response, 'you steer back')) });
  return { items: items.filter(Boolean), tips: tips.filter((t) => t.tip) };
}

// ---------------------------------------------------------------- aggression coaching
function aggressionCoaching(hints, eps, turns) {
  const items = [], tips = [];
  if (!eps.length) return { items, tips };
  const LABEL = { 1: 'irritated comments', 2: 'open confrontation', 3: 'threatening or menacing language' };

  const levelOutcome = (level, f) => {
    if (!f) return OUTCOME.insufficient;
    if (level === 1) {
      if (f.escalate) return f.validate && f.limit ? OUTCOME.partial : OUTCOME.missed;
      if (f.validate && f.limit) return OUTCOME.demonstrated;
      if (f.validate || f.limit || f.meta) return OUTCOME.partial;
      return OUTCOME.insufficient;
    }
    if (level === 2) {
      if (f.escalate) return OUTCOME.missed;
      if (f.meta) return OUTCOME.demonstrated;
      if (f.validate || f.limit) return OUTCOME.partial;
      return OUTCOME.insufficient;
    }
    if (f.safety) return OUTCOME.demonstrated;
    if (f.escalate) return OUTCOME.missed;
    if (f.limit || f.validate || f.meta) return OUTCOME.partial;
    return OUTCOME.missed;   // a threat followed by simply carrying on with the interview
  };

  for (const level of [1, 2, 3]) {
    const own = eps.filter((e) => e.level === level);
    if (!own.length) continue;
    const outcomes = own.map((e) => levelOutcome(level, e.flags));
    const outcome = aggregate(outcomes);
    const did = (k) => own.some((e) => e.flags?.[k]);
    const esc = own.filter((e) => e.flags?.escalate);
    const evidence = own.slice(0, 3).flatMap((e) => pair(e, `patient: ${LABEL[level]}`, e.flags?.escalate ? 'your reply (escalates)' : 'your reply'));
    let observed, improvement = null;
    if (outcome === OUTCOME.insufficient) {
      observed = `The patient showed ${LABEL[level]}, but there is insufficient transcript evidence to evaluate your response${own.some((e) => !e.response) ? ' (the consultation ended before you replied)' : ''}.`;
    } else if (level === 1) {
      observed = outcome === OUTCOME.demonstrated ? 'You acknowledged the patient’s frustration and set a calm limit, working on the relationship instead of correcting the content.'
        : esc.length ? `You responded to the irritation by ${did('validate') ? 'validating it but also ' : ''}arguing or defending yourself, which risks a power struggle.`
          : did('validate') ? 'You acknowledged the emotion, but did not set a limit.' : 'You set a limit, but did not acknowledge the emotion first.';
      improvement = 'Combine both in one sentence: validate the emotion (“I can hear how frustrating this is”) and set the boundary (“and I would like us to stay with this question”).';
    } else if (level === 2) {
      observed = outcome === OUTCOME.demonstrated ? 'You responded to the confrontation with metacommunication instead of a power struggle.'
        : esc.length ? 'You were drawn into the confrontation by defending your competence or arguing back.'
          : 'You stayed calm and set a boundary, but did not step back to talk about what was happening between you (metacommunication).';
      improvement = 'Speak slowly and firmly, and name the interaction itself (“It seems we are getting stuck; this is not about who is right”).';
    } else {
      observed = outcome === OUTCOME.demonstrated ? 'You recognised the threat and moved to distance, pausing or ending the conversation for safety.'
        : esc.length ? 'You answered threatening language by escalating, where verbal interventions tend to reinforce the escalation.'
          : 'After threatening language you continued talking instead of prioritising distance and safety.';
      improvement = 'At this stage keep your distance, end the conversation and put safety first, without further verbal interventions.';
    }
    items.push(item(hints, 'aggressive', level, outcome, observed, evidence, improvement));
  }

  const anyEscalation = eps.some((e) => e.flags?.escalate);
  const validatedAny = eps.some((e) => e.flags?.validate);
  const risk = turns.filter((t) => any(t.text, RISK_CONTEXT));
  if (anyEscalation) tips.push({ behaviour: 'aggressive', tip: tip(hints, 'aggressive', 'No power struggle'), reason: 'You argued back or defended yourself during the confrontation.', evidence: eps.filter((e) => e.flags?.escalate).slice(0, 2).map((e) => ev(e.response, 'your reply')) });
  if (eps.length >= 2 && !validatedAny) tips.push({ behaviour: 'aggressive', tip: tip(hints, 'aggressive', 'Classify the aggression'), reason: 'The irritation recurred and was not explored; understanding what drives it changes how to respond.', evidence: eps.slice(0, 2).map((e) => ev(e.patient, 'patient')) });
  if (risk.length) tips.push({ behaviour: 'aggressive', tip: tip(hints, 'aggressive', 'Watch risk factors'), reason: 'Aggression occurred in a conversation that mentions a risk factor named in the hints (e.g. alcohol, drugs or violence).', evidence: risk.slice(0, 2).map((t) => ev(t, t.speaker === 'doctor' ? 'you' : 'patient')) });
  if (eps.some((e) => e.level === 3)) tips.push({ behaviour: 'aggressive', tip: tip(hints, 'aggressive', 'Agree a safe word'), reason: 'The role play reached threatening language; a safe word lets either side stop the exercise immediately.', evidence: eps.filter((e) => e.level === 3).slice(0, 1).map((e) => ev(e.patient, 'patient')) });
  const lastPatient = [...turns].reverse().find((t) => t.speaker === 'patient');
  if (eps.length >= 3 && eps[eps.length - 1].patient === lastPatient) tips.push({ behaviour: 'aggressive', tip: tip(hints, 'aggressive', 'Seek supervision'), reason: 'The aggression persisted to the end of the consultation despite your responses.', evidence: [ev(lastPatient, 'patient')] });
  return { items: items.filter(Boolean), tips: tips.filter((t) => t.tip) };
}

// ---------------------------------------------------------------- entry point
/**
 * @param {Array<{id,speaker,text}>} turns  transcript turns (e.g. turnsFromAssessment(assessment))
 * @param {object} hints                    parsed ai-patient-voice/hints.json
 * @returns {{ status: 'coaching'|'insufficient_evidence', behaviours: string[], items: object[], tips: object[], reason?: string }}
 */
export function analyseCoaching(turns, hints) {
  const doctor = turns.filter((t) => t.speaker === 'doctor').length, patient = turns.filter((t) => t.speaker === 'patient').length;
  if (doctor < 1 || patient < 1) {
    return { status: 'insufficient_evidence', behaviours: [], items: [], tips: [], reason: 'The transcript does not contain an exchange between you and the patient.' };
  }
  const { distraction, aggression } = detectEpisodes(turns);
  const d = distractionCoaching(hints, distraction, turns);
  const a = aggressionCoaching(hints, aggression, turns);
  const items = [...a.items, ...d.items];
  const tips = [...a.tips, ...d.tips];
  const behaviours = [aggression.length ? 'aggressive' : null, distraction.length ? 'distraction' : null].filter(Boolean);
  if (!items.length) {
    return { status: 'insufficient_evidence', behaviours, items: [], tips: [], reason: 'The transcript shows no clear distraction or aggressive behaviour, so no strategy from the hints could be selected reliably.' };
  }
  return { status: 'coaching', behaviours, items, tips };
}
