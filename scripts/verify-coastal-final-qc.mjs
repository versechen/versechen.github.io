import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.PREVIEW_URL||'http://127.0.0.2:4322',out=process.env.PREVIEW_EVIDENCE||'/workspace/coastal-refinement-evidence';mkdirSync(out,{recursive:true});
const b=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
for(const width of [2048,1440,390,360])for(const dark of [false,true]){
 const p=await b.newPage({viewport:{width,height:width<500?844:1152},deviceScaleFactor:2,reducedMotion:'reduce'});
 await p.addInitScript(d=>{localStorage.setItem('visual-theme','poetize');localStorage.setItem('theme',d?'dark':'light');},dark);
 for(const [route,scene] of [['/','home'],['/about/','studio'],['/friends/','cafe'],['/blog/','journal']]){
  await p.goto(base+route);await p.evaluate(()=>document.fonts.ready);await p.locator('.coastal-scene img').evaluate(img=>img.decode());await p.waitForTimeout(350); // Let existing staggered entry delays settle before capturing evidence.
  assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  if(route==='/'){
   for(const [id,art] of [['markdown-style-guide','journal'],['using-mdx','studio']]){
    const card=p.locator(`.wall-card[href="/blog/${id}"]`);
    assert.match(await card.locator('.card-img-bg').evaluate(el=>getComputedStyle(el).backgroundImage),new RegExp(art+'-840'));
    assert.match(await card.getAttribute('style'),/cover-markdown/);
   }
   if(width<500){assert.equal(await p.locator('.poetize-companion').isVisible(),false);assert.ok((await p.locator('.wall-card').first().boundingBox()).y<670);}
  }
  if(route==='/blog/')assert.equal(await p.locator('#poetize-petals').isVisible(),false);
  else assert.notEqual(await p.locator(route==='/'?'.hero-site-name':'.page-hero-title').evaluate(el=>getComputedStyle(el,'::before').backgroundImage),'none');
  await p.screenshot({path:`${out}/${scene}-${width}-${dark?'dark':'light'}.png`});
 }
 await p.goto(base+'/');await p.locator('#visual-theme-btn').click();
 for(const id of ['markdown-style-guide','using-mdx'])assert.match(await p.locator(`.wall-card[href="/blog/${id}"] .card-img-bg`).evaluate(el=>getComputedStyle(el).backgroundImage),/cover-markdown/);
 await p.goto(base+'/blog/markdown-style-guide/?visual-theme=poetize');assert.equal(await p.locator('#poetize-petals').isVisible(),false);assert.match(await p.locator('.poetize-article-cover').getAttribute('src'),/cover-markdown/);
 await p.close();
}
console.log('PASS 32 final layout/color/viewport states; local title scrims, coastal-only template thumbnails, original article covers, quiet forms/prose, compact mobile first card and Sakura preservation');await b.close();
