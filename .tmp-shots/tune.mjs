// Live pose-tuning harness. Loads the patient once, then for each experiment in a JSON file:
// merge rotation overrides into cfg.ARMS[arms], re-apply the pose, and screenshot.
// Usage: node tune.mjs <experiments.json> [patient] [views=comma,list]
// Experiment: { "name": "clasped-a", "arms": "clasped", "emotion": "anxious",
//               "arms_patch": {"LeftArm.rotation": {"x": 1.2}, ...},
//               "relax_scale": 0.5 }   // optional: scale HAND_RELAX before pose rebuild (diagnostic)
import { chromium } from 'playwright-core';
import fs from 'fs';

const EXE = process.env.HOME + '/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell';
const OUT = '/tmp/shots/tune';
fs.mkdirSync(OUT, { recursive: true });

const experiments = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const patient = process.argv[3] && !process.argv[3].includes('=') ? process.argv[3] : 'young-woman';
const views = (process.argv.find((a) => a.startsWith('views=')) || 'views=lap,front').slice(6).split(',');

const VIEWS = {
  front: { pos: [0, 1.18, -0.28], tgt: [0, 1.02, -1.40] },
  lap:   { pos: [0.06, 1.12, -0.52], tgt: [0, 0.72, -1.40] },
  lap45: { pos: [0.62, 1.05, -0.62], tgt: [0, 0.72, -1.40] },
  side:  { pos: [1.30, 1.05, -1.38], tgt: [0, 0.92, -1.40] }
};

const browser = await chromium.launch({
  executablePath: EXE, headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--disable-gpu-sandbox']
});
const page = await browser.newPage({ viewport: { width: 720, height: 920 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`http://localhost:5199/?patient=${patient}`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.patient && document.getElementById('status').textContent === 'Ready', null, { timeout: 300000 });
await page.evaluate(() => {
  const p = window.patient;
  p.body.enabled = false;
  p.personality.setVariability(0);
});

for (const exp of experiments) {
  await page.evaluate((e) => {
    const p = window.patient, cfg = p.cfg;
    const arms = e.arms || 'rest';
    if (e.arms_patch) {
      for (const [k, v] of Object.entries(e.arms_patch)) {
        cfg.ARMS[arms][k] = { ...(cfg.ARMS[arms][k] || { x: 0, y: 0, z: 0 }), ...v };
      }
    }
    p.setAffect({ emotion: e.emotion || 'neutral', intensity: e.intensity ?? 0.9, gaze: 'student', behavior: { arms, grip: e.grip ?? 0 } });
  }, exp);
  await page.waitForTimeout(1400);
  for (const name of views) {
    const v = VIEWS[name];
    await page.evaluate(({ pos, tgt }) => {
      const p = window.patient;
      p.camera.position.set(...pos);
      p.controls.target.set(...tgt);
      p.controls.update();
    }, v);
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${OUT}/${exp.name}-${name}.png` });
  }
  console.log('shot', exp.name);
}
await browser.close();
