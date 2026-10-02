const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
import {mkdirSync} from 'node:fs';
const base=process.env.PREVIEW_URL||'http://127.0.0.2:4322';
const out=process.env.PREVIEW_EVIDENCE||'/workspace/coastal-refinement-evidence';mkdirSync(out,{recursive:true});import assert from 'node:assert/strict';
const b=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
const checks=[];
for(const dark of [false,true]){const p=await b.newPage({viewport:{width:1440,height:1152}});await p.addInitScript(d=>{localStorage.setItem('visual-theme','poetize');localStorage.setItem('theme',d?'dark':'light');},dark);await p.goto(base+'/blog/');await p.evaluate(()=>document.fonts.ready);
const pairs=await p.evaluate(()=>{const s=getComputedStyle(document.documentElement),v=n=>s.getPropertyValue(n).trim();return [['body',v('--text-1'),v('--surface')],['secondary',v('--text-2'),v('--surface')],['muted',v('--text-muted'),v('--surface')],['sidebar',v('--text-2'),v('--coast-paper')],['selected',v('--text-1'),v('--coast-selected')]]});
const lum=hex=>{const a=hex.replace('#','').match(/../g).map(x=>parseInt(x,16)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4);return a[0]*.2126+a[1]*.7152+a[2]*.0722};
for(const [name,fg,bg] of pairs){const x=lum(fg),y=lum(bg),ratio=(Math.max(x,y)+.05)/(Math.min(x,y)+.05);assert.ok(ratio>=4.5,`${dark} ${name} ${ratio}`);checks.push({dark,name,ratio:+ratio.toFixed(2)});}
await p.locator('#search-input').focus();await p.screenshot({path:`${out}/sidebar-focus-${dark?'dark':'light'}.png`});
await p.locator('[data-facet="tag"]').first().click();assert.equal(await p.locator('[data-facet="tag"]').first().getAttribute('aria-pressed'),'true');await p.screenshot({path:`${out}/sidebar-tag-${dark?'dark':'light'}.png`});await p.close();}
console.log(JSON.stringify(checks,null,2));await b.close();
