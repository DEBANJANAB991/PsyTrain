/**
 * Director agent endpoint for the Vite dev server (and `vite preview`):
 *
 *   GET  /api/agent/status  -> { configured, provider, model }
 *   POST /api/agent/step    { messages }  ->  { content, stop_reason, model, usage }
 *
 * One call = one model turn. The tools run in the BROWSER (that is where the patient lives), so the browser
 * loops: send messages -> get tool_use blocks -> run them -> send tool_results. The system prompt and the tool
 * list are fixed here, never taken from the request. Credentials (.env) never reach the browser.
 *
 * Two providers, same Messages API:
 *   - bedrock:   Claude in Amazon Bedrock (bedrock-mantle endpoint), AWS credentials from .env
 *                (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_SESSION_TOKEN, or AWS_BEARER_TOKEN_BEDROCK, or AWS_PROFILE)
 *                and AWS_REGION / AWS_DEFAULT_REGION.
 *   - anthropic: the Claude API with ANTHROPIC_API_KEY.
 * AGENT_PROVIDER picks one explicitly; otherwise Bedrock is used when AWS credentials are present.
 */
import { createHash } from 'node:crypto';
import Anthropic, { betaRefusalFallbackMiddleware, BetaFallbackState } from '@anthropic-ai/sdk';
import { AnthropicBedrockMantle } from '@anthropic-ai/bedrock-sdk';
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
  const k = pattern && Object.keys(env).find((key) => pattern.test(key) && env[key]);
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

/** Work out which provider to use and whether it has what it needs. Nothing secret leaves this function except into the SDK client. */
function resolveProvider(env) {
  const anthropicKey = pick(env, ['ANTHROPIC_API_KEY'], /^anthropic_?(api)?_?key$|^anthropic_?api$/i);
  const aws = {
    accessKey: pick(env, ['AWS_ACCESS_KEY_ID']),
    secretKey: pick(env, ['AWS_SECRET_ACCESS_KEY']),
    sessionToken: pick(env, ['AWS_SESSION_TOKEN']),
    bearer: pick(env, ['AWS_BEARER_TOKEN_BEDROCK']),
    profile: pick(env, ['AWS_PROFILE']),
    region: pick(env, ['AWS_REGION', 'AWS_DEFAULT_REGION'])
  };
  const hasAws = Boolean((aws.accessKey && aws.secretKey) || aws.bearer || aws.profile);
  const wanted = String(env.AGENT_PROVIDER || '').toLowerCase();
  const provider = wanted === 'bedrock' || wanted === 'anthropic' ? wanted : hasAws ? 'bedrock' : 'anthropic';
  const fallbacksOn = String(env.ANTHROPIC_FALLBACKS || env.AGENT_FALLBACKS || '').toLowerCase() !== 'off';

  if (provider === 'bedrock') {
    const missing = !hasAws ? 'AWS credentials (AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY, AWS_BEARER_TOKEN_BEDROCK or AWS_PROFILE)'
      : !aws.region ? 'AWS_REGION or AWS_DEFAULT_REGION' : null;
    return {
      provider, missing, fallbacksOn, aws,
      model: pick(env, ['BEDROCK_MODEL']) || 'anthropic.claude-opus-5-5',
      fallbackModel: pick(env, ['BEDROCK_FALLBACK_MODEL']) || 'anthropic.claude-opus-4-8'
    };
  }
  return {
    provider, fallbacksOn, anthropicKey,
    missing: anthropicKey ? null : 'ANTHROPIC_API_KEY',
    model: pick(env, ['ANTHROPIC_MODEL'], /^anthropic_?model$/i) || 'claude-opus-5-5',
    base: pick(env, ['ANTHROPIC_BASE_URL'], /^anthropic_?base_?url$/i)
  };
}

/**
 * One director run = one conversation, identified by its first user message (instruction + state snapshot).
 * Its fallback state pins later rounds to the model that accepted, so a refused conversation is not re-tried
 * on the declining model every round.
 */
const fallbackStates = new Map();
function fallbackStateFor(messages) {
  const id = createHash('sha256').update(JSON.stringify(messages[0])).digest('hex');
  let state = fallbackStates.get(id);
  if (!state) {
    state = new BetaFallbackState();
    fallbackStates.set(id, state);
    if (fallbackStates.size > 100) fallbackStates.delete(fallbackStates.keys().next().value);
  }
  return state;
}

/** Claude in Amazon Bedrock. Server-side `fallbacks` is not available there, so refusals are retried by the SDK middleware. */
async function callBedrock(cfg, params) {
  const { aws } = cfg;
  const auth = aws.bearer ? { apiKey: aws.bearer }
    : aws.accessKey && aws.secretKey ? { awsAccessKey: aws.accessKey, awsSecretAccessKey: aws.secretKey, awsSessionToken: aws.sessionToken || null }
    : { awsProfile: aws.profile };
  const base = { awsRegion: aws.region, ...auth };

  if (!cfg.fallbacksOn) return new AnthropicBedrockMantle(base).messages.create(params);
  const client = new AnthropicBedrockMantle({
    ...base,
    middleware: [betaRefusalFallbackMiddleware([{ model: cfg.fallbackModel }], { onError: (e) => console.warn('[agent] refusal fallback:', e.message) })]
  });
  try {
    return await client.beta.messages.create(params, { fallbackState: fallbackStateFor(params.messages) });
  } catch (e) {
    // if the fallback-credit beta is not accepted, run the plain request
    if (e instanceof Anthropic.BadRequestError && /fallback|beta/i.test(e.message)) return new AnthropicBedrockMantle(base).messages.create(params);
    throw e;
  }
}

/** The Claude API. On a safety decline the API re-runs the request on a fallback model inside the same call. */
async function callAnthropic(cfg, params) {
  const client = new Anthropic({ apiKey: cfg.anthropicKey, ...(cfg.base ? { baseURL: cfg.base } : {}) });
  if (!cfg.fallbacksOn) return client.messages.create(params);
  try {
    return await client.beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' });
  } catch (e) {
    if (e instanceof Anthropic.BadRequestError && /fallback|beta/i.test(e.message)) return client.messages.create(params);
    throw e;
  }
}

function errorReply(e, cfg) {
  const who = cfg.provider === 'bedrock' ? 'Amazon Bedrock' : 'Anthropic';
  const msg = String(e?.message || e).slice(0, 300);
  if (cfg.provider === 'bedrock') {
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
      return [e.status, { error: `Amazon Bedrock refused the request (${msg}). Check the AWS credentials in .env (temporary session credentials expire) and that ${cfg.model} is enabled for this account in ${cfg.aws.region}.` }];
    }
    if (e instanceof Anthropic.NotFoundError) return [404, { error: `Amazon Bedrock: model ${cfg.model} not found in ${cfg.aws.region} (${msg}). Set BEDROCK_MODEL in .env.` }];
  } else if (e instanceof Anthropic.AuthenticationError) {
    return [401, { error: 'Anthropic rejected the API key' }];
  }
  if (e instanceof Anthropic.RateLimitError) return [429, { error: `${who} rate limit, try again shortly` }];
  if (e instanceof Anthropic.BadRequestError) return [400, { error: `${who}: ${msg}` }];
  if (e instanceof Anthropic.APIConnectionError) return [502, { error: `could not reach ${who}: ${msg}` }];
  if (e instanceof Anthropic.APIError) return [502, { error: `${who} error ${e.status}: ${msg}` }];
  return [500, { error: 'director failed: ' + msg }];
}

export function agentProxy() {
  let env = {};
  const hits = new Map();

  const handler = async (req, res, next) => {
    const url = (req.url || '').split('?')[0];
    if (!url.startsWith('/api/agent/')) return next();

    const cfg = resolveProvider(env);

    if (url === '/api/agent/status' && req.method === 'GET') {
      return send(res, 200, { configured: !cfg.missing, provider: cfg.provider, model: cfg.model });
    }

    if (url === '/api/agent/step' && req.method === 'POST') {
      if (cfg.missing) return send(res, 503, { error: `${cfg.missing} is not set (see .env.example)` });

      const ip = req.socket.remoteAddress || '?';
      const now = Date.now();
      const recent = (hits.get(ip) || []).filter((t) => now - t < 60_000);
      if (recent.length >= MAX_PER_MINUTE) return send(res, 429, { error: 'rate limit: too many requests' });
      recent.push(now); hits.set(ip, recent);

      let body;
      try { body = await readJson(req); } catch { return send(res, 400, { error: 'bad or too large JSON' }); }
      const bad = validMessages(body.messages);
      if (bad) return send(res, 400, { error: bad });

      const params = {
        model: cfg.model,
        max_tokens: 16000,
        system: DIRECTOR_SYSTEM,
        tools: AGENT_TOOLS,
        messages: body.messages,
        output_config: { effort: 'low' }          // a short tool-calling job: keep it quick
      };

      try {
        const resp = cfg.provider === 'bedrock' ? await callBedrock(cfg, params) : await callAnthropic(cfg, params);
        return send(res, 200, { content: resp.content, stop_reason: resp.stop_reason, model: resp.model, usage: resp.usage });
      } catch (e) {
        const [status, obj] = errorReply(e, cfg);
        return send(res, status, obj);
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
