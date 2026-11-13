import { defineConfig } from 'vite';
import { elevenLabsProxy } from './server/elevenlabs.js';
import { agentProxy } from './server/agent.js';
import { orchestrator } from './server/orchestrator.js';

export default defineConfig({
  plugins: [elevenLabsProxy(), agentProxy(), orchestrator()],
  server: {
    host: true,
    port: 5173,
    // allow cloudflared / ngrok tunnel hostnames
    allowedHosts: true,
    // MIRROR assessment backend (FastAPI), same-origin for the browser. Override: MIRROR_API_URL=http://host:port
    proxy: { '/api/consultations': { target: process.env.MIRROR_API_URL || 'http://127.0.0.1:8000', changeOrigin: true } }
  },
  preview: { proxy: { '/api/consultations': { target: process.env.MIRROR_API_URL || 'http://127.0.0.1:8000', changeOrigin: true } } },
  // only scan our own entry (a cloned ./TalkingHead repo may sit next to it)
  optimizeDeps: { entries: ['index.html', 'consult.html'] },
  // two pages: index.html = landing page (choose a patient), consult.html = the 3D consultation room
  build: { target: 'es2022', rollupOptions: { input: { main: 'index.html', consult: 'consult.html' } } }
});
