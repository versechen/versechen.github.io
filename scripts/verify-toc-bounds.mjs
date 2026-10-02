/** Browser regression: run against a built preview or the deployed public blog. Never writes notes. */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
const base = process.env.PREVIEW_URL || 'http://127.0.0.1:4322';
const out = process.env.EVIDENCE_DIR || '/tmp/toc-bounds-evidence';
mkdirSync(out, { recursive: true });
const rows = [];
const settle = p => p.waitForTimeout(350);
async function geometry(p, stage, expected) {
  const value = await p.evaluate(() => {
    const toc = document.querySelector('#article-toc'), panel = document.querySelector('#article-toc-panel'), trigger = document.querySelector('#article-toc-trigger');
    const a = document.querySelector('.article-main').getBoundingClientRect(), b = panel.getBoundingClientRect();
    const css = getComputedStyle(panel), nav = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--nav-height')) || 64;
    return { open: toc.classList.contains('is-open'), available: toc.dataset.available === 'true', state: toc.dataset.state, inert: panel.inert, aria: panel.getAttribute('aria-hidden'), expanded: trigger.getAttribute('aria-expanded'), pointer: css.pointerEvents, visibility: css.visibility, top: b.top, bottom: b.bottom, height: b.height, left: b.left, width: b.width, articleTop: a.top, articleBottom: a.bottom, articleLeft: a.left, articleWidth: a.width, viewport: innerHeight, nav, scrollHeight: panel.scrollHeight, clientHeight: panel.clientHeight };
  });
  assert.equal(value.available, Math.min(value.viewport - 16, value.articleBottom) - Math.max(value.nav + 16, value.articleTop) >= 128, stage);
  if (expected !== undefined) assert.equal(value.open, expected, stage);
  if (value.open) {
    assert.ok(value.top >= value.articleTop - .5 && value.bottom <= value.articleBottom + .5, `${stage}: outside article ${JSON.stringify(value)}`);
    assert.ok(value.top >= value.nav + 15.5 && value.bottom <= value.viewport - 15.5, stage);
    assert.equal(value.inert, false); assert.equal(value.aria, 'false'); assert.equal(value.expanded, 'true');
  } else {
    assert.equal(value.inert, true); assert.equal(value.aria, 'true'); assert.equal(value.expanded, 'false'); assert.equal(value.pointer, 'none'); assert.equal(value.visibility, 'hidden');
  }
  rows.push({ stage, ...value }); return value;
}
async function bodyAt(p, top) { await p.evaluate(top => scrollTo(0, scrollY + document.querySelector('.article-main').getBoundingClientRect().top - top), top); await settle(p); }
async function open(p, mobile) {
  if (mobile) await p.locator('#article-toc-trigger').tap();
  else { const a = await p.locator('.article-main').boundingBox(); await p.mouse.move(30, Math.max(80, a.y) + 50); }
  await settle(p);
}
try {
for (const route of ['using-mdx', 'markdown-style-guide']) for (const width of [1440, 2048, 390]) for (const theme of ['original', 'poetize']) for (const dark of [false, true]) {
  const mobile = width === 390, label = `${route}-${width}-${theme}-${dark ? 'dark' : 'light'}`;
  const p = await browser.newPage({ viewport: { width, height: 900 }, hasTouch: mobile, isMobile: mobile, reducedMotion: 'reduce' });
  await p.addInitScript(({ theme, dark }) => { localStorage.setItem('visual-theme', theme); localStorage.setItem('theme', dark ? 'dark' : 'light'); }, { theme, dark });
  await p.goto(`${base}/blog/${route}/`); await p.evaluate(() => document.fonts.ready); await settle(p);
  await geometry(p, `${label}: initial collapsed`, false);
  await bodyAt(p, 300); await open(p, mobile);
  const atTop = await geometry(p, `${label}: body top visible`, true);
  assert.ok(atTop.articleWidth <= 860.5);
  if (!mobile) { assert.ok(Math.abs(atTop.articleLeft + atTop.articleWidth / 2 - width / 2) < 1); assert.ok(Math.abs(atTop.articleLeft - atTop.left - atTop.width - 16) < 1); await p.locator('#article-toc-panel').hover(); }
  await geometry(p, `${label}: panel hold`, true);
  await p.screenshot({ path: `${out}/${label}-entry.png` });
  await p.locator('#article-toc-pin').click();
  await p.reload(); await settle(p); await geometry(p, `${label}: persisted pin reload`, true);
  await bodyAt(p, -120); await geometry(p, `${label}: middle`, true);
  const anchor = await p.locator('[data-toc-link]').first().getAttribute('href');
  await p.evaluate(hash => { location.hash = hash; }, anchor); await settle(p); await geometry(p, `${label}: hash navigation`, true);
  // A short viewport makes the hero-only and footer-only positions reachable on both layouts.
  await p.setViewportSize({ width, height: 240 }); await p.evaluate(() => scrollTo(0, 0)); await settle(p);
  await geometry(p, `${label}: hero only pinned`, false);
  await p.evaluate(() => scrollTo(0, document.documentElement.scrollHeight)); await settle(p);
  const footer = await geometry(p, `${label}: footer only pinned`, false); assert.ok(footer.articleBottom <= 80, `${label}: footer-only position`);
  await p.screenshot({ path: `${out}/${label}-footer.png` });
  await p.setViewportSize({ width, height: 900 }); await bodyAt(p, 300); await geometry(p, `${label}: pin re-entry`, true);
  await p.locator('#article-toc-close').click(); await geometry(p, `${label}: close`, false);
  if (!mobile) {
    await p.locator('#article-toc-trigger').focus(); await p.keyboard.press('Enter'); await geometry(p, `${label}: keyboard`, true);
    await p.keyboard.press('Escape'); await geometry(p, `${label}: Escape`, false);
    await open(p, false);
    await p.setViewportSize({ width, height: 240 }); await p.evaluate(() => scrollTo(0, 0)); await settle(p); await geometry(p, `${label}: temporary leaves body`, false);
    await p.setViewportSize({ width, height: 900 }); await bodyAt(p, 300); // pointer stays still
    await geometry(p, `${label}: stationary pointer re-entry`);
    await p.mouse.move(width - 20, 500); await settle(p); await geometry(p, `${label}: leave gutter`, false);
  }
  assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await p.close();
}
writeFileSync(`${out}/geometry.json`, JSON.stringify(rows, null, 2));
console.log(`PASS ${rows.length} actual-browser geometry/accessibility checks across both routes, 3 widths, 2 visual themes and light/dark`);
} finally { await browser.close(); }
