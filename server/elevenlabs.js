/**
 * ElevenLabs proxy for the Vite dev server (and `vite preview`).
 *
 *   GET  /api/voice/status  -> { configured, voiceId, model }
 *   POST /api/voice/speak   { text, voiceId? }  ->  { audio_base64, mime, alignment }
 *   POST /api/voice/transcribe  <raw audio body>  ->  { text, words:[{text,start,end}] }  (ElevenLabs speech-to-text)
 *
 * The API key lives ONLY here (env var ELEVENLABS_API_KEY from .env), never in the browser.
 * ElevenLabs "with-timestamps" returns the audio plus per-character start/end times, which the
 * browser turns into word timings for TalkingHead's lip-sync.
 *
 * Because the dev server can be exposed through a public tunnel, requests are capped
 * (length + rate) so a stranger with the link cannot burn through your credits.
 */
import { loadEnv } from 'vite';

const MAX_CHARS = 500;
const MAX_PER_MINUTE = 20;
const MAX_AUDIO_BYTES = 6 * 1024 * 1024;   // about a minute of recorded speech

function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 20_000) { reject(new Error('body too large')); req.destroy(); } });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

function readBuffer(req, max) {
  return new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    req.on('data', (c) => { n += c.length; if (n > max) { reject(new Error('audio too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function send(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(obj));
}

/** Find a setting by its usual name or common spellings, e.g. ELEVENLABS_API_KEY / eleven_labs_api / ELEVEN_LABS_API_KEY. */
function pick(env, names, pattern) {
  for (const n of names) if (env[n]) return env[n];
  const k = Object.keys(env).find((key) => pattern.test(key) && env[key]);
  return k ? env[k] : undefined;
}

export function elevenLabsProxy() {
  let env = {};
  const hits = new Map(); // ip -> [timestamps]

  const handler = async (req, res, next) => {
    const url = (req.url || '').split('?')[0];
    if (!url.startsWith('/api/voice/')) return next();

    const key = pick(env, ['ELEVENLABS_API_KEY'], /^eleven_?labs?_?api(_?key)?$/i);
    const voiceId = pick(env, ['ELEVENLABS_VOICE_ID'], /^eleven_?labs?_?voice(_?id)?$/i) || 'EXAVITQu4vr4xnSDxMaL'; // "Sarah", a premade voice
    const model = pick(env, ['ELEVENLABS_MODEL'], /^eleven_?labs?_?model$/i) || 'eleven_flash_v2_5';
    const base = (env.ELEVENLABS_BASE_URL || 'https://api.elevenlabs.io').replace(/\/$/, '');

    if (url === '/api/voice/status' && req.method === 'GET') {
      return send(res, 200, { configured: Boolean(key), voiceId, model });
    }

    if (url === '/api/voice/speak' && req.method === 'POST') {
      if (!key) return send(res, 503, { error: 'ELEVENLABS_API_KEY is not set (see .env.example)' });

      const ip = req.socket.remoteAddress || '?';
      const now = Date.now();
      const recent = (hits.get(ip) || []).filter((t) => now - t < 60_000);
      if (recent.length >= MAX_PER_MINUTE) return send(res, 429, { error: 'rate limit: too many requests' });
      recent.push(now); hits.set(ip, recent);

      let body;
      try { body = await readJson(req); } catch { return send(res, 400, { error: 'bad JSON' }); }
      const text = String(body.text ?? '').trim();
      if (!text) return send(res, 400, { error: 'text is empty' });
      if (text.length > MAX_CHARS) return send(res, 400, { error: `text too long (max ${MAX_CHARS} characters)` });
      const voice = /^[A-Za-z0-9]{10,40}$/.test(body.voiceId || '') ? body.voiceId : voiceId;

      try {
        const r = await fetch(`${base}/v1/text-to-speech/${voice}/with-timestamps?output_format=mp3_44100_128`, {
          method: 'POST',
          headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ text, model_id: model })
        });
        const raw = await r.text();
        if (!r.ok) {
          let detail = raw.slice(0, 300);
          try { const j = JSON.parse(raw); detail = j.detail?.message || j.detail?.status || JSON.stringify(j.detail ?? j).slice(0, 300); } catch { /* keep raw */ }
          return send(res, r.status === 401 ? 401 : 502, { error: `ElevenLabs error ${r.status}: ${detail}` });
        }
        const j = JSON.parse(raw);
        return send(res, 200, {
          audio_base64: j.audio_base64,
          mime: j.audio_mime || 'audio/mpeg',
          alignment: j.alignment || j.normalized_alignment || null
        });
      } catch (e) {
        return send(res, 502, { error: 'could not reach ElevenLabs: ' + e.message });
      }
    }

    if (url === '/api/voice/transcribe' && req.method === 'POST') {
      if (!key) return send(res, 503, { error: 'ELEVENLABS_API_KEY is not set (see .env.example)' });
      const ip = req.socket.remoteAddress || '?';
      const now = Date.now();
      const recent = (hits.get(ip) || []).filter((t) => now - t < 60_000);
      if (recent.length >= MAX_PER_MINUTE) return send(res, 429, { error: 'rate limit: too many requests' });
      recent.push(now); hits.set(ip, recent);

      let audio;
      try { audio = await readBuffer(req, MAX_AUDIO_BYTES); } catch (e) { return send(res, 413, { error: e.message }); }
      if (audio.length < 800) return send(res, 400, { error: 'recording is empty' });
      const type = String(req.headers['content-type'] || 'audio/webm').split(';')[0];
      try {
        const fd = new FormData();
        fd.append('model_id', 'scribe_v1');
        fd.append('tag_audio_events', 'false');
        fd.append('file', new Blob([audio], { type }), 'speech.' + (type.includes('mp4') ? 'mp4' : type.includes('mpeg') ? 'mp3' : type.includes('wav') ? 'wav' : 'webm'));
        const r = await fetch(`${base}/v1/speech-to-text`, { method: 'POST', headers: { 'xi-api-key': key }, body: fd });
        const raw = await r.text();
        if (!r.ok) {
          let detail = raw.slice(0, 300);
          try { const j = JSON.parse(raw); detail = j.detail?.message || j.detail?.status || JSON.stringify(j.detail ?? j).slice(0, 300); } catch { /* keep raw */ }
          return send(res, r.status === 401 ? 401 : 502, { error: `ElevenLabs error ${r.status}: ${detail}` });
        }
        const j = JSON.parse(raw);
        const words = (j.words || []).filter((w) => w.type === 'word').map((w) => ({ text: w.text, start: w.start, end: w.end }));
        return send(res, 200, { text: (j.text || '').trim(), language: j.language_code || null, words });
      } catch (e) {
        return send(res, 502, { error: 'could not reach ElevenLabs: ' + e.message });
      }
    }
    return send(res, 404, { error: 'not found' });
  };

  return {
    name: 'psytrain-elevenlabs',
    configResolved(config) { env = loadEnv(config.mode, config.root, ''); },
    configureServer(server) { server.middlewares.use(handler); },
    configurePreviewServer(server) { server.middlewares.use(handler); }
  };
}
