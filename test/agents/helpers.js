/** Shared test plumbing: a Vite plugin's middleware on a real local HTTP server, and SSE parsing. */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const REPO = path.resolve(new URL('../..', import.meta.url).pathname);

/** A throwaway project root with its own .env; `prompts: true` links in the real ai-patient-voice/prompts. */
export function tempRoot(envLines, { prompts = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'psytrain-test-'));
  fs.writeFileSync(path.join(dir, '.env'), envLines.join('\n') + '\n');
  if (prompts) {
    fs.mkdirSync(path.join(dir, 'ai-patient-voice'));
    fs.symlinkSync(path.join(REPO, 'ai-patient-voice', 'prompts'), path.join(dir, 'ai-patient-voice', 'prompts'));
  }
  return dir;
}

/** Start a Vite plugin's middleware on 127.0.0.1:<random>. Returns { url, close }. */
export async function serve(plugin, root) {
  plugin.configResolved({ mode: 'test', root });
  let handler;
  plugin.configureServer({ middlewares: { use: (h) => { handler = h; } } });
  const server = http.createServer((req, res) => handler(req, res, () => { res.statusCode = 404; res.end('next'); }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  return { url, server, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }) };
}

/** Read an OpenAI-style chat-completions stream: the spoken text, the chunks and whether it ended with [DONE]. */
export async function readCompletion(res) {
  const raw = await res.text();
  const events = raw.split('\n\n').filter((e) => e.startsWith('data: ')).map((e) => e.slice(6));
  const done = events.at(-1) === '[DONE]';
  const chunks = events.filter((e) => e !== '[DONE]').map((e) => JSON.parse(e));
  const text = chunks.map((c) => c.choices[0].delta.content || '').join('');
  return { text, chunks, done, finish: chunks.at(-1)?.choices[0].finish_reason };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Poll `fn` until it returns truthy (or fail after `ms`). */
export async function until(fn, ms = 2000) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error('condition not met in time');
    await sleep(10);
  }
}
