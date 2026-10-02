import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.PREVIEW_URL||'http://127.0.0.2:4322',out=process.env.PREVIEW_EVIDENCE||'/workspace/coastal-refinement-evidence';mkdirSync(out,{recursive:true});
const b=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
const results=[];
for(const width of [2048,1440,390,360]) for(const dark of [false,true]){
 const p=await b.newPage({viewport:{width,height:width<500?844:1152},deviceScaleFactor:2,reducedMotion:'reduce'});
 await p.addInitScript(d=>{localStorage.setItem('theme',d?'dark':'light');localStorage.setItem('visual-theme','poetize');},dark);
 for(const [route,scene] of [['/','home'],['/blog/','journal'],['/projects/','harbor'],['/reading/','bookshop'],['/life/','garden'],['/friends/','cafe'],['/about/','studio'],['/tags/','atlas'],['/blog/markdown-style-guide/','writing']]){
  assert.equal((await p.goto(base+route)).status(),200);await p.evaluate(()=>document.fonts.ready);await p.waitForTimeout(100);
  const art=p.locator('.coastal-scene');assert.equal(await art.getAttribute('data-scene'),scene);
  await art.locator('img').evaluate(img=>img.decode());assert.equal(await art.isVisible(),true);
  assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${width} ${route} overflow`);
  const metrics=await art.locator('img').evaluate(img=>({source:img.currentSrc,naturalWidth:img.naturalWidth,naturalHeight:img.naturalHeight,renderedWidth:img.width,renderedHeight:img.height,dpr:devicePixelRatio}));
  results.push({width,dark,route,...metrics});
  if(route==='/'||route==='/blog/'||width===1440) await p.screenshot({path:`${out}/${scene}-${width}-${dark?'dark':'light'}.png`});
  if(route==='/'){
   const content=await p.locator('.wall-section>.container').boundingBox();if(width===2048) assert.ok(content.width>=1720);
   assert.equal(await p.locator('.hero-site-name').evaluate(el=>getComputedStyle(el).fontFamily.includes('Coastal Editorial')),true);
  }
  if(route==='/blog/'){
   const title=await p.locator('.post-row .post-title').first().evaluate(el=>parseFloat(getComputedStyle(el).fontSize));assert.ok(title>=22&&title<=28);
   const search=p.locator(width<901?'#coastal-mobile-search':'#search-input');await search.fill('不存在的文章123');await p.waitForTimeout(180);assert.equal(await p.locator('#empty-state').isVisible(),true);await search.fill('');await p.waitForTimeout(180);
   if(width<901){await p.locator('#drawer-open').click();await p.waitForTimeout(200);}
   await p.locator('[data-facet="year"][data-value="2023"]').click();assert.ok(new URL(p.url()).searchParams.get('year')==='2023');await p.reload();assert.ok(new URL(p.url()).searchParams.get('year')==='2023');
  }
 }
 await p.goto(base+'/');await p.locator('#visual-theme-btn').click();assert.equal(await p.locator('.coastal-scene').isVisible(),false);assert.equal(await p.locator('.coastal-nav-icon').first().isVisible(),false);await p.locator('#visual-theme-btn').click();await p.reload();assert.equal(await p.locator('html').getAttribute('data-visual-theme'),'poetize');
 await p.close();
}
writeFileSync(out+'/results.json',JSON.stringify(results,null,2));console.log('PASS 72 route/viewport/color combinations at DPR2, distinct scenes, full-width gallery, type hierarchy, filters/search, Sakura isolation and persistence');await b.close();
