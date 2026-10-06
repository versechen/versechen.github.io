import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {test} from 'node:test';
import ts from 'typescript';
const source=ts.transpile(readFileSync(new URL('../src/lib/sakura-effects.ts',import.meta.url),'utf8'),{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS});
function fixture({width=1174,height=753,reading=false,reduced=false,paused=false,theme,saveData=false,heroHeight=height}={}){
 let time=0,id=0,seed=12345;const frames=new Map(),events=new Map(),signals=[];
 function element(){return {hidden:true,disabled:false,title:'',dataset:{},attrs:{},events:{},setAttribute(k,v){this.attrs[k]=v;},addEventListener(k,f){this.events[k]=f;}};}
 function canvas(){const c=element();let x=0,y=0;const ctx={items:[],globalAlpha:1,clearRect(){this.items=[];},setTransform(){},save(){},restore(){},translate(a,b){x=a;y=b;},rotate(){},scale(){},drawImage(_,a,b,size){this.items.push({x,y,size,alpha:this.globalAlpha});},createLinearGradient(){return{addColorStop(){}};},beginPath(){},moveTo(){},bezierCurveTo(){},lineTo(){},fill(){},stroke(){},quadraticCurveTo(){},rect(){},clip(){}};c.getContext=()=>ctx;c.ctx=ctx;return c;}
 const field=canvas(),tools=element(),toggle=element(),gust=element();
 const root={dataset:{visualTheme:theme},classList:{contains:()=>false}};
 const hero={getBoundingClientRect:()=>({bottom:heroHeight})};
 const article=reading?{getBoundingClientRect:()=>({top:280,bottom:4000,left:220,right:width-90})}:null;
 const motion={matches:reduced,addEventListener(_,fn){this.change=fn;}};
 const nodes={'#sakura-petals':field,'#sakura-tools':tools,'#sakura-effects-toggle':toggle,'#sakura-gust':gust,'.hero-wrap, .page-hero, .post-header, .blog-head, .projects-hero':hero,'.article-main':article};
 const listen=(name,fn)=>events.set(name,[...(events.get(name)||[]),fn]);
 const document={documentElement:root,hidden:false,querySelector:s=>nodes[s]||null,createElement:canvas,addEventListener:listen};
 const fire=(name,event={})=>{for(const fn of events.get(name)||[])fn(event);};
 const window={addEventListener:listen,dispatchEvent:e=>{signals.push(e.type);fire(e.type,e);}};
 const local=new Map([['sakura-effects',paused?'off':'on']]);
 const seededMath=Object.create(Math);seededMath.random=()=>((seed=Math.imul(seed,1664525)+1013904223)>>>0)/2**32;
 const exported={};
 const environment={exports:exported,document,window,Math:seededMath,innerWidth:width,innerHeight:height,devicePixelRatio:1,scrollY:0,navigator:{connection:{saveData}},matchMedia:q=>q.includes('reduced')?motion:{matches:width<768,addEventListener(){}},performance:{now:()=>time},requestAnimationFrame:fn=>{frames.set(++id,fn);return id;},cancelAnimationFrame:key=>frames.delete(key),localStorage:{getItem:k=>local.get(k),setItem:(k,v)=>local.set(k,v)},Event:class{constructor(type){this.type=type;}},CustomEvent:class{constructor(type,{detail}){this.type=type;this.detail=detail;}},MutationObserver:class{observe(){}disconnect(){}},ResizeObserver:class{observe(){}disconnect(){}}};
 runInNewContext(source,environment);exported.initSakura();
 function advance(ms,interval=1000/60){for(let end=time+ms;time<end;){time+=interval;const work=[...frames.values()];frames.clear();for(const fn of work)fn(time);}}
 return{field,tools,toggle,gust,root,frames,document,motion,fire,advance,signals,resize(w,h){width=w;height=h;environment.innerWidth=w;environment.innerHeight=h;fire('resize');}};
}
const extra=f=>+f.field.dataset.sakuraBurstCount;
const mean=a=>a.reduce((s,v)=>s+v,0)/a.length;
test('one field goes from settled baseline to a visible increment, fades and returns to baseline',()=>{
 const f=fixture();f.advance(5000);assert.equal(f.field.dataset.sakuraBasePool,'14');assert.equal(extra(f),0);
 f.fire('pageshow',{persisted:true});f.advance(800);
 assert.equal(extra(f),12);assert.equal(f.field.dataset.sakuraBurstState,'wind');
 const peak=f.field.ctx.items.slice(+f.field.dataset.sakuraBaseCount).map(p=>p.alpha);
 assert.ok(f.field.ctx.items.every(p=>p.size<=18));
 f.advance(1900);assert.equal(f.field.dataset.sakuraBurstState,'fading');assert.ok(extra(f)>0);
 const fading=f.field.ctx.items.slice(+f.field.dataset.sakuraBaseCount).map(p=>p.alpha);
 assert.ok(mean(fading)<mean(peak)*.7,'Temporary petals visibly lose opacity before removal');
 f.advance(2000);assert.equal(extra(f),0);assert.equal(f.field.dataset.sakuraBurstState,'idle');assert.equal(f.field.dataset.sakuraBasePool,'14');
 assert.ok(f.signals.includes('sakura-arrival-end'));
});
test('the increment appears in stages, never as an instantaneous dense sheet',()=>{
 const f=fixture();f.advance(100);const early=extra(f);f.advance(600);assert.ok(early<extra(f));assert.ok(extra(f)<=12);
});
test('repeated lifecycle arrivals replace the bounded temporary pool rather than accumulating',()=>{
 const f=fixture();for(let i=0;i<15;i++){f.fire('pageshow',{persisted:true});f.advance(40);}f.advance(800);assert.equal(extra(f),12);assert.equal(f.field.dataset.sakuraBasePool,'14');
 const before=f.field.ctx.items;f.advance(16);assert.ok(f.field.ctx.items.length<=26);assert.ok(before.length<=26);
});
test('pause, reduced motion, coastal theme and narrow reading keep all temporary motion off',()=>{
 for(const options of [{paused:true},{reduced:true},{theme:'poetize'},{reading:true}]){const f=fixture(options);f.advance(800);assert.equal(f.field.hidden,true);assert.equal(extra(f),0);assert.equal(f.frames.size,0);}
});
test('pausing or enabling reduced motion during the breeze clears temporary petals immediately',()=>{
 for(const stop of [f=>f.toggle.events.click(),f=>{f.motion.matches=true;f.motion.change();},f=>{f.document.hidden=true;f.fire('visibilitychange');}]){
  const f=fixture();f.advance(800);assert.ok(extra(f)>0);stop(f);assert.equal(extra(f),0);assert.equal(f.field.ctx.items.length,0);assert.equal(f.frames.size,0);
 }
});
test('mobile and data-saver have smaller base and temporary pools with the same finite lifecycle',()=>{
 for(const [options,base,burst]of [[{width:390,height:844},6,6],[{saveData:true},4,4]]){
  const f=fixture(options);f.advance(800);assert.equal(f.field.dataset.sakuraBasePool,String(base));assert.equal(extra(f),burst);f.advance(4500);assert.equal(extra(f),0);
 }
});

test('temporary petals stay visible past a short page heading and then fade by lifetime',()=>{
 const f=fixture({heroHeight:230});f.advance(800);assert.equal(extra(f),12);
 f.advance(1900);assert.ok(extra(f)>0);f.advance(2200);assert.equal(extra(f),0);
});

test('temporary lifetime follows elapsed time on slow frames instead of outliving cleanup',()=>{
 const f=fixture();f.advance(800);assert.equal(extra(f),12);f.advance(4000,120);
 assert.equal(extra(f),0);assert.equal(f.field.dataset.sakuraBurstState,'idle');
});

test('an active burst respects the smaller pool after resizing across the mobile breakpoint',()=>{
 const f=fixture({width:800});f.advance(800);assert.equal(extra(f),12);
 f.resize(767,753);f.advance(80);assert.equal(f.field.dataset.sakuraBasePool,'6');assert.ok(extra(f)<=6);
 f.advance(4500);assert.equal(extra(f),0);
});
