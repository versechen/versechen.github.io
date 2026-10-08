import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {test} from 'node:test';
import ts from 'typescript';
const source=ts.transpile(readFileSync(new URL('../src/lib/coastal-tide.ts',import.meta.url),'utf8'),{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS});
const lib=(()=>{const exports={};runInNewContext(source,{exports,Math,URL});return exports;})();
const KEY=lib.TIDE_KEY;

function fixture({path='/',width=1440,height=900,dark=false,record,active=true}={}){
 let time=0,id=0;const frames=new Map(),events=new Map(),storage=new Map(),fills=[];
 if(record)storage.set(KEY,typeof record==='string'?record:JSON.stringify(record));
 const state={active};
 let shape=null;const track=(x,y)=>{shape.minX=Math.min(shape.minX,x);shape.maxX=Math.max(shape.maxX,x);shape.minY=Math.min(shape.minY,y);shape.maxY=Math.max(shape.maxY,y);};
 const ctx={fillStyle:'',strokeStyle:'',lineWidth:1,clears:0,setTransform(){},clearRect(){this.clears++;fills.length=0;},
  beginPath(){shape={minX:Infinity,maxX:-Infinity,minY:Infinity,maxY:-Infinity};},moveTo:(x,y)=>track(x,y),lineTo:(x,y)=>track(x,y),closePath(){},
  arc(){shape.arc=true;},stroke(){},fill(){if(!shape.arc)fills.push({...shape,style:this.fillStyle});},
  createLinearGradient:()=>({stops:[],addColorStop(at,color){this.stops.push([at,color]);}})};
 const canvas={hidden:true,width:0,height:0,dataset:{},getContext:()=>ctx};
 const root={dataset:{coastalArrival:'rise'},classList:{contains:k=>k==='dark'&&dark},style:{props:{'--coastal-tide':'.6'},removeProperty(k){delete this.props[k];}}};
 const nav=['/','/blog','/reading','/about'].map(href=>({href:`https://example.com${href}`}));
 const env={exports:{},Math,URL,Date,innerWidth:width,innerHeight:height,devicePixelRatio:2,
  location:{href:`https://example.com${path}`,pathname:path},
  document:{documentElement:root,querySelectorAll:s=>s==='.nav-link[href]'?nav:[]},
  sessionStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
  performance:{now:()=>time},requestAnimationFrame:fn=>{frames.set(++id,fn);return id;},cancelAnimationFrame:k=>frames.delete(k),
  addEventListener:(name,fn)=>events.set(name,[...(events.get(name)||[]),fn])};
 env.window=env;
 runInNewContext(source,env);
 const tide=env.exports.initCoastalTide(canvas,{active:()=>state.active});
 const fire=(name,detail)=>{const event={type:name,detail,persisted:detail?.persisted};for(const fn of events.get(name)||[])fn(event);return event;};
 const advance=(ms,step=1000/60)=>{for(const end=time+ms;time<end-1e-9;){time+=step;const work=[...frames.values()];frames.clear();for(const fn of work)fn(time);}};
 const start=href=>fire('coastal-navigation-start',{href:`https://example.com${href}`,accepted:false}).detail.accepted;
 const saved=()=>storage.has(KEY)?JSON.parse(storage.get(KEY)):null;
 return{tide,canvas,root,storage,state,document:env.document,frames,fills,fire,advance,start,saved,width,height,body:()=>fills[0]};
}

test('section changes sweep in navigation order and articles raise the tide',()=>{
 assert.equal(lib.tideKind('/blog/hello-world'),'rise');assert.equal(lib.tideKind('/blog/hello-world/'),'rise');
 for(const path of['/blog','/blog/series/notes','/reading','/'])assert.equal(lib.tideKind(path),'sweep',path);
 assert.equal(lib.sweepDirection(0,2,false),1);assert.equal(lib.sweepDirection(3,1,false),-1);
 assert.equal(lib.sweepDirection(1,1,true),-1,'Article back to its list');
 assert.equal(lib.sweepDirection(-1,2,false,()=>.2),-1);assert.equal(lib.sweepDirection(-1,2,false,()=>.8),1);
});
test('the old page reaches mid-screen by the hold deadline and waits there for a slow response',()=>{
 for(const kind of['sweep','rise']){
  const hold=lib.HOLD_FRONT[kind];
  assert.equal(lib.departFront(kind,0),lib.START_FRONT[kind]);
  assert.ok(Math.abs(lib.departFront(kind,lib.DEPART_SECONDS)-hold)<1e-9);
  let previous=-Infinity;for(let t=0;t<=6;t+=.05){const f=lib.departFront(kind,t);assert.ok(f>=previous-1e-12&&f<=hold+.06,kind);previous=f;}
  assert.ok(lib.departFront(kind,.2,.3)>.3,'A reused wave keeps advancing from where it is');
 }
});
test('the new page continues from the saved front and lets every bit of water out',()=>{
 const sweep=t=>lib.arriveFront('sweep',.55,t);
 assert.ok(Math.abs(sweep(0)-.55)<1e-9);assert.ok(sweep(lib.ARRIVE_SECONDS.sweep)>=1+lib.SWEEP_TAIL,'The translucent tail leaves the far edge');
 for(let t=0,p=-Infinity;t<=lib.ARRIVE_SECONDS.sweep;t+=.02){assert.ok(sweep(t)>=p);p=sweep(t);}
 const rise=t=>lib.arriveFront('rise',.62,t);
 assert.ok(Math.abs(rise(0)-.62)<1e-9);assert.ok(rise(.2)>.62,'One more swell before draining');
 assert.ok(rise(lib.ARRIVE_SECONDS.rise)<0,'The water line ends below the bottom edge');
 for(const kind of['sweep','rise'])assert.ok(Math.abs(lib.retreatFront(kind,.5,lib.RETREAT_SECONDS)-lib.START_FRONT[kind])<1e-9);
});
test('saved tides are only continued on the intended page, shortly after leaving',()=>{
 const now=Date.now(),ok={target:'https://example.com/blog?visual-theme=poetize',at:now-400,kind:'sweep',dir:-1,seed:.3,front:.55,clock:.6,episode:'abc'};
 const scene=lib.parseTideScene(JSON.stringify(ok),'https://example.com/blog/',now);
 assert.equal(scene.kind,'sweep');assert.equal(scene.dir,-1);assert.ok(Math.abs(scene.clock-.6)<1e-9);assert.ok(Math.abs(scene.gap-.4)<1e-9);
 for(const bad of[{target:'https://example.com/reading'},{target:'https://elsewhere.test/blog'},{target:'https://example.com/blog?page=2'},{at:now-11000},{at:now+2000},{kind:'flood'},{dir:0},{seed:1},{front:3},{front:'x'},{clock:-1},{episode:7}])
  assert.equal(lib.parseTideScene(JSON.stringify({...ok,...bad}),'https://example.com/blog',now),null,JSON.stringify(bad));
 for(const raw of[null,'','{',`"${'x'.repeat(2100)}"`])assert.equal(lib.parseTideScene(raw,'https://example.com/blog',now),null);
});
test('a section link floods the old page from the side it is heading toward, then hands the scene over',()=>{
 const f=fixture({path:'/'});
 assert.equal(f.root.dataset.coastalReady,'true');assert.equal(f.root.dataset.coastalArrival,undefined,'No record, no painted water line');
 assert.equal(f.start('/reading'),true);
 assert.equal(f.canvas.hidden,false);assert.equal(f.canvas.dataset.tide,'sweep');assert.equal(f.canvas.dataset.tideFrom,'left');
 f.advance(340);f.fire('coastal-navigation-handoff','https://example.com/reading');
 const record=f.saved();assert.equal(record.kind,'sweep');assert.equal(record.dir,1);assert.ok(record.front>.5&&record.front<.6);
 assert.ok(f.body().maxX>f.width*.5&&f.body().maxX<f.width*.72,'The crest is about mid-screen');
 assert.ok(f.body().minX<0,'The translucent body trails from the entry edge');
 f.advance(3000);assert.ok(f.body().maxX<f.width*.8,'A slow response keeps the wave waiting, not finishing');
 f.fire('pagehide');assert.equal(f.frames.size,0);assert.ok(f.saved().front>record.front,'pagehide saves the last live front');
 const back=fixture({path:'/about'});back.start('/blog');assert.equal(back.canvas.dataset.tideFrom,'right');
});
test('opening an article raises the tide from the bottom',()=>{
 const f=fixture({path:'/blog'});f.start('/blog/hello-world');f.advance(340);
 assert.equal(f.canvas.dataset.tide,'rise');assert.equal(f.saved().kind,'rise');
 const water=f.body();assert.ok(water.maxY>=f.height,'Filled to the bottom edge');
 assert.ok(water.minY>f.height*.3&&water.minY<f.height*.5,'Water line around 60% of the viewport');
});
test('the arriving page drains the same tide, removes the painted water line, then rests',()=>{
 const f=fixture({path:'/blog/hello-world',record:{target:'https://example.com/blog/hello-world',at:Date.now()-300,kind:'rise',dir:1,seed:.42,front:.62,clock:.5,episode:'e'}});
 assert.equal(f.storage.has(KEY),false,'The record is consumed once');assert.equal(f.canvas.hidden,false);assert.equal(f.canvas.dataset.tideSource,'continued');
 assert.equal(f.root.dataset.coastalArrival,undefined,'First frame is painted synchronously');
 f.advance(17);assert.equal(f.root.dataset.coastalArrival,undefined);assert.equal(f.root.style.props['--coastal-tide'],undefined);
 const first=f.body().minY;assert.ok(Math.abs(first-f.height*.38)<40,'Starts at the saved water line');
 f.advance(lib.ARRIVE_SECONDS.rise*1000+50);
 assert.equal(f.canvas.hidden,true);assert.equal(f.frames.size,0,'No idle animation loop');assert.equal(f.canvas.dataset.tidePhase,'idle');
});
test('Escape or a cancelled hold drains the water back the way it came',()=>{
 const f=fixture({path:'/'});f.start('/blog');f.advance(200);const at=f.body().maxX;
 f.fire('coastal-navigation-cancel');assert.equal(f.storage.has(KEY),false);assert.equal(f.canvas.dataset.tidePhase,'retreat');
 f.advance(150);assert.ok(f.body().maxX<at);f.advance(lib.RETREAT_SECONDS*1000);assert.equal(f.canvas.hidden,true);assert.equal(f.frames.size,0);
 const late=fixture({path:'/'});late.start('/blog');late.advance(340);late.fire('coastal-navigation-handoff','https://example.com/blog');
 late.fire('coastal-navigation-abandon','https://example.com/other');assert.equal(late.canvas.dataset.tidePhase,'depart','Only the pending target is abandoned');
 late.fire('coastal-navigation-abandon','https://example.com/blog');assert.equal(late.canvas.dataset.tidePhase,'retreat');assert.equal(late.storage.has(KEY),false);
});
test('paused motion, reduced motion or hidden pages never start or continue a tide',()=>{
 const off=fixture({active:false});assert.equal(off.start('/blog'),false);assert.equal(off.canvas.hidden,true);
 const record={target:'https://example.com/blog',at:Date.now(),kind:'sweep',dir:1,seed:.1,front:.5,clock:0,episode:''};
 const skipped=fixture({path:'/blog',record,active:false});assert.equal(skipped.canvas.hidden,true);assert.equal(skipped.root.dataset.coastalArrival,undefined);
 const f=fixture({path:'/blog',record});f.advance(100);f.state.active=false;f.tide.setActive(false);
 assert.equal(f.canvas.hidden,true);assert.equal(f.frames.size,0);
 const g=fixture({path:'/'});g.start('/blog');g.advance(100);g.state.active=false;g.advance(20);assert.equal(g.canvas.hidden,true);
});
test('history restore shows the old page dry instead of a frozen flood',()=>{
 const f=fixture({path:'/'});f.start('/blog');f.advance(340);f.fire('pagehide');assert.equal(f.canvas.hidden,false);
 f.fire('pageshow',{persisted:true});assert.equal(f.canvas.hidden,true);assert.equal(f.storage.has(KEY),false);assert.equal(f.canvas.dataset.tidePhase,'idle');
 assert.equal(f.start('/reading'),true,'A new choice after restore floods again');
});
test('storage failure falls back to native navigation without a stranded wave',()=>{
 const f=fixture({path:'/'});f.storage.set=()=>{throw new Error('quota');};
 assert.equal(f.start('/blog'),false);assert.equal(f.canvas.hidden,true);assert.equal(f.frames.size,0);
});
test('dark pages use a deeper night sea',()=>{
 const light=fixture({path:'/'}),dark=fixture({path:'/',dark:true});
 for(const f of[light,dark]){f.start('/blog');f.advance(200);}
 assert.notEqual(light.body().style.stops[0][1],dark.body().style.stops[0][1]);
 assert.match(dark.body().style.stops[0][1],/^rgba\(80, 162, 192,/);
});

test('a delayed first animation callback cannot skip the arriving wave',()=>{
 const f=fixture({path:'/blog',record:{target:'https://example.com/blog',at:Date.now(),kind:'sweep',dir:1,seed:.2,front:.55,clock:.6,episode:'late'}});
 assert.ok(f.body(),'The arriving water is painted before requesting another frame');
 const first=f.body().maxX;f.advance(3000,3000);
 assert.equal(f.canvas.hidden,false);assert.ok(Math.abs(f.body().maxX-first)<20);
 f.advance(lib.ARRIVE_SECONDS.sweep*1000+100);assert.equal(f.canvas.hidden,true);
});
test('hide pauses the wave and preserves the final handoff through pagehide',()=>{
 const f=fixture();f.start('/blog');f.advance(350);f.fire('coastal-navigation-handoff','https://example.com/blog');
 const before=f.body().maxX;
 f.document.hidden=true;f.tide.setActive(false);f.advance(3000);
 assert.equal(f.frames.size,0);assert.equal(f.canvas.hidden,false);assert.equal(f.body().maxX,before);
 f.fire('pagehide');f.state.active=false;f.tide.setActive(false);
 assert.ok(f.saved().front>.5);assert.equal(f.canvas.hidden,false);
 const g=fixture({path:'/blog',record:f.saved()});g.advance(300);
 g.document.hidden=true;g.tide.setActive(false);g.advance(4000);
 g.document.hidden=false;g.tide.setActive(true);g.advance(100);
 assert.equal(g.canvas.hidden,false);
 g.advance(lib.ARRIVE_SECONDS.sweep*1000);assert.equal(g.canvas.hidden,true);
});
test('the new page first frame exactly matches the saved geometry and colours',()=>{
 for(const path of ['/reading','/blog/hello-world']) {
  const old=fixture();old.start(path);old.advance(700);old.fire('pagehide');
  const record=old.saved();record.at=Date.now()-1400;
  const next=fixture({path,record});
  assert.equal(JSON.stringify(next.body()),JSON.stringify(old.body()),'Network time must not jump the wave phase');
 }
});
