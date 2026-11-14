// Screenshot harness: renders the patient in each emotion from several camera angles.
// Usage: node /tmp/shots/shoot.mjs [patientKey] [emotion...]  (default: young-woman, all emotions)
//        node /tmp/shots/shoot.mjs young-woman arms:rest|clasped|crossed   (force arm pose on neutral)
import { chromium } from 'playwright-core';
import fs from 'fs';

const EXE = process.env.HOME + '/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell';
const OUT = '/tmp/shots/out';
const BASE = 'http://localhost:5199/';
fs.mkdirSync(OUT, { recursive: true });

const patient = process.argv[2] && !process.argv[2].includes(':') ? process.argv[2] : 'young-woman';
const items = process.argv.slice(process.argv[2] && !process.argv[2].includes(':') ? 3 : 2);
const list = items.length ? items : ['neutral', 'tense', 'anxious', 'angry', 'sad', 'withdrawn', 'dismissive', 'relieved', 'excited'];

const browser = await chromium.launch({
  executablePath: EXE, headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--disable-gpu-sandbox']
});
const page = await browser.newPage({ viewport: { width: 720, height: 920 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`${BASE}?patient=${patient}`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.patient && document.getElementById('status').textContent === 'Ready', null, { timeout: 240000 });
// Freeze procedural motion so poses are comparable; keep the contact solver and gaze on.
await page.evaluate(() => {
  const p = window.patient;
  p.body.enabled = false;
  p.personality.setVariability(0);
});

const VIEWS = {
  front: { pos: [0, 1.18, -0.28], tgt: [0, 1.02, -1.40] },
  lap:   { pos: [0.06, 1.12, -0.52], tgt: [0, 0.72, -1.40] },
  side:  { pos: [1.30, 1.05, -1.38], tgt: [0, 0.92, -1.40] },
  wide:  { pos: [0.55, 1.30, 0.15], tgt: [0, 0.88, -1.40] }
};
const onlyViews = process.env.VIEWS ? process.env.VIEWS.split(',') : Object.keys(VIEWS);

for (const item of list) {
  const label = item.replace(':', '-');
  await page.evaluate((it) => {
    const p = window.patient;
    if (it.startsWith('arms:')) p.setAffect({ emotion: 'neutral', intensity: 0.9, gaze: 'student', behavior: { arms: it.slice(5) } });
    else p.setAffect({ emotion: it, intensity: 0.9, gaze: 'student', behavior: null });
  }, item);
  await page.waitForTimeout(2300);
  for (const [name, v] of Object.entries(VIEWS)) {
    if (!onlyViews.includes(name)) continue;
    await page.evaluate(({ pos, tgt }) => {
      const p = window.patient;
      p.camera.position.set(...pos);
      p.controls.target.set(...tgt);
      p.controls.update();
    }, v);
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${OUT}/${patient}-${label}-${name}.png` });
  }
  console.log('shot', patient, label);
}
await browser.close();
