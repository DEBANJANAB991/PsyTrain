// Creates (or updates) the ElevenLabs patient agent from agent/patient-prompt.md.
//   npm run agent
// Reads ELEVENLABS_API_KEY (+ optional ELEVENLABS_AGENT_ID, ELEVENLABS_VOICE_ID) from .env.
// On first run it creates the agent and writes ELEVENLABS_AGENT_ID back into .env;
// later runs update that agent with the current prompt.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const ENV = new URL('../.env', import.meta.url);
if (!existsSync(ENV)) {
  console.error('No .env found. Copy .env.example to .env and put your ElevenLabs API key in it.');
  process.exit(1);
}
process.loadEnvFile(ENV);

const apiKey = process.env.ELEVENLABS_API_KEY;
if (!apiKey || apiKey.startsWith('sk_xxx')) {
  console.error('ELEVENLABS_API_KEY is missing in .env.');
  process.exit(1);
}

const API = 'https://api.elevenlabs.io/v1/convai/agents';
const prompt = readFileSync(new URL('../agent/patient-prompt.md', import.meta.url), 'utf8');

const body = {
  name: 'PsyTrain - Julia Keller (patient)',
  tags: ['psytrain'],
  conversation_config: {
    agent: {
      language: 'en',
      first_message: "Hi! So, I'm Julia. Nice to meet you. Well, here I am, haha.",
      // temperature > 0 so tangents and anecdotes vary between runs (ElevenLabs default is 0)
      prompt: { prompt, temperature: 0.8 }
    },
    tts: {
      // Female voice "Jessica - Playful, Bright, Warm" (premade, available in our account).
      // ElevenLabs retires default voices on 31 Dec 2026; then set ELEVENLABS_VOICE_ID in .env.
      voice_id: process.env.ELEVENLABS_VOICE_ID || 'cgSgspJ2msm6clMCkdW9',
      agent_output_audio_format: 'pcm_16000' // matches pcmSampleRate in src/patient.js
    }
  }
};

const agentId = process.env.ELEVENLABS_AGENT_ID;
const res = await fetch(agentId ? `${API}/${agentId}` : `${API}/create`, {
  method: agentId ? 'PATCH' : 'POST',
  headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
  body: JSON.stringify(body)
});
const data = await res.json().catch(() => ({}));
if (!res.ok) {
  console.error(`ElevenLabs API error ${res.status}:`, JSON.stringify(data, null, 2));
  process.exit(1);
}

if (agentId) {
  console.log(`Updated agent ${agentId}`);
} else {
  const env = readFileSync(ENV, 'utf8');
  const line = `ELEVENLABS_AGENT_ID=${data.agent_id}`;
  writeFileSync(ENV, /^ELEVENLABS_AGENT_ID=.*$/m.test(env)
    ? env.replace(/^ELEVENLABS_AGENT_ID=.*$/m, line)
    : env.replace(/\n?$/, '\n') + line + '\n');
  console.log(`Created agent ${data.agent_id} (saved to .env)`);
}
console.log(`Test it: https://elevenlabs.io/app/agents/agents/${agentId || data.agent_id}`);
