import { LIPSYNC } from './config.js';

/**
 * Lip-sync scheduler. Builds the timed mouth animations that TalkingHead plays together with the audio
 * (same format as its own speakAudio(), but stronger and with jaw movement):
 *
 *  1. Visemes (mouth shapes) per word: TalkingHead's English text->viseme rules give the shapes inside each word;
 *     they are spread over that word's REAL time span (ElevenLabs / speech-to-text timestamps) and driven at
 *     near full strength (TalkingHead's own scheduler uses ~0.6, which looks like barely moving lips).
 *  2. Jaw: jawOpen follows the loudness of the actual audio (louder syllable = wider jaw, pause = closed),
 *     plus a small extra opening on open vowels.
 */

// How far each viseme is driven (1 = full). Closed-lip shapes must reach the top to look closed.
const LEVEL = { aa: 1, E: 0.9, I: 0.85, O: 1, U: 1, PP: 1, FF: 0.95, TH: 0.85, DD: 0.7, kk: 0.65, CH: 0.9, SS: 0.7, nn: 0.55, RR: 0.85, sil: 0 };
const VOWEL_JAW = { aa: 1, O: 0.7, E: 0.45, I: 0.25, U: 0.3 };

/** @returns {Array} anim entries {template:{name}, ts:[ms], vs:{morph:[null,...]}} for head.speechQueue */
export function buildLipsync(head, buffer, { words, wtimes, wdurations }, lang = 'en') {
  const anims = [];
  const g = LIPSYNC.gain;

  for (let i = 0; i < words.length; i++) {
    const T = wtimes[i];
    const D = Math.max(60, wdurations[i]);
    const pre = head.lipsyncPreProcessText(words[i], lang);
    const val = head.lipsyncWordsToVisemes(pre, lang);
    if (!val?.visemes?.length) continue;
    const n = val.visemes.length;
    const dTotal = val.times[n - 1] + val.durations[n - 1];
    if (!(dTotal > 0)) continue;
    const span = Math.min(D * LIPSYNC.wordSpanScale, n * 260);        // speech often ends a bit before the word end
    for (let j = 0; j < n; j++) {
      const v = val.visemes[j];
      const level = (LEVEL[v] ?? 0.7) * g;
      if (level <= 0) continue;
      const t = T + (val.times[j] / dTotal) * span;                    // viseme start
      const d = Math.max(50, (val.durations[j] / dTotal) * span);
      const peak = t + Math.min(30, d / 3);
      anims.push({
        template: { name: 'viseme' },
        // quick rise before the sound (co-articulation), hold through the viseme, then release
        ts: [t - Math.min(LIPSYNC.anticipation, d * 0.9), peak, t + d * 0.85, t + d + Math.min(LIPSYNC.release, d * 0.7)],
        vs: { ['viseme_' + v]: [null, Math.min(1, level), Math.min(1, level) * 0.8, 0] }
      });
      const vj = VOWEL_JAW[v];
      if (vj) {
        anims.push({
          template: { name: 'viseme' },
          ts: [t - Math.min(60, d * 0.8), peak, t + d + Math.min(60, d * 0.6)],
          vs: { jawOpen: [null, vj * LIPSYNC.jawFromVowel, 0] }
        });
      }
    }
  }

  // jaw follows the loudness of the real audio
  const env = loudnessEnvelope(buffer, LIPSYNC.envHopMs);
  if (env.length > 2) {
    const ts = [], vals = [null];
    for (let k = 0; k < env.length; k++) { ts.push(k * LIPSYNC.envHopMs); }
    for (let k = 0; k < env.length; k++) vals.push(env[k] * LIPSYNC.jawFromVoice);
    vals.length = ts.length;      // TalkingHead wants as many values as timestamps (first is null = "from current")
    vals[0] = null;
    anims.push({ template: { name: 'jaw' }, ts, vs: { jawOpen: vals } });
  }
  return anims;
}

/** Smoothed loudness 0..1 per hop (ms), normalised to the loud parts of this recording. */
export function loudnessEnvelope(buffer, hopMs = 40) {
  const data = buffer.getChannelData(0), sr = buffer.sampleRate;
  const hop = Math.max(1, Math.round((hopMs / 1000) * sr));
  const rms = [];
  for (let i = 0; i + hop <= data.length; i += hop) {
    let s = 0; for (let k = i; k < i + hop; k++) s += data[k] * data[k];
    rms.push(Math.sqrt(s / hop));
  }
  if (!rms.length) return [];
  const loud = rms.filter((x) => x > 0.01).sort((a, b) => a - b);
  const ref = loud.length ? loud[Math.floor(loud.length * 0.9)] : 1;
  const norm = rms.map((x) => Math.min(1.2, x / (ref || 1)));
  // light smoothing, so the jaw does not flutter at 25 fps
  return norm.map((_, i) => ((norm[i - 1] ?? norm[i]) + 2 * norm[i] + (norm[i + 1] ?? norm[i])) / 4)
    .map((x) => (x < 0.12 ? 0 : x));
}
