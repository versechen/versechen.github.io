import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const b=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
const base=process.env.PREVIEW_URL||'http://127.0.0.2:4322', out='/workspace/toc-evidence';mkdirSync(out,{recursive:true});
for(const theme of ['original','poetize'])for(const dark of [false,true]){
 const p=await b.newPage({viewport:{width:1198,height:835},reducedMotion:'reduce'});
 await p.addInitScript(({theme,dark})=>{localStorage.setItem('visual-theme',theme);localStorage.setItem('theme',dark?'dark':'light');localStorage.setItem('codeverse.articleToc.pinned','1');},{theme,dark});
 await p.goto(base+'/blog/markdown-style-guide/');const state=()=>p.locator('#article-toc').getAttribute('data-state');
 assert.equal(await state(),'collapsed');await p.evaluate(()=>scrollTo(0,1000));await p.waitForTimeout(150);assert.equal(await state(),'collapsed');
 const trigger=p.locator('#article-toc-trigger'), panel=p.locator('#article-toc-panel');const y=(await trigger.boundingBox()).y;
 await p.screenshot({path:`${out}/${theme}-${dark?'dark':'light'}-collapsed.png`});
 await trigger.hover();await p.waitForTimeout(100);assert.equal(await state(),'collapsed');await p.waitForTimeout(180);assert.equal(await state(),'temporary');
 await panel.hover();await p.evaluate(()=>scrollBy(0,300));await p.waitForTimeout(150);assert.equal(await state(),'temporary');
 await p.mouse.move(1000,700);await p.evaluate(()=>scrollBy(0,140));await p.waitForTimeout(150);const opacity=await panel.evaluate(e=>+getComputedStyle(e).opacity);assert.ok(opacity>.2&&opacity<.8,`${opacity}`);
 await p.screenshot({path:`${out}/${theme}-${dark?'dark':'light'}-fade.png`});
 await p.evaluate(()=>scrollBy(0,150));await p.waitForTimeout(150);assert.equal(await state(),'collapsed');assert.equal(await panel.evaluate(e=>e.inert),true);assert.equal((await trigger.boundingBox()).y,y);
 await trigger.focus();await p.keyboard.press('Enter');assert.equal(await state(),'temporary');await p.keyboard.press('Tab');await p.evaluate(()=>scrollBy(0,400));await p.waitForTimeout(100);assert.equal(await state(),'temporary');
 await p.keyboard.press('Escape');await p.waitForTimeout(50);assert.equal(await state(),'collapsed');assert.equal(await trigger.evaluate(e=>e===document.activeElement),true);
 await trigger.click();await p.locator('#article-toc-pin').click();assert.equal(await state(),'pinned');await p.reload();assert.equal(await state(),'pinned');
 await p.locator('#article-toc-pin').click();assert.equal(await state(),'temporary');
 await p.locator('[data-toc-link]').nth(3).click();await p.waitForTimeout(200);assert.ok(new URL(p.url()).hash);assert.ok(await p.evaluate(()=>document.getElementById(decodeURIComponent(location.hash.slice(1))).getBoundingClientRect().top>=parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--nav-height'))));assert.equal(await p.locator('[data-toc-link][aria-current=location]').count(),1);await p.goBack();await p.waitForTimeout(100);
 await p.locator('#article-toc-close').click();await p.reload();assert.equal(await state(),'collapsed');
 await p.setViewportSize({width:390,height:844});assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await p.close();
}
const touch=await b.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true,reducedMotion:'reduce'});await touch.goto(base+'/blog/markdown-style-guide/?visual-theme=poetize');await touch.locator('#article-toc-trigger').tap();assert.equal(await touch.locator('#article-toc').getAttribute('data-state'),'temporary');await touch.locator('#article-toc-pin').tap();assert.equal(await touch.locator('#article-toc').getAttribute('data-state'),'pinned');await touch.screenshot({path:out+'/touch-pinned.png'});await touch.locator('#article-toc-close').tap();assert.equal(await touch.locator('#article-toc-panel').evaluate(e=>e.inert),true);await touch.close();
const normal=await b.newPage({viewport:{width:1198,height:835}});await normal.goto(base+'/blog/markdown-style-guide/?visual-theme=poetize');await normal.locator('#article-toc-trigger').focus();await normal.keyboard.press('Space');await normal.waitForTimeout(250);assert.equal(await normal.locator('#article-toc').getAttribute('data-state'),'temporary');await normal.locator('#article-toc-pin').click();await normal.screenshot({path:out+'/desktop-pinned.png'});await normal.keyboard.press('Escape');assert.equal(await normal.locator('#article-toc').getAttribute('data-state'),'collapsed');await normal.close();await b.close();console.log('PASS both themes/modes: collapsed, legacy pin ignored, hover intent, held interaction, distance fade, fixed trigger, keyboard/Escape, pin persistence/unpin, hash/back, resize and touch');
