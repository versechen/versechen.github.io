import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {test} from 'node:test';
import ts from 'typescript';
const source=ts.transpile(readFileSync(new URL('../src/lib/sakura-effects.ts',import.meta.url),'utf8'),{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS});
function fixture({width=1174,height=753,reading=false,reduced=false,paused=false,theme,storage=new Map(),pathname='/',saveData=false}={}){
 let time=0,id=0;const frames=new Map(),events=new Map();
 function element(){return {hidden:true,disabled:false,title:'',attrs:{},events:{},setAttribute(k,v){this.attrs[k]=v;},addEventListener(k,f){this.events[k]=f;}};}
 function canvas(){const c=element();let x=0,y=0;const ctx={items:[],globalAlpha:1,clearRect(){this.items=[];},setTransform(){},save(){},restore(){},translate(a,b){x=a;y=b;},rotate(){},scale(){},drawImage(_,a,b,size){this.items.push({x,y,size,alpha:this.globalAlpha});},createLinearGradient(){return{addColorStop(){}};},beginPath(){},moveTo(){},bezierCurveTo(){},lineTo(){},fill(){},stroke(){},quadraticCurveTo(){}};c.getContext=()=>ctx;c.ctx=ctx;return c;}
 const bg=canvas(),passage=canvas(),tools=element(),toggle=element(),gust=element();
 const root={dataset:{visualTheme:theme},classList:{contains:()=>false}};
 const hero={getBoundingClientRect:()=>({bottom:height})};
 const article=reading?{getBoundingClientRect:()=>({top:280,bottom:4000,left:220,right:width-90})}:null;
 const motion={matches:reduced,addEventListener(_,fn){this.change=fn;}};
 const nodes={'#sakura-petals':bg,'#sakura-passage':passage,'#sakura-tools':tools,'#sakura-effects-toggle':toggle,'#sakura-gust':gust,'.hero-wrap, .page-hero, .post-header, .blog-head, .projects-hero':hero,'.article-main':article};
 const listen=(name,fn)=>events.set(name,[...(events.get(name)||[]),fn]);
 const document={documentElement:root,hidden:false,querySelector:s=>nodes[s]||null,createElement:canvas,addEventListener:listen};
 const fire=(name,detail)=>{for(const fn of events.get(name)||[])fn({detail});};
 const window={addEventListener:listen,dispatchEvent:e=>fire(e.type,e.detail)};
 const local=new Map([['sakura-effects',paused?'off':'on']]);
 const exported={};const context={exports:exported,document,window,location:{origin:'https://example.com',pathname,search:''},URL,Date,
  innerWidth:width,innerHeight:height,devicePixelRatio:1,scrollY:0,navigator:{connection:{saveData}},
  matchMedia:q=>q.includes('reduced')?motion:{matches:width<768,addEventListener(){}},
  performance:{now:()=>time},requestAnimationFrame:fn=>{frames.set(++id,fn);return id;},cancelAnimationFrame:key=>frames.delete(key),
  localStorage:{getItem:k=>local.get(k),setItem:(k,v)=>local.set(k,v)},sessionStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
  CustomEvent:class{constructor(type,{detail}){this.type=type;this.detail=detail;}},MutationObserver:class{observe(){}disconnect(){}},ResizeObserver:class{observe(){}disconnect(){}},
 };
 runInNewContext(source,context);exported.initSakura();
 function advance(ms){for(let end=time+ms;time<end;){time+=1000/60;const work=[...frames.values()];frames.clear();for(const fn of work)fn(time);}}
 return{bg,passage,tools,toggle,gust,root,frames,storage,document,motion,fire,advance};
}
test('release is separate from ambient and falls with gravity in a finite interval',()=>{
 const f=fixture();f.advance(500);assert.equal(f.passage.hidden,true);
 f.fire('sakura-departure');f.advance(100);const early=f.passage.ctx.items.map(p=>({...p}));assert.equal(early.length,12);
 f.advance(300);const middle=f.passage.ctx.items.map(p=>({...p}));
 assert.ok(middle.every((p,i)=>p.y>early[i].y+10),'Every released petal falls, not a horizontal sweep');
 assert.ok(middle.every(p=>p.size>=32&&p.size<=54),'Large recognizable petals');
 f.advance(300);const later=f.passage.ctx.items;
 assert.ok(later.every((p,i)=>p.y-middle[i].y>middle[i].y-early[i].y),'Gravity accelerates the fall');
 f.advance(700);assert.equal(f.passage.hidden,true);assert.equal(f.passage.ctx.items.length,0);
});
test('reading keeps ambient stopped while a requested short passage still completes',()=>{
 const f=fixture({reading:true});assert.equal(f.bg.hidden,true);assert.equal(f.tools.hidden,true);assert.equal(f.frames.size,0);
 f.fire('sakura-departure');f.advance(350);assert.equal(f.passage.hidden,false);assert.equal(f.passage.ctx.items.length,12);assert.equal(f.bg.ctx.items.length,0);
 f.advance(1100);assert.equal(f.passage.hidden,true);assert.equal(f.frames.size,0);
});
test('pause, system reduced motion and coastal theme do not start a passage',()=>{
 for(const options of [{paused:true},{reduced:true},{theme:'poetize'}]){const f=fixture(options);f.fire('sakura-departure');f.advance(500);assert.equal(f.passage.hidden,true);assert.equal(f.passage.ctx.items.length,0);}
});
test('Escape cancellation and live pause clear the release canvas',()=>{
 for(const cancel of [f=>f.fire('sakura-cancel'),f=>f.toggle.events.click(),f=>{f.motion.matches=true;f.motion.change();}]){const f=fixture();f.fire('sakura-departure');f.advance(200);cancel(f);assert.equal(f.passage.hidden,true);assert.equal(f.passage.ctx.items.length,0);}
});
test('rapid changed destinations reuse the same release rather than emitting more',()=>{
 const f=fixture();f.fire('sakura-departure');f.advance(180);const first=f.passage.ctx.items;
 for(let i=0;i<20;i++)f.fire('sakura-departure');f.advance(60);const next=f.passage.ctx.items;
 assert.equal(next.length,12);assert.ok(next.every((p,i)=>p.size===first[i].size&&p.y>=first[i].y));
});
test('native document handoff continues the exact release positions and consumes its snapshot',()=>{
 const storage=new Map(),old=fixture({storage});old.fire('sakura-departure');old.advance(320);old.fire('sakura-handoff','https://example.com/blog');
 const snapshot=JSON.parse(storage.get('sakura-scene-v3'));assert.equal(snapshot.releases.length,12);assert.ok(snapshot.passageAge>.2);
 old.fire('pagehide');assert.equal(old.passage.hidden,true);
 const next=fixture({storage,pathname:'/blog'});assert.equal(next.passage.hidden,false);next.advance(60);
 assert.equal(next.passage.ctx.items.length,12);assert.equal(storage.size,0);
 assert.ok(next.passage.ctx.items.every((p,i)=>p.size===snapshot.releases[i].size));
 next.advance(1200);assert.equal(next.passage.hidden,true);
});
test('mobile and data saver use smaller finite release pools',()=>{
 for(const [options,count]of [[{width:390,height:844},7],[{saveData:true},5]]){const f=fixture(options);f.fire('sakura-departure');f.advance(200);assert.equal(f.passage.ctx.items.length,count);}
});

test('slow document loads save the latest release rather than rewinding to the click',()=>{
 const storage=new Map(),old=fixture({storage});old.fire('sakura-departure');old.advance(320);old.fire('sakura-handoff','https://example.com/blog');
 old.advance(500);const visible=old.passage.ctx.items.map(p=>({...p}));old.fire('pagehide');
 assert.ok(JSON.parse(storage.get('sakura-scene-v3')).passageAge>.7);
 const next=fixture({storage,pathname:'/blog'});next.advance(50);assert.ok(next.passage.ctx.items.every((p,i)=>p.y>=visible[i].y));
});
