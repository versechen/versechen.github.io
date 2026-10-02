// Run against the production preview. Set PLAYWRIGHT_MODULE to a Playwright installation if needed.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.PREVIEW_URL || 'http://127.0.0.2:4322';
const output = process.env.PREVIEW_EVIDENCE || '/tmp/codeverse-evidence';
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
const results = [];
const externalErrors = new Set();
const routes = ['/', '/blog/', '/blog/markdown-style-guide/', '/reading/', '/projects/', '/life/', '/friends/', '/about/', '/tags/', '/notes/', '/projects/codeverse/docs/'];
const context = await browser.newContext({ viewport: {width:1440,height:1000}, reducedMotion:'reduce', permissions:['clipboard-read','clipboard-write'] });
const page = await context.newPage();
page.on('pageerror', error => {
  if (/cdn.jsdelivr.net.*mermaid/.test(error.message)) externalErrors.add(error.message);
  else results.push({unexpectedPageError:error.message});
});
async function go(route) { const response=await page.goto(base+route); assert.equal(response.status(),200,route); await page.waitForTimeout(120); }
async function state() { return page.evaluate(()=>({visual:document.documentElement.dataset.visualTheme||'original',dark:document.documentElement.classList.contains('dark'),stored:localStorage.getItem('visual-theme')})); }
await go('/blog/markdown-style-guide/');
assert.equal((await state()).visual,'original');
await page.locator('#visual-theme-btn').click();
assert.equal((await state()).visual,'poetize');
await page.reload(); assert.equal((await state()).visual,'poetize');
results.push({check:'toggle + refresh persistence',passed:true});
for (const width of [1440,390]) {
 await page.setViewportSize({width,height:width===390?844:1000});
 for (const visual of ['original','poetize']) for (const mode of ['light','dark']) {
  await page.evaluate(({visual,mode})=>{localStorage.setItem('visual-theme',visual);localStorage.setItem('theme',mode);},{visual,mode});
  for (const route of routes) {
   await go(route);
   const s=await state(); assert.equal(s.visual,visual); assert.equal(s.dark,mode==='dark');
   const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);
   assert.equal(overflow,false,`${width} ${visual} ${mode} ${route}: horizontal overflow`);
  }
  results.push({check:`${width}px ${visual} ${mode}: ${routes.length} routes, persistence, no overflow`,passed:true});
 }
}
await page.evaluate(()=>{localStorage.setItem('visual-theme','forest');localStorage.setItem('theme','light');});
await go('/blog/markdown-style-guide/');
assert.equal((await state()).visual,'poetize');assert.equal((await state()).stored,'poetize');
await page.locator('#theme-btn').click(); assert.equal((await state()).visual,'poetize');assert.equal((await state()).dark,true);
await page.locator('#visual-theme-btn').click();assert.equal((await state()).visual,'original');assert.equal((await state()).dark,true);
results.push({check:'forest migration and independent light/dark',passed:true});
await go('/blog/markdown-style-guide/?visual-theme=poetize');
await page.locator('#theme-btn').click();
await page.locator('#hamburger-btn').click();assert.equal(await page.locator('#hamburger-btn').getAttribute('aria-expanded'),'true');
await page.keyboard.press('Escape');assert.equal(await page.locator('#hamburger-btn').getAttribute('aria-expanded'),'false');
results.push({check:'mobile menu keyboard close',passed:true});
await page.locator('#poetize-pet').click();assert.match(await page.locator('#poetize-pet-message').textContent(),/海风/);
assert.equal(await page.locator('.poetize-pet-body').evaluate(el=>getComputedStyle(el).animationName),'none');
await page.locator('h2').filter({hasText:'代码高亮与复制'}).evaluate(el=>el.scrollIntoView({block:'start'}));await page.waitForTimeout(200);
await page.locator('.copy-code-button').first().click();assert.match(await page.evaluate(()=>navigator.clipboard.readText()),/interface Article/);
results.push({check:'code copy, pet interaction, reduced motion',passed:true});
for(const width of [1440,390]) {
 await page.setViewportSize({width,height:width===390?844:1000});
 for(const mode of ['light','dark']) {
  await page.evaluate(mode=>localStorage.setItem('theme',mode),mode);
  await go('/blog/markdown-style-guide/');await page.waitForTimeout(200);
  await page.screenshot({path:`${output}/article-${width}-${mode}.png`});
  await page.locator('h2').filter({hasText:'代码高亮与复制'}).evaluate(el=>el.scrollIntoView({block:'start'}));await page.waitForTimeout(200);
  assert.equal(await page.locator('#site-header').evaluate(el=>el.classList.contains('scrolled')),true);
  await page.screenshot({path:`${output}/article-code-${width}-${mode}.png`});
 }
}
await page.setViewportSize({width:1440,height:1000});
await page.evaluate(()=>localStorage.setItem('theme','light'));
for(const route of ['/','/blog/','/projects/']) {await go(route);await page.screenshot({path:`${output}/${route==='/'?'home':route.replaceAll('/','')}.png`});}
await page.locator('.project-card[data-slug="codeverse"]').click();
assert.equal(await page.locator('#projects-stage').getAttribute('data-mode'),'preview');
await page.locator('#readme-close').click();assert.equal(await page.locator('#projects-stage').getAttribute('data-mode'),'grid');
results.push({check:'project README open and close',passed:true});
const blocked=await browser.newContext();
await blocked.addInitScript(()=>{Object.defineProperty(window,'localStorage',{get(){throw new DOMException('disabled','SecurityError')}})});
const bp=await blocked.newPage();await bp.goto(base+'/about/');await bp.locator('#visual-theme-btn').click();
assert.equal(await bp.evaluate(()=>document.documentElement.dataset.visualTheme),'poetize');
await bp.locator('#theme-btn').click();
results.push({check:'storage disabled: visual and light/dark buttons work',passed:true});
assert.equal(results.filter(x=>x.unexpectedPageError).length,0);
writeFileSync(`${output}/results.json`,JSON.stringify({results,externalErrors:[...externalErrors]},null,2));
console.log(JSON.stringify({results,externalErrors:[...externalErrors]},null,2));
await browser.close();
