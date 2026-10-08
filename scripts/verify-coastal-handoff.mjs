import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync} from 'node:fs';
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.PREVIEW_URL || 'http://127.0.0.1:4338';
const out = process.env.PREVIEW_EVIDENCE || '/tmp/coastal-handoff';
mkdirSync(out, {recursive: true});
const browser = await chromium.launch({executablePath: process.env.CHROME_PATH || undefined});
const checks = [], errors = [];
try {
  for (const [label, viewport] of [['desktop', {width: 1440, height: 900}], ['mobile', {width: 390, height: 844}]]) {
    const page = await browser.newPage({viewport});
    page.on('pageerror', error => errors.push(String(error)));
    await page.goto(`${base}/?visual-theme=poetize`);
    await page.waitForFunction(() => document.documentElement.dataset.coastalReady === 'true');
    const arrival = async (path, kind) => {
      await page.waitForURL(url => url.pathname.replace(/\/$/, '') === path);
      await page.waitForFunction(() => document.querySelector('#coastal-tide')?.dataset.tidePhase === 'arrive');
      const canvas = page.locator('#coastal-tide');
      assert.equal(await canvas.getAttribute('data-tide-source'), 'continued');
      assert.equal(await canvas.getAttribute('data-tide'), kind);
      const first = await canvas.evaluate(el => ({image: el.toDataURL(), hidden: el.hidden, pointer: getComputedStyle(el).pointerEvents, z: getComputedStyle(el).zIndex}));
      assert.equal(first.hidden, false);
      assert.equal(first.pointer, 'none');
      assert.equal(first.z, '106');
      await page.waitForTimeout(150);
      assert.notEqual(await canvas.evaluate(el => el.toDataURL()), first.image, 'Water must keep moving after navigation');
      await page.screenshot({path: `${out}/${label}-${kind}.png`});
      // Browser visibility simulation exercises both the component and the navigation observer.
      await page.evaluate(() => {Object.defineProperty(document, 'hidden', {configurable: true, value: true}); document.dispatchEvent(new Event('visibilitychange'));});
      const paused = await canvas.evaluate(el => el.toDataURL());
      await page.waitForTimeout(2400);
      assert.equal(await canvas.evaluate(el => el.toDataURL()), paused);
      await page.evaluate(() => {delete document.hidden; document.dispatchEvent(new Event('visibilitychange'));});
      assert.equal(await canvas.evaluate(el => el.hidden), false);
      await page.waitForFunction(() => document.querySelector('#coastal-tide').hidden, {}, {timeout: 8000});
      assert.equal(await canvas.getAttribute('data-tide-phase'), 'idle');
      assert.equal(await page.evaluate(() => sessionStorage.getItem('coastal-navigation-tide-v1')), null);
      checks.push(`${label}: ${kind} continues moving, pauses while hidden, resumes, and exits cleanly`);
    };
    // Exercise the same anchor listener on desktop and collapsed mobile navigation.
    await page.locator('.nav-link[href="/blog"]').evaluate(el => el.click());
    await arrival('/blog', 'sweep');
    const article = page.locator('a[href^="/blog/"]:not([href*="/series/"])').first();
    const href = await article.getAttribute('href');
    await article.evaluate(el => el.click());
    await arrival(new URL(href, base).pathname.replace(/\/$/, ''), 'rise');
    await page.goBack();
    await page.waitForTimeout(300);
    assert.equal(await page.locator('#coastal-tide').evaluate(el => el.hidden), true);
    checks.push(`${label}: history return has no frozen overlay`);
    await page.emulateMedia({reducedMotion: 'reduce'});
    await page.goto(`${base}/?visual-theme=poetize`);
    await page.waitForFunction(() => document.documentElement.dataset.poetizeMotion === 'off');
    await page.locator('.nav-link[href="/blog"]').evaluate(el => el.click());
    await page.waitForURL(url => url.pathname.replace(/\/$/, '') === '/blog');
    assert.equal(await page.locator('#coastal-tide').evaluate(el => el.hidden), true);
    checks.push(`${label}: reduced motion navigates without a tide`);
    await page.close();
  }
  assert.deepEqual(errors, []);
  writeFileSync(`${out}/results.json`, JSON.stringify({checks, errors}, null, 2));
  console.log(checks.join('\n'));
} finally {
  await browser.close();
}
