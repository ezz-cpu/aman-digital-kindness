import { chromium } from '@playwright/test';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const installed = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || (existsSync(installed) ? installed : undefined) });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', bypassCSP: true });
let failures = 0;
try {
  for (const language of ['ar', 'en']) {
  for (const route of ['index.html', 'about.html', 'resources.html', 'interactive.html', 'login.html', 'signup.html', 'privacy.html']) {
    await page.goto(`http://127.0.0.1:3000/${route}`);
    await page.waitForLoadState('networkidle');
    if (await page.locator('html').getAttribute('lang') !== language) await page.locator('[data-language]').click();
    await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') });
    const result = await page.evaluate(async () => await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } }));
    if (result.violations.length) {
      failures += result.violations.length;
      console.log(JSON.stringify({ language, route, violations: result.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => ({ target: n.target, issue: n.failureSummary })) })) }));
    } else console.log(`PASS: ${language} ${route} accessibility checks`);
  }
  }
} finally { await browser.close(); }
if (failures) process.exitCode = 1;
