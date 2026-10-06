/** Read-only browser regression. Run on the built preview or public Pages deployment. */
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.PREVIEW_URL||'http://127.0.0.1:4323';
const out=process.env.EVIDENCE_DIR||'/tmp/sakura-flow-evidence';mkdirSync(out,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox'],ignoreDefaultArgs:['--disable-back-forward-cache']});
const results=[],errors=[],externalErrors=new Set();
async function setup(options={}) {
 const context=await browser.newContext(options);
 await context.addInitScript(()=>{
  window.sakuraProbe={frames:0,draws:0,maxDraws:0,items:[],history:[],shows:[],id:Math.random()};
  window.sakuraReleaseProbe={frames:0,draws:0,maxDraws:0,items:[],history:[]};
  window.addEventListener('pageshow',e=>window.sakuraProbe.shows.push(e.persisted));
  const proto=CanvasRenderingContext2D.prototype,clear=proto.clearRect,draw=proto.drawImage;
  proto.clearRect=function(...args){if(['sakura-petals','sakura-passage'].includes(this.canvas.id)){const p=this.canvas.id==='sakura-petals'?window.sakuraProbe:window.sakuraReleaseProbe;p.frames++;p.maxDraws=Math.max(p.maxDraws,p.draws);p.history.push({time:performance.now(),items:p.items});if(p.history.length>240)p.history.shift();p.draws=0;p.items=[];}return clear.apply(this,args)};
  proto.drawImage=function(...args){if(['sakura-petals','sakura-passage'].includes(this.canvas.id)){const p=this.canvas.id==='sakura-petals'?window.sakuraProbe:window.sakuraReleaseProbe,t=this.getTransform(),dpr=this.canvas.width/innerWidth;p.draws++;p.items.push({x:t.e/dpr,y:t.f/dpr,size:args[3],scale:Math.hypot(t.c,t.d)/dpr,alpha:this.globalAlpha});}return draw.apply(this,args)};
 });
 const page=await context.newPage();page.on('pageerror',e=>{if(/^Failed to fetch dynamically imported module: https:\/\/cdn\.jsdelivr\.net\/npm\/mermaid@/.test(e.message))externalErrors.add(e.message);else errors.push(e.message)});return {context,page};
}
const state=p=>p.evaluate(()=>({motion:document.documentElement.dataset.sakuraMotion,arrival:document.documentElement.dataset.sakuraArrival,hidden:document.querySelector('#sakura-petals').hidden,frames:window.sakuraProbe.frames,maxDraws:window.sakuraProbe.maxDraws,shows:window.sakuraProbe.shows,id:window.sakuraProbe.id,overflow:document.documentElement.scrollWidth>innerWidth}));
async function settled(p){await p.waitForTimeout(1200);assert.equal((await state(p)).arrival,undefined);}
async function screenshot(p,name){await p.screenshot({path:`${out}/${name}.png`});}
async function heroInk(p){return p.evaluate(()=>{const c=document.querySelector('#sakura-petals'),r=document.querySelector('.hero-body').getBoundingClientRect(),dpr=c.width/innerWidth;const data=c.getContext('2d').getImageData(Math.ceil(r.left*dpr),Math.ceil(r.top*dpr),Math.floor(r.width*dpr),Math.floor(r.height*dpr)).data;let ink=0;for(let i=3;i<data.length;i+=4)if(data[i])ink++;return ink;});}
try {
 const {context,page:p}=await setup({viewport:{width:1440,height:1000}});
 assert.equal((await p.goto(base+'/?visual-theme=original')).status(),200);
 await p.waitForTimeout(500);
 assert.ok(await p.evaluate(()=>window.sakuraProbe.history.every(f=>f.items.length<=24)),'Bounded petal pool');
 await settled(p);await p.waitForTimeout(4400);
 let s=await state(p);assert.equal(s.hidden,false);assert.ok(s.frames>8);assert.ok(s.maxDraws<=24);assert.equal(s.overflow,false);
 assert.equal(await p.locator('#sakura-tree,.sakura-verse,.sakura-home').count(),0);
 assert.equal(await p.locator('.hero-typewriter-row').isVisible(),true);
 const visible=await p.evaluate(()=>window.sakuraProbe.items);assert.ok(visible.length>=3);assert.ok(visible.every(x=>x.size>=23&&x.size<=40&&x.scale>=.99));
 assert.equal(await heroInk(p),0,'Petals must leave homepage text and buttons clear');
 assert.equal(await p.locator('#sakura-gust').isDisabled(),false,'No automatic gust on entry');
 await screenshot(p,'desktop-light');await p.locator('#theme-btn').click();await p.waitForTimeout(450);await screenshot(p,'desktop-dark');
 const beforeWind=await p.evaluate(()=>window.sakuraProbe.items);
 await p.locator('#sakura-gust').click();await p.waitForTimeout(200);
 const afterWind=await p.evaluate(()=>window.sakuraProbe.items);
 assert.ok(afterWind.every(x=>beforeWind.some(y=>Math.hypot(x.x-y.x,x.y-y.y)<14)),'Wind must not teleport or emit petals');
 assert.equal(await p.locator('#sakura-gust').isDisabled(),true);
 await p.evaluate(()=>{for(let i=0;i<30;i++)document.querySelector('#sakura-gust').dispatchEvent(new MouseEvent('click',{bubbles:true}));});
 await p.waitForTimeout(3200);assert.ok((await state(p)).maxDraws<=24);await screenshot(p,'desktop-wind');
 await p.waitForTimeout(3200);assert.equal(await p.locator('#sakura-gust').isDisabled(),false);
 results.push('Original homepage retained; <=24 layered 23–40px petals, curved motion and smooth wind preserve positions and pool');
 // Escape interrupts the delayed native navigation with no history or visibility damage.
 await p.evaluate(()=>document.querySelector('.nav-link[href="/about"]').click());
 await p.keyboard.press('Escape');await p.waitForTimeout(450);assert.equal(new URL(p.url()).pathname,'/');
 assert.equal(await p.evaluate(()=>document.documentElement.dataset.sakuraDeparture),undefined);
 // Sample an actual multi-frame arc, not a static screenshot pass.
 await p.waitForTimeout(500);
 const frameStart=await p.evaluate(()=>window.sakuraProbe.history.length);
 for(let i=0;i<6;i++){await screenshot(p,`motion-${i}`);await p.waitForTimeout(240);}
 const motionFrames=await p.evaluate(()=>window.sakuraProbe.history.slice(-36));
 const moving=motionFrames.at(-1).items.some(a=>motionFrames[0].items.some(b=>Math.abs(a.size-b.size)<.001&&Math.hypot(a.x-b.x,a.y-b.y)>8));
 assert.ok(moving,'Actual petals advance visibly across captured consecutive frames');
 writeFileSync(out+'/continuous-frames.json',JSON.stringify(motionFrames,null,2));
 results.push('Six consecutive frames show visible drifting/twirling; Escape cancels departure and leaves history unchanged');
 // Capture real arrival mid-animation on a normal link navigation.
 await p.locator('.nav-link[href="/blog"]').click();await p.waitForTimeout(90);
 assert.equal((await state(p)).arrival,'active');
 const passage=await p.locator('#main-content').evaluate(el=>({animation:getComputedStyle(el).animationName,transform:getComputedStyle(el).transform,opacity:+getComputedStyle(el).opacity}));
 assert.equal(passage.animation,'sakura-page-arrive');assert.equal(passage.transform,'none');assert.ok(passage.opacity>=.28&&passage.opacity<1);assert.equal(await p.locator('#sakura-passage').count(),1);
 assert.equal(await p.locator('#sakura-passage').isVisible(),true);
 const released=await p.evaluate(()=>window.sakuraReleaseProbe.items);assert.ok(released.length>0&&released.length<=12);assert.ok(released.every(x=>x.size>=32&&x.size<=54));
 await screenshot(p,'page-transition');await settled(p);assert.equal(await p.locator('#sakura-passage').isVisible(),false);
 results.push('Actual native navigation shows the separate large-petal release across documents, completes naturally, and leaves the fixed-TOC ancestor untransformed');
 // A visible link stays hit-testable even in the first frame; browser chooses final navigation.
 await p.evaluate(()=>{document.querySelector('.nav-link[href="/about"]').click();document.querySelector('.nav-link[href="/reading"]').click();});
 await p.waitForFunction(()=>location.pathname.replace(/\/$/,'')==='/reading' && document.readyState==='complete');await settled(p);
 assert.equal(await p.locator('#sakura-petals').count(),1);
 await p.locator('.nav-link[href="/about"]').focus();await p.keyboard.press('Enter');await p.waitForURL(/\/about\/?$/);await settled(p);
 results.push('Rapid repeated navigation and keyboard Enter reach the final page with one canvas');
 await p.goto(base+'/blog/markdown-style-guide/');await settled(p);
 await p.evaluate(()=>scrollTo({top:document.querySelector('.article-main').getBoundingClientRect().top+scrollY+240,behavior:'instant'}));await p.waitForTimeout(300);
 const clearText=await p.evaluate(()=>{
  const c=document.querySelector('#sakura-petals'),b=document.querySelector('.article-main').getBoundingClientRect(),scale=c.width/innerWidth;
  const x=Math.ceil(b.left*scale),y=Math.ceil(Math.max(80,b.top)*scale),w=Math.floor(b.width*scale),h=Math.floor((Math.min(innerHeight,b.bottom)-Math.max(80,b.top))*scale);
  const data=c.getContext('2d').getImageData(x,y,w,h).data;let ink=0;for(let i=3;i<data.length;i+=4)if(data[i])ink++;return ink;
 });assert.equal(clearText,0);
 const scroll=await p.evaluate(()=>scrollY),old=await state(p);
 await p.locator('.nav-link[href="/about"]').click();await settled(p);await p.evaluate(()=>history.back());await p.waitForFunction(()=>location.pathname.includes('markdown-style-guide'));await settled(p);
 const restored=await state(p);assert.ok(Math.abs(await p.evaluate(()=>scrollY)-scroll)<3);
 await p.evaluate(()=>history.forward());await p.waitForFunction(()=>location.pathname.replace(/\/$/,'')==='/about');await settled(p);assert.match(p.url(),/\/about\/?$/);
 results.push(`Article pixels remain clear; back/forward restores scroll (BFCache observed: ${restored.id===old.id && restored.shows.includes(true)})`);
 // Pause survives navigation, and runtime reduced-motion changes cancel every Sakura animation.
 await p.locator('#sakura-effects-toggle').click();assert.equal((await state(p)).hidden,true);
 await p.locator('.nav-link[href="/blog"]').click();await settled(p);assert.equal((await state(p)).hidden,true);
 await p.locator('#sakura-effects-toggle').click();assert.equal((await state(p)).hidden,false);
 await p.emulateMedia({reducedMotion:'reduce'});await p.waitForFunction(()=>document.querySelector('#sakura-petals').hidden);assert.equal((await state(p)).hidden,true);assert.equal(await p.locator('#sakura-effects-toggle').isDisabled(),true);
 await p.locator('.nav-link[href="/reading"]').click();assert.equal((await state(p)).arrival,undefined);
 await p.emulateMedia({reducedMotion:'no-preference'});await p.waitForFunction(()=>!document.querySelector('#sakura-petals').hidden);assert.equal((await state(p)).hidden,false);
 results.push('Pause persists across navigation; changing reduced-motion live disables particles and entry, then resumes safely');
 await p.goto(base+'/');await settled(p);
 await p.locator('#sakura-effects-toggle').click();await p.reload();await settled(p);
 assert.equal((await state(p)).hidden,true);assert.equal(await p.locator('.hero-eyebrow').evaluate(el=>getComputedStyle(el).opacity),'1');assert.equal(await p.locator('.hero-site-name').evaluate(el=>getComputedStyle(el).opacity),'1');
 await p.locator('#sakura-effects-toggle').click();assert.equal(await p.locator('#sakura-gust').isDisabled(),false);
 await p.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
 const stopped=(await state(p)).frames;await p.waitForTimeout(250);assert.equal((await state(p)).frames,stopped);
 await p.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));});await p.waitForTimeout(250);assert.ok((await state(p)).frames>stopped);
 // Simulate repeated page lifecycle signals to assert the loop doesn't multiply.
 for(let i=0;i<5;i++)await p.evaluate(()=>{dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}));dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));});
 const before=(await state(p)).frames;await p.waitForTimeout(1000);const after=(await state(p)).frames;assert.ok(after-before<=33);
 assert.equal(await p.locator('#sakura-gust').isDisabled(),false,'History restore must not start an automatic gust');
 results.push(`Hidden page stops rendering; repeated lifecycle events keep one <=30fps loop (${after-before} frames/s), without replaying a gust`);
 await p.locator('#visual-theme-btn').click();assert.equal((await state(p)).hidden,true);assert.equal(await p.locator('#sakura-tools').isVisible(),false);
 await p.locator('.nav-link[href="/blog"]').click();await settled(p);assert.equal((await state(p)).arrival,undefined);assert.equal((await state(p)).hidden,true);
 await screenshot(p,'coastal-unchanged');await p.locator('#visual-theme-btn').click();assert.equal((await state(p)).hidden,false);
 // Regression: a narrow article must not hide the only pause control while petals keep running.
 for(const width of [1024,1174,1440]) {
  await p.setViewportSize({width,height:900});await p.goto(base+'/blog/ddp-basics-two-cpu-processes/');await settled(p);
  await p.evaluate(()=>scrollTo({top:document.querySelector('.article-main').getBoundingClientRect().top+scrollY+200,behavior:'instant'}));await p.waitForTimeout(200);
  const reading=await state(p),controls=await p.locator('#sakura-tools').isVisible();
  assert.ok(reading.hidden||controls,`${width}px: moving petals must have a pause control`);
  assert.equal(reading.hidden,width<1440);assert.equal(reading.motion,width<1440?'off':'on');
  const frames=reading.frames;await p.waitForTimeout(250);
  if(width<1440)assert.equal((await state(p)).frames,frames,`${width}px: hidden controls require zero draw frames`);
  else {
   assert.ok((await state(p)).frames>frames);await p.locator('#sakura-effects-toggle').click();
   assert.equal((await state(p)).hidden,true);await p.locator('#sakura-effects-toggle').click();assert.equal((await state(p)).hidden,false);
  }
  if(width===1174) {
   await p.locator('.nav-link[href="/about"]').click();await settled(p);
   await p.evaluate(()=>history.back());await p.waitForFunction(()=>location.pathname.includes('ddp-basics-two-cpu-processes'));
   await p.waitForTimeout(100);assert.equal((await state(p)).arrival,undefined);assert.equal((await state(p)).hidden,true);
  }
  await p.evaluate(()=>scrollTo({top:0,behavior:'instant'}));await p.waitForTimeout(250);
  assert.equal(await p.locator('#sakura-tools').isVisible(),true);assert.equal((await state(p)).hidden,false);
 }
 results.push('DDP article at 1024/1174px stops and clears motion with hidden controls; 1440px retains working pause/resume; return to hero resumes safely');
 for(const route of ['/notes/','/editor-preview/','/projects/codeverse/docs/']){
  await p.goto(base+route);await settled(p);assert.equal((await state(p)).hidden,true,route);assert.equal(await p.locator('#sakura-tools').isVisible(),false,route);
 }
 results.push('Coastal and workbench/editor/docs exclude all Sakura motion and controls');
 await context.close();
 const {context:mc,page:m}=await setup({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:3});
 await m.goto(base+'/?visual-theme=original');await settled(m);assert.equal((await state(m)).hidden,false);
 assert.ok(await m.locator('#sakura-petals').evaluate(c=>c.width<=innerWidth*1.25+1));assert.ok((await state(m)).maxDraws<=9);
 let a=(await state(m)).frames;await m.waitForTimeout(1000);let b=(await state(m)).frames;const mobileFps=b-a;assert.ok(mobileFps<=25);await m.waitForTimeout(3000);
 await screenshot(m,'mobile-light');await m.locator('#theme-btn').tap();await m.waitForTimeout(450);await screenshot(m,'mobile-dark');
 assert.equal(await heroInk(m),0,'Mobile hero text and buttons must stay clear');
 await m.locator('#sakura-gust').tap();assert.equal((await state(m)).overflow,false);
 await m.evaluate(()=>scrollTo({top:innerHeight+100,behavior:'instant'}));await m.waitForTimeout(200);assert.equal((await state(m)).hidden,true);
 a=(await state(m)).frames;await m.waitForTimeout(300);assert.equal((await state(m)).frames,a);
 await m.goto(base+'/blog/markdown-style-guide/');await settled(m);
 await m.evaluate(()=>scrollTo({top:document.querySelector('.article-main').getBoundingClientRect().top+scrollY+100,behavior:'instant'}));await m.waitForTimeout(250);assert.equal((await state(m)).hidden,true);
 assert.equal(await m.locator('#sakura-tools').isVisible(),false);await m.locator('#article-toc-trigger').tap();assert.equal(await m.locator('#article-toc-panel').getAttribute('aria-hidden'),'false');
 await m.locator('[data-toc-link]').first().tap();assert.ok(new URL(m.url()).hash);assert.equal((await state(m)).arrival,undefined);
 await screenshot(m,'mobile-reading');results.push(`Mobile emulation: <=9 petals, DPR <=1.25, ${mobileFps} frames/s; stops below hero; TOC/hash stays native`);
 await m.setViewportSize({width:320,height:844});await m.goto(base+'/?visual-theme=original');await m.waitForTimeout(6000);
 if(await m.evaluate(()=>document.documentElement.classList.contains('dark')))await m.locator('#theme-btn').tap();
 await m.waitForTimeout(650); // Capture the settled light theme, after the existing theme transition.
 assert.equal((await state(m)).overflow,false);assert.equal(await heroInk(m),0);assert.ok((await state(m)).maxDraws<=9);await screenshot(m,'compact-light');
 results.push('320px phone keeps the original layout without overflow and zero petal ink over the title, copy or buttons');
 await mc.close();
 const {context:dc,page:dp}=await setup();await dc.addInitScript(()=>Object.defineProperty(navigator,'connection',{value:{saveData:true}}));
 await dp.goto(base+'/');await dp.waitForTimeout(6500);assert.ok((await state(dp)).maxDraws<=4);await dc.close();results.push('Data saver caps the same effect at four petals');
 const {context:bc,page:bp}=await setup();await bc.addInitScript(()=>{Object.defineProperty(window,'localStorage',{get(){throw new DOMException('blocked','SecurityError')}})});
 await bp.goto(base+'/');await settled(bp);await bp.locator('#sakura-effects-toggle').click();assert.equal((await state(bp)).hidden,true);await bp.locator('#sakura-effects-toggle').click();assert.equal((await state(bp)).hidden,false);
 results.push('Blocked localStorage retains functional current-page pause/resume');await bc.close();
 const {context:nc,page:np}=await setup({javaScriptEnabled:false});await np.goto(base+'/blog/');assert.equal(await np.locator('#sakura-tools').isVisible(),false);assert.ok(await np.locator('.post-link').count());await nc.close();
 results.push('Without JavaScript, content and links remain visible and decorative controls stay hidden');
 assert.deepEqual(errors,[]);writeFileSync(out+'/results.json',JSON.stringify({base,results,errors,externalErrors:[...externalErrors]},null,2));console.log(results.join('\n'));
}finally{await browser.close();}
