import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const b=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
const base=process.env.PREVIEW_URL||'http://127.0.0.2:4322',out='/workspace/toc-gutter-evidence';mkdirSync(out,{recursive:true});const rows=[];
for(const route of ['using-mdx','markdown-style-guide'])for(const width of [2048,1440])for(const theme of ['original','poetize'])for(const dark of [false,true]){
 const p=await b.newPage({viewport:{width,height:1173},reducedMotion:'reduce'});
 await p.addInitScript(({theme,dark})=>{localStorage.setItem('visual-theme',theme);localStorage.setItem('theme',dark?'dark':'light');},{theme,dark});
 await p.goto(base+'/blog/'+route+'/');await p.evaluate(()=>scrollTo(0,scrollY+document.querySelector('.article-main').getBoundingClientRect().top+120));await p.waitForTimeout(250);
 const t=p.locator('#article-toc'),trigger=p.locator('#article-toc-trigger'),panel=p.locator('#article-toc-panel');
 assert.equal(await t.getAttribute('data-state'),'collapsed');assert.equal((await trigger.textContent()).trim(),'');
 const main=await p.locator('.article-main').boundingBox();assert.ok(Math.abs(main.x+main.width/2-width/2)<1);assert.ok(main.width<=860);
 if(theme==='poetize'&&dark)await p.screenshot({path:`${out}/${route}-${width}-hidden.png`});
 const top=Math.max(64,main.y)+32,bottom=Math.min(1173,main.y+main.height)-40;
 const coords=[[30,top],[Math.round(main.x/2),Math.round((top+bottom)/2)],[Math.round(main.x/3),bottom]];
 for(const [x,y] of coords){await p.mouse.move(main.x+100,500);await p.waitForTimeout(380);assert.equal(await t.getAttribute('data-state'),'collapsed');await p.mouse.move(x,y);await p.waitForTimeout(180);assert.equal(await t.getAttribute('data-state'),'temporary',`${x},${y}`);}
 assert.equal(await trigger.evaluate(e=>getComputedStyle(e).pointerEvents),'none');
 const rect=await panel.boundingBox();assert.ok(Math.abs(main.x-rect.x-rect.width-16)<1);
 // The narrow gutter bridge remains hit-testable during a slow crossing.
 await p.mouse.move(main.x-8,rect.y+100);await p.waitForTimeout(250);assert.equal(await t.getAttribute('data-state'),'temporary');await panel.hover();await p.waitForTimeout(220);assert.equal(await t.getAttribute('data-state'),'temporary');
 if(theme==='poetize'&&dark)await p.screenshot({path:`${out}/${route}-${width}-open.png`});
 const stable=await p.locator('.article-main').boundingBox();assert.equal(stable.x,main.x);assert.equal(stable.width,main.width);
 await p.mouse.move(width-50,600);await p.waitForTimeout(380);assert.equal(await t.getAttribute('data-state'),'collapsed');assert.equal(await panel.evaluate(e=>e.inert),true);
 await p.mouse.move(30,300);await p.waitForTimeout(180);await p.locator('#article-toc-pin').click();await p.mouse.move(width-50,600);await p.evaluate(()=>scrollBy(0,200));await p.waitForTimeout(300);assert.equal(await t.getAttribute('data-state'),'pinned');
 await p.locator('#article-toc-pin').click();await p.mouse.move(width-50,600);await p.waitForTimeout(380);assert.equal(await t.getAttribute('data-state'),'collapsed');
 await trigger.focus();await p.keyboard.press('Enter');await p.mouse.move(width-60,610);await p.waitForTimeout(250);assert.equal(await t.getAttribute('data-state'),'temporary');await p.keyboard.press('Escape');assert.equal(await t.getAttribute('data-state'),'collapsed');assert.equal(await trigger.evaluate(e=>e===document.activeElement),true);
 await p.setViewportSize({width:1100,height:900});await p.waitForTimeout(100);await p.mouse.move(30,300);await p.waitForTimeout(180);assert.equal(await t.getAttribute('data-layout'),'overlay');assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await p.mouse.move(1000,600);await p.waitForTimeout(300);await p.mouse.move(20,200);await p.waitForTimeout(180);await p.evaluate(()=>document.documentElement.dispatchEvent(new PointerEvent('pointerleave',{pointerType:'mouse'})));await p.waitForTimeout(380);assert.equal(await t.getAttribute('data-state'),'collapsed');
 rows.push({route,width,theme,dark,coordinates:coords,mainLeft:main.x,mainWidth:main.width,tocLeft:rect.x,tocWidth:rect.width,gap:main.x-rect.x-rect.width});await p.close();
}
const p=await b.newPage({viewport:{width:390,height:844},hasTouch:true,isMobile:true});await p.goto(base+'/blog/using-mdx/?visual-theme=poetize');await p.locator('#article-toc-trigger').tap();await p.locator('#article-toc-pin').tap();assert.equal(await p.locator('#article-toc').getAttribute('data-state'),'pinned');assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await p.waitForTimeout(350);await p.screenshot({path:out+'/mobile-open.png'});await p.locator('#article-toc-close').tap();assert.equal(await p.locator('#article-toc-panel').evaluate(e=>e.inert),true);await p.close();
await b.close();writeFileSync(out+'/geometry.json',JSON.stringify(rows,null,2));console.log('PASS 16 desktop route/theme/mode/width states: centered 860px reading column, 16px gap, no desktop marker, three broad-gutter coordinates, bridge crossing, leave/page exit hide without scroll, pin/unpin, keyboard/Escape, resize overlay; mobile icon/pin/close');
