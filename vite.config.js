import { defineConfig } from 'vite';
import { elevenLabsProxy } from './server/elevenlabs.js';

export default defineConfig({
  plugins: [elevenLabsProxy()],
  server: {
    host: true,
    port: 5173,
    // allow cloudflared / ngrok tunnel hostnames
    allowedHosts: true
  },
  // only scan our own entry (a cloned ./TalkingHead repo may sit next to it)
  optimizeDeps: { entries: ['index.html'] },
  build: { target: 'es2022' }
});
