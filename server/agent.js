/**
 * Director agent endpoint for the Vite dev server (and `vite preview`):
 *
 *   GET  /api/agent/status  -> { configured, model }
 *   POST /api/agent/step    { messages }  ->  { content, stop_reason, model, usage }
 *
 * One call = one model turn. The tools run in the BROWSER (that is where the patient lives), so the browser
 * loops: send messages -> get tool_use blocks -> run them -> send tool_results. The system prompt and the tool
 * list are fixed here, never taken from the request. The key (ANTHROPIC_API_KEY in .env) never reaches the browser.
 */
import Anthropic from '@anthropic-ai/sdk';
import { loadEnv } from 'vite';
import { AGENT_TOOLS, DIRECTOR_SYSTEM } from '../shared/agent-tools.js';

const MAX_PER_MINUTE = 12;
const MAX_BODY = 80_000;
const MAX_MESSAGES = 14;

function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > MAX_BODY) { reject(new Error('body too large')); req.destroy(); } });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

function send(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(obj));
}

function pick(env, names, pattern) {
  for (const n of names) if (env[n]) return env[n];
  const k = Object.keys(env).find((key) => pattern.test(key) && env[key]);
  return k ? env[k] : undefined;
}

/** Only plain user/assistant turns made of text, thinking, tool_use and tool_result blocks. */
function validMessages(messages) {
  if (!Array.isArray(messages) || messages.length < 1 || messages.length > MAX_MESSAGES) return 'messages must be an array of 1-' + MAX_MESSAGES;
  if (messages[0].role !== 'user') return 'the first message must be from the user';
  const okBlock = new Set(['text', 'thinking', 'redacted_thinking', 'tool_use', 'tool_result', 'fallback']);
  for (const m of messages) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant')) return 'bad role';
    if (typeof m.content === 'string') { if (m.content.length > 6000) return 'instruction too long'; continue; }
    if (!Array.isArray(m.content)) return 'bad content';
    for (const b of m.content) if (!b || !okBlock.has(b.type)) return 'unsupported content block';
  }
  return null;
}

export function agentProxy() {
  let env = {};
  const hits = new Map();

  const handler = async (req, res, next) => {
    const url = (req.url || '').split('?')[0];
    if (!url.startsWith('/api/agent/')) return next();

    const key = pick(env, ['ANTHROPIC_API_KEY'], /^anthropic_?(api)?_?key$|^anthropic_?api$/i);
    const model = pick(env, ['ANTHROPIC_MODEL'], /^anthropic_?model$/i) || 'claude-opus-5-5';
    const base = pick(env, ['ANTHROPIC_BASE_URL'], /^anthropic_?base_?url$/i);

    if (url === '/api/agent/status' && req.method === 'GET') return send(res, 200, { configured: Boolean(key), model });

    if (url === '/api/agent/step' && req.method === 'POST') {
      if (!key) return send(res, 503, { error: 'ANTHROPIC_API_KEY is not set (see .env.example)' });

      const ip = req.socket.remoteAddress || '?';
      const now = Date.now();
      const recent = (hits.get(ip) || []).filter((t) => now - t < 60_000);
      if (recent.length >= MAX_PER_MINUTE) return send(res, 429, { error: 'rate limit: too many requests' });
      recent.push(now); hits.set(ip, recent);

      let body;
      try { body = await readJson(req); } catch { return send(res, 400, { error: 'bad or too large JSON' }); }
      const bad = validMessages(body.messages);
      if (bad) return send(res, 400, { error: bad });

      const client = new Anthropic({ apiKey: key, ...(base ? { baseURL: base } : {}) });
      const params = {
        model,
        max_tokens: 16000,
        system: DIRECTOR_SYSTEM,
        tools: AGENT_TOOLS,
        messages: body.messages,
        output_config: { effort: 'low' }          // a short tool-calling job: keep it quick
      };
      const useFallback = String(env.ANTHROPIC_FALLBACKS || '').toLowerCase() !== 'off';

      try {
        let resp;
        if (useFallback) {
          // On a safety decline the API re-runs the request on a fallback model inside the same call.
          try {
            resp = await client.beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' });
          } catch (e) {
            if (e instanceof Anthropic.BadRequestError && /fallback|beta/i.test(e.message)) resp = await client.messages.create(params);
            else throw e;
          }
        } else {
          resp = await client.messages.create(params);
        }
        return send(res, 200, { content: resp.content, stop_reason: resp.stop_reason, model: resp.model, usage: resp.usage });
      } catch (e) {
        if (e instanceof Anthropic.AuthenticationError) return send(res, 401, { error: 'Anthropic rejected the API key' });
        if (e instanceof Anthropic.RateLimitError) return send(res, 429, { error: 'Anthropic rate limit, try again shortly' });
        if (e instanceof Anthropic.BadRequestError) return send(res, 400, { error: 'Anthropic: ' + e.message.slice(0, 300) });
        if (e instanceof Anthropic.APIConnectionError) return send(res, 502, { error: 'could not reach Anthropic: ' + e.message });
        if (e instanceof Anthropic.APIError) return send(res, 502, { error: `Anthropic error ${e.status}: ${String(e.message).slice(0, 300)}` });
        return send(res, 500, { error: 'director failed: ' + e.message });
      }
    }
    return send(res, 404, { error: 'not found' });
  };

  return {
    name: 'psytrain-agent',
    configResolved(config) { env = loadEnv(config.mode, config.root, ''); },
    configureServer(server) { server.middlewares.use(handler); },
    configurePreviewServer(server) { server.middlewares.use(handler); }
  };
}
