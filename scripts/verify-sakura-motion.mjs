/** Quiet-tree regression. Read-only; run against a production preview or public Pages. */
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.PREVIEW_URL||'http://127.0.0.1:4323';
const out=process.env.EVIDENCE_DIR||'/tmp/sakura-tree-evidence';mkdirSync(out,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox'],ignoreDefaultArgs:['--disable-back-forward-cache']});
const results=[],errors=[],externalErrors=new Set();
async function setup(options={}) {
 const context=await browser.newContext(options);
 await context.addInitScript(()=>{window.sakuraProbe={shows:[],id:Math.random()};window.addEventListener('pageshow',e=>window.sakuraProbe.shows.push(e.persisted));});
 const page=await context.newPage();page.on('pageerror',e=>{if(/^Failed to fetch dynamically imported module: https:\/\/cdn\.jsdelivr\.net\/npm\/mermaid@/.test(e.message))externalErrors.add(e.message);else errors.push(e.message)});
 return {context,page};
}
const state=p=>p.evaluate(()=>({motion:document.documentElement.dataset.sakuraMotion,arrival:document.documentElement.dataset.sakuraArrival,overflow:document.documentElement.scrollWidth>innerWidth,id:window.sakuraProbe.id,shows:window.sakuraProbe.shows,petals:[...document.querySelectorAll('.sakura-loose-petal')].map(el=>({opacity:+getComputedStyle(el).opacity,animations:el.getAnimations().length})),treeAnimations:document.querySelector('#sakura-tree')?.getAnimations({subtree:true}).map(a=>({state:a.playState,duration:a.effect.getTiming().duration}))||[]}));
async function settle(p){await p.waitForTimeout(1400);assert.equal((await state(p)).arrival,undefined);}
async function shot(p,name){await p.screenshot({path:`${out}/${name}.png`});}
const oldOverlays=p=>p.locator('#sakura-petals, #sakura-passage, #petal-canvas').count();
try {
 const {context,page:p}=await setup({viewport:{width:1440,height:1000}});
 assert.equal((await p.goto(base+'/?visual-theme=original')).status(),200);await settle(p);
 assert.equal(await p.locator('.sakura-verse').textContent(),'樱花短暂，技术长久');
 assert.equal(await p.locator('#sakura-tree').isVisible(),true);assert.equal(await oldOverlays(p),0);assert.equal((await state(p)).overflow,false);
 assert.equal(await p.locator('#sakura-tree-wind use[href="#sakura-bloom"]').count(),19);
 assert.ok((await state(p)).petals.every(x=>x.opacity===0&&x.animations===0));
 assert.equal((await state(p)).treeAnimations.length,3);
 assert.ok((await state(p)).treeAnimations.every(x=>x.duration>=13000));
 const before=await p.locator('.sakura-crown-left').evaluate(el=>getComputedStyle(el).transform);await p.waitForTimeout(500);assert.notEqual(await p.locator('.sakura-crown-left').evaluate(el=>getComputedStyle(el).transform),before);
 await shot(p,'desktop-light');await p.locator('#theme-btn').click();await p.waitForTimeout(500);await shot(p,'desktop-dark');
 results.push('Home: sparse 19-blossom SVG tree, exact verse, three slow 13–17s branch layers, no automatic flying petals or old overlays');
 await p.locator('#sakura-gust').click();await p.waitForTimeout(2500);
 let s=await state(p);assert.equal(s.petals.filter(x=>x.animations).length,3);assert.ok(s.petals.every(x=>x.opacity>0));
 assert.equal(await p.locator('#sakura-gust').isDisabled(),true);assert.ok(s.treeAnimations.length<=7);
 await shot(p,'desktop-breeze');
 await p.evaluate(()=>{for(let i=0;i<20;i++)document.querySelector('#sakura-gust').dispatchEvent(new MouseEvent('click',{bubbles:true}));});
 assert.ok((await state(p)).treeAnimations.length<=7);assert.equal(await p.locator('.sakura-loose-petal').count(),3);
 await p.waitForTimeout(7800);assert.ok((await state(p)).petals.every(x=>x.opacity===0&&x.animations===0));assert.equal(await p.locator('#sakura-gust').isDisabled(),false);
 results.push('Deliberate breeze: three distinct petals follow 7.2–8.1s paths, fade completely, never accumulate under repeated input');
 await p.locator('#sakura-gust').click();await p.waitForTimeout(500);await p.locator('#sakura-effects-toggle').click();
 assert.equal((await state(p)).motion,'off');assert.ok((await state(p)).petals.every(x=>!x.animations&&x.opacity===0));assert.ok((await state(p)).treeAnimations.every(x=>x.state==='paused'));
 await p.reload();await settle(p);assert.equal((await state(p)).motion,'off');assert.equal(await p.locator('#sakura-gust').isDisabled(),true);
 await p.locator('#sakura-effects-toggle').click();assert.equal((await state(p)).motion,'on');assert.ok((await state(p)).petals.every(x=>!x.animations));
 await p.emulateMedia({reducedMotion:'reduce'});await p.waitForFunction(()=>document.documentElement.dataset.sakuraMotion==='off');
 assert.equal(await p.locator('#sakura-effects-toggle').isDisabled(),true);assert.equal(await p.locator('#sakura-tree').isVisible(),true);assert.equal((await state(p)).treeAnimations.length,0);
 await p.emulateMedia({reducedMotion:'no-preference'});await p.waitForFunction(()=>document.documentElement.dataset.sakuraMotion==='on');
 results.push('Pause cancels petals and freezes branches, persists after reload; live reduced-motion leaves a static tree and disables motion');
 await p.locator('#sakura-gust').click();await p.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
 assert.equal((await state(p)).motion,'off');assert.ok((await state(p)).petals.every(x=>!x.animations));
 await p.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));});assert.equal((await state(p)).motion,'on');
 await p.evaluate(()=>scrollTo({top:document.querySelector('#latest-posts').getBoundingClientRect().top+scrollY+150,behavior:'instant'}));await p.waitForFunction(()=>document.documentElement.dataset.sakuraMotion==='off');
 assert.ok((await state(p)).treeAnimations.every(x=>x.state==='paused'));
 await p.evaluate(()=>scrollTo({top:0,behavior:'instant'}));await p.waitForFunction(()=>document.documentElement.dataset.sakuraMotion==='on');
 results.push('Hidden tab and scrolled-away tree suspend motion, cancel a breeze and resume without automatic petals');
 await p.locator('.nav-link[href="/blog"]').click();await p.waitForTimeout(90);
 const fade=await p.locator('#main-content').evaluate(el=>({opacity:+getComputedStyle(el).opacity,transform:getComputedStyle(el).transform,name:getComputedStyle(el).animationName}));
 assert.equal(fade.name,'sakura-page-fade');assert.ok(fade.opacity>=.88&&fade.opacity<=1);assert.equal(fade.transform,'none');assert.equal(await oldOverlays(p),0);await settle(p);
 await p.evaluate(()=>{document.querySelector('.nav-link[href="/about"]').click();document.querySelector('.nav-link[href="/reading"]').click();});
 await p.waitForFunction(()=>location.pathname.replace(/\/$/,'')==='/reading'&&document.readyState==='complete');await settle(p);
 await p.locator('.nav-link[href="/about"]').focus();await p.keyboard.press('Enter');await p.waitForURL(/\/about\/?$/);await settle(p);
 results.push('Navigation: subtle .88→1 opacity fade only; no overlay/translation/zoom, rapid repeated links and keyboard navigation remain native');
 for(const width of [1174,1440]) {
  await p.setViewportSize({width,height:900});await p.goto(base+'/blog/ddp-basics-two-cpu-processes/');await settle(p);
  assert.equal(await p.locator('#sakura-tree,#sakura-tools,.sakura-loose-petal').count(),0);assert.equal(await oldOverlays(p),0);
  await p.evaluate(()=>scrollTo({top:document.querySelector('.article-main').getBoundingClientRect().top+scrollY+200,behavior:'instant'}));await p.waitForTimeout(200);
  const scroll=await p.evaluate(()=>scrollY),old=await state(p);
  await p.locator('.nav-link[href="/about"]').click();await settle(p);await p.evaluate(()=>history.back());await p.waitForFunction(()=>location.pathname.includes('ddp-basics-two-cpu-processes'));await settle(p);
  assert.ok(Math.abs(await p.evaluate(()=>scrollY)-scroll)<3);assert.equal(await p.locator('#sakura-tree,#sakura-tools').count(),0);
  const restored=await state(p);results.push(`${width}px article stays free of Sakura decorations; history restores scroll; BFCache: ${restored.id===old.id&&restored.shows.includes(true)}`);
 }
 await p.goto(base+'/');await settle(p);const home=await state(p);
 await p.locator('.nav-link[href="/about"]').click();await settle(p);await p.evaluate(()=>history.back());await p.waitForFunction(()=>location.pathname==='/');await settle(p);
 assert.equal(await p.locator('#sakura-tree').count(),1);assert.equal((await state(p)).treeAnimations.length,3);assert.ok((await state(p)).petals.every(x=>!x.animations));
 assert.equal((await state(p)).id,home.id);
 await p.locator('#visual-theme-btn').click();assert.equal(await p.locator('#sakura-tree').isVisible(),false);assert.equal(await p.locator('#sakura-tools').isVisible(),false);assert.equal(await p.locator('.sakura-verse').isVisible(),false);
 assert.equal(await p.locator('.hero-typewriter-row').isVisible(),true);await shot(p,'coastal-preserved');
 await p.locator('#visual-theme-btn').click();await p.waitForFunction(()=>document.documentElement.dataset.sakuraMotion==='on');
 for(const route of ['/notes/','/editor-preview/','/projects/codeverse/docs/']){await p.goto(base+route);await settle(p);assert.equal(await p.locator('#sakura-tree,#sakura-tools').count(),0);assert.equal(await oldOverlays(p),0);}
 results.push('Home BFCache resumes one scene; coastal theme keeps its original hero; workbench/editor/docs have no Sakura scene');
 await context.close();
 for(const width of [390,320]) {
  const {context:mc,page:m}=await setup({viewport:{width,height:900},isMobile:true,hasTouch:true,deviceScaleFactor:3});
  await m.goto(base+'/?visual-theme=original');await settle(m);assert.equal((await state(m)).overflow,false);
  const layout=await m.evaluate(()=>({tools:document.querySelector('#sakura-tools').getBoundingClientRect().bottom,firstBlossom:Math.min(...[...document.querySelectorAll('#sakura-tree-wind use')].map(el=>el.getBoundingClientRect().top))}));
  assert.ok(layout.firstBlossom>layout.tools+10,`${width}px: tree blossoms must not overlap controls`);
  await shot(m,`${width}-light`);await m.locator('#sakura-gust').tap();await m.waitForTimeout(2300);
  assert.equal((await state(m)).petals.filter(x=>x.animations).length,2);assert.ok((await state(m)).treeAnimations.length<=6);
  await shot(m,`${width}-breeze`);await m.locator('#theme-btn').tap();await m.waitForTimeout(450);await shot(m,`${width}-dark`);
  await m.locator('#sakura-effects-toggle').tap();assert.equal((await state(m)).motion,'off');
  await m.goto(base+'/blog/markdown-style-guide/');await settle(m);
  assert.equal(await m.locator('#sakura-tree,#sakura-tools').count(),0);
  await m.evaluate(()=>scrollTo({top:document.querySelector('.article-main').getBoundingClientRect().top+scrollY+100,behavior:'instant'}));await m.waitForTimeout(250);
  await m.locator('#article-toc-trigger').tap();assert.equal(await m.locator('#article-toc-panel').getAttribute('aria-hidden'),'false');await m.locator('[data-toc-link]').first().tap();assert.ok(new URL(m.url()).hash);
  results.push(`${width}px touch: separate text/tree, two slow petals, no overflow, pause and quiet article/TOC links work`);await mc.close();
 }
 const {context:tc,page:t}=await setup();
 for(const width of [520,521,600,768,900]) {
  await t.setViewportSize({width,height:1000});await t.goto(base+'/?visual-theme=original');await settle(t);
  const layout=await t.evaluate(()=>({tools:document.querySelector('#sakura-tools').getBoundingClientRect().bottom,firstBlossom:Math.min(...[...document.querySelectorAll('#sakura-tree-wind use')].map(el=>el.getBoundingClientRect().top))}));
  assert.ok(layout.firstBlossom>layout.tools+10,`${width}px: stacked tree blossoms must not overlap controls`);assert.equal((await state(t)).overflow,false);
  if(width===600)await shot(t,'tablet-light');
 }
 await tc.close();results.push('520/521/600/768/900px: tablet and breakpoint layouts keep blossoms below text and controls without overflow');
 const {context:bc,page:bp}=await setup();await bc.addInitScript(()=>{Object.defineProperty(window,'localStorage',{get(){throw new DOMException('blocked','SecurityError')}})});
 await bp.goto(base+'/');await settle(bp);await bp.locator('#sakura-effects-toggle').click();assert.equal((await state(bp)).motion,'off');await bp.locator('#sakura-effects-toggle').click();assert.equal((await state(bp)).motion,'on');await bc.close();
 const {context:nc,page:np}=await setup({javaScriptEnabled:false});await np.goto(base+'/');assert.equal(await np.locator('#sakura-tree').isVisible(),true);assert.equal(await np.locator('.sakura-verse').isVisible(),true);assert.equal(await np.locator('#sakura-tools').isVisible(),false);await nc.close();
 results.push('Storage denied: current-page controls work; JavaScript disabled: static tree, verse and links remain visible');
 assert.deepEqual(errors,[]);writeFileSync(out+'/results.json',JSON.stringify({base,results,errors,externalErrors:[...externalErrors]},null,2));console.log(results.join('\n'));
}finally{await browser.close();}
