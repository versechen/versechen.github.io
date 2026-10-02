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
 const state=await page.locator('.hero-gradient').evaluate(async el=>{
  const css=getComputedStyle(el);const url=css.backgroundImage.match(/url\("?([^"\)]+)/)?.[1];
  let loaded=false;if(url){const img=new Image();img.src=url;await img.decode();loaded=img.naturalWidth>0;}
  return {background:css.backgroundImage,opacity:css.opacity,visibility:css.visibility,zIndex:css.zIndex,loaded,rect:el.getBoundingClientRect().toJSON()};
 });
 assert.match(state.background,new RegExp(width===390?'poetize-coast-mobile.webp':'poetize-coast.webp'),`${width} dark=${dark}`);
 assert.equal(await page.locator('.hero-site-name').evaluate(el=>getComputedStyle(el).fontWeight),'500');
 assert.equal(await page.locator('.wall-card .card-title').first().evaluate(el=>getComputedStyle(el).fontWeight),'600');
 assert.match(await page.locator('body').evaluate(el=>getComputedStyle(el).fontFamily),/PingFang SC/);
 assert.equal(state.loaded,true);assert.equal(state.opacity,'1');assert.equal(state.visibility,'visible');assert.equal(state.rect.width,width);assert.ok(state.rect.height>=400);
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.screenshot({path:`${out}/hero-${width}-${dark?'dark':'light'}.png`});
 await page.locator('#visual-theme-btn').click();
 assert.doesNotMatch(await page.locator('.hero-gradient').evaluate(el=>getComputedStyle(el).backgroundImage),/poetize-coast/);
 await page.locator('#visual-theme-btn').click();await page.reload();
 assert.match(await page.locator('.hero-gradient').evaluate(el=>getComputedStyle(el).backgroundImage),/poetize-coast/);
 await page.close();
}
console.log('PASS 2048/1440/390 × dark/light: painted hero loaded, full-width visible layer, screenshots, Sakura switch and persisted Poetize return');await browser.close();
