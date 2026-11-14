import { chromium } from 'playwright-core';
const EXE = process.env.HOME + '/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell';
const browser = await chromium.launch({
  executablePath: EXE, headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--disable-gpu-sandbox']
});
const page = await browser.newPage({ viewport: { width: 640, height: 800 } });
page.on('console', (m) => console.log('[console]', m.type(), m.text().slice(0, 300)));
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('requestfailed', (r) => console.log('[reqfail]', r.url(), r.failure()?.errorText));
await page.goto('http://localhost:5199/?patient=young-woman', { waitUntil: 'domcontentloaded' });
for (let i = 0; i < 10; i++) {
  await page.waitForTimeout(6000);
  const st = await page.evaluate(() => ({
    status: document.getElementById('status')?.textContent,
    hasPatient: !!window.patient,
    webgl: (() => { try { const c = document.createElement('canvas'); return !!c.getContext('webgl2'); } catch (e) { return 'err:' + e.message; } })()
  }));
  console.log('t=' + (i + 1) * 6 + 's', JSON.stringify(st));
  if (st.hasPatient) break;
}
await page.screenshot({ path: '/tmp/shots/probe.png' });
await browser.close();
