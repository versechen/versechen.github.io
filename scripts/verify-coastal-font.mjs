import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.PREVIEW_URL||'http://127.0.0.2:4322';
const out='/workspace/font-evidence';mkdirSync(out,{recursive:true});
const b=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});const results=[];
for(const width of [1440,390])for(const dark of [false,true]){
 const p=await b.newPage({viewport:{width,height:width===390?844:1152},deviceScaleFactor:2,reducedMotion:'reduce'});
 await p.addInitScript(d=>{if(!localStorage.getItem('visual-theme'))localStorage.setItem('visual-theme','poetize');localStorage.setItem('theme',d?'dark':'light');},dark);
 for(const [route,label,selector] of [['/','home','.hero-site-name'],['/blog/','blog','.blog-head-title'],['/about/','about','.page-hero-title'],['/blog/markdown-style-guide/','article','.post-header .post-title'],['/editor-preview/','editor','#demo-rendered h1']]){
  await p.goto(base+route);await p.evaluate(()=>document.fonts.ready);await p.waitForTimeout(400);
  assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  const font=await p.locator(selector).first().evaluate(el=>({family:getComputedStyle(el).fontFamily,weight:getComputedStyle(el).fontWeight}));
  assert.match(font.family,/Coastal Hand/);assert.equal(font.weight,'400');
  assert.match(await p.locator('#site-header .nav-link').first().evaluate(el=>getComputedStyle(el).fontFamily),/Coastal Hand/);
  assert.ok(await p.evaluate(()=>document.fonts.check('400 24px "Coastal Hand"','代码陈诗首页博客读书项目生活友链关于')));
  assert.ok(await p.evaluate(()=>performance.getEntriesByType('resource').some(r=>r.name.endsWith('/fonts/coastal-hand.woff2'))));
  assert.doesNotMatch(await p.locator('body').evaluate(el=>getComputedStyle(el).fontFamily),/Coastal Hand/);
  if(route.includes('markdown-style'))assert.match(await p.locator('code').first().evaluate(el=>getComputedStyle(el).fontFamily),/mono/i);
  await p.screenshot({path:`${out}/${label}-${width}-${dark?'dark':'light'}.png`});results.push({route,width,dark,...font});
 }
 await p.goto(base+'/');await p.locator('#visual-theme-btn').click();await p.waitForFunction(()=>document.documentElement.dataset.visualTheme==='original');await p.reload();
 assert.doesNotMatch(await p.locator('.hero-site-name').evaluate(el=>getComputedStyle(el).fontFamily),/Coastal Hand/);

 await p.close();
}
const original=await b.newPage();const loads=[];original.on('request',r=>loads.push(r.url()));await original.goto(base+'/?visual-theme=original');await original.evaluate(()=>document.fonts.ready);assert.equal(loads.some(u=>u.endsWith('/fonts/coastal-hand.woff2')),false);await original.close();
await b.close();writeFileSync(out+'/results.json',JSON.stringify(results,null,2));console.log('PASS 20 font/layout states; actual local font load, weight, prose/code separation, Sakura exclusion');
