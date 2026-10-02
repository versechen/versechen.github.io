import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.PREVIEW_URL||'http://127.0.0.2:4322';
const out=process.env.PREVIEW_EVIDENCE||'/workspace/hero-fix-evidence';mkdirSync(out,{recursive:true});
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
for(const width of [2048,1440,390]) for(const dark of [true,false]) {
 const page=await browser.newPage({viewport:{width,height:width===390?844:973}});
 await page.addInitScript(dark=>{localStorage.setItem('theme',dark?'dark':'light');localStorage.setItem('visual-theme','poetize');},dark);
 await page.goto(base+'/');await page.waitForTimeout(1600);
 const state=await page.locator('.hero-gradient img').evaluate(async img=>{
  await img.decode();const css=getComputedStyle(img);
  return {background:img.currentSrc,opacity:css.opacity,visibility:css.visibility,loaded:img.naturalWidth>0,rect:img.getBoundingClientRect().toJSON()};
 });
 assert.match(state.background,new RegExp(width===390?'home-portrait':'home-wide'),`${width} dark=${dark}`);
 assert.equal(await page.locator('.hero-site-name').evaluate(el=>getComputedStyle(el).fontWeight),'400');
 assert.equal(await page.locator('.wall-card .card-title').first().evaluate(el=>getComputedStyle(el).fontWeight),'400');
 assert.equal(state.loaded,true);assert.equal(state.opacity,'1');assert.equal(state.visibility,'visible');assert.equal(state.rect.width,width);assert.ok(state.rect.height>=400);
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.screenshot({path:`${out}/hero-${width}-${dark?'dark':'light'}.png`});
 await page.locator('#visual-theme-btn').click();
 assert.equal(await page.locator('.coastal-scene').isVisible(),false);
 await page.locator('#visual-theme-btn').click();await page.reload();
 assert.equal(await page.locator('.coastal-scene').isVisible(),true);
 await page.close();
}
console.log('PASS 2048/1440/390 × dark/light: painted hero loaded, full-width visible layer, screenshots, Sakura switch and persisted Poetize return');await browser.close();
