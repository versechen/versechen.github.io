import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {test} from 'node:test';
import ts from 'typescript';
const source=ts.transpile(readFileSync(new URL('../src/lib/sakura-effects.ts',import.meta.url),'utf8'),{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS});
function fixture({width=1174,height=753,reading=false,reduced=false,paused=false,theme,saveData=false,heroHeight=height,storage=new Map(),storageBlocked=false,href='https://example.com/',wall={now:0},nav=['/','/blog','/reading','/projects','/life','/about'],header=0}={}){
 let time=0,id=0,seed=12345;const frames=new Map(),events=new Map(),signals=[];
 function element(){return {hidden:true,disabled:false,title:'',dataset:{},attrs:{},events:{},setAttribute(k,v){this.attrs[k]=v;},addEventListener(k,f){this.events[k]=f;}};}
 function canvas(){const c=element();let x=0,y=0,angle=0;const ctx={items:[],globalAlpha:1,clearRect(){this.items=[];},setTransform(){},save(){},restore(){},translate(a,b){x=a;y=b;},rotate(value){angle=value;},scale(){},drawImage(_,a,b,size){this.items.push({x,y,size,alpha:this.globalAlpha,angle});},createLinearGradient(){return{addColorStop(){}};},beginPath(){},moveTo(){},bezierCurveTo(){},lineTo(){},fill(){},stroke(){},quadraticCurveTo(){},rect(){},clip(){}};c.getContext=()=>ctx;c.ctx=ctx;return c;}
 const field=canvas(),tools=element(),toggle=element(),gust=element();
 const root={dataset:{visualTheme:theme},classList:{contains:()=>false}};
 const hero={getBoundingClientRect:()=>({bottom:heroHeight})};
 const article=reading?{getBoundingClientRect:()=>({top:280,bottom:4000,left:220,right:width-90})}:null;
 const motion={matches:reduced,addEventListener(_,fn){this.change=fn;}};
 const nodes={'#sakura-petals':field,'#sakura-tools':tools,'#sakura-effects-toggle':toggle,'#sakura-gust':gust,'.hero-wrap, .page-hero, .post-header, .blog-head, .projects-hero':hero,'.article-main':article,'#site-header':header?{getBoundingClientRect:()=>({bottom:header})}:null};
 const listen=(name,fn)=>events.set(name,[...(events.get(name)||[]),fn]);
 const navLinks=nav.map(path=>({href:new URL(path,href).href}));
 const document={documentElement:root,hidden:false,querySelector:s=>nodes[s]||null,querySelectorAll:s=>s==='.nav-link[href]'?navLinks:[],createElement:canvas,addEventListener:listen};
 const fire=(name,event={})=>{for(const fn of events.get(name)||[])fn(event);};
 const window={addEventListener:listen,dispatchEvent:e=>{signals.push(e.type);fire(e.type,e);}};
 const local=new Map([['sakura-effects',paused?'off':'on']]);
 const seededMath=Object.create(Math);seededMath.random=()=>((seed=Math.imul(seed,1664525)+1013904223)>>>0)/2**32;
 const exported={};
 const environment={exports:exported,document,window,URL,location:{href,...Object.fromEntries(['origin','pathname','search','hash'].map(k=>[k,new URL(href)[k]]))},Date:{now:()=>wall.now},sessionStorage:{getItem(k){if(storageBlocked)throw Error('blocked');return storage.get(k);},setItem(k,v){if(storageBlocked)throw Error('blocked');storage.set(k,v);},removeItem(k){if(storageBlocked)throw Error('blocked');storage.delete(k);}},Math:seededMath,innerWidth:width,innerHeight:height,devicePixelRatio:1,scrollY:0,navigator:{connection:{saveData}},matchMedia:q=>q.includes('reduced')?motion:{matches:width<768,addEventListener(){}},performance:{now:()=>time},requestAnimationFrame:fn=>{frames.set(++id,fn);return id;},cancelAnimationFrame:key=>frames.delete(key),localStorage:{getItem:k=>local.get(k),setItem:(k,v)=>local.set(k,v)},Event:class{constructor(type){this.type=type;}},CustomEvent:class{constructor(type,{detail}){this.type=type;this.detail=detail;}},MutationObserver:class{observe(){}disconnect(){}},ResizeObserver:class{observe(){}disconnect(){}}};
 runInNewContext(source,environment);exported.initSakura();
 function advance(ms,interval=1000/60){for(let end=time+ms;time<end;){time+=interval;wall.now+=interval;const work=[...frames.values()];frames.clear();for(const fn of work)fn(time);}}
 return{field,tools,toggle,gust,root,frames,document,motion,fire,advance,signals,storage,wall,resize(w,h){width=w;height=h;environment.innerWidth=w;environment.innerHeight=h;fire('resize');}};
}
const extra=f=>+f.field.dataset.sakuraBurstCount;
const pool=f=>+f.field.dataset.sakuraBurstPool;
const mean=a=>a.reduce((s,v)=>s+v,0)/a.length;
const temporary=f=>f.field.ctx.items.slice(+f.field.dataset.sakuraBaseCount);
const spread=items=>Math.max(...items.map(p=>p.x))-Math.min(...items.map(p=>p.x));
test('one field goes from settled baseline to a visible increment, fades and returns to baseline',()=>{
 const f=fixture();f.advance(5000);assert.equal(f.field.dataset.sakuraBasePool,'14');assert.equal(extra(f),0);
 f.fire('pageshow',{persisted:true});f.advance(800);
 assert.ok(pool(f)>=22&&pool(f)<=28);assert.equal(extra(f),pool(f));assert.equal(f.field.dataset.sakuraBurstState,'wind');
 const peak=temporary(f).map(p=>p.alpha);
 assert.ok(f.field.ctx.items.every(p=>p.size<=18));
 f.advance(1900);assert.equal(f.field.dataset.sakuraBurstState,'fading');assert.ok(extra(f)>0);
 const fading=temporary(f).map(p=>p.alpha);
 assert.ok(mean(fading)<mean(peak)*.7,'Temporary petals visibly lose opacity before removal');
 f.advance(2000);assert.equal(extra(f),0);assert.equal(f.field.dataset.sakuraBurstState,'idle');assert.equal(f.field.dataset.sakuraBasePool,'14');
 assert.ok(f.signals.includes('sakura-arrival-end'));
});
test('the increment appears in stages, never as an instantaneous dense sheet',()=>{
 const f=fixture();f.advance(100);const early=extra(f);f.advance(600);assert.ok(early<extra(f));assert.ok(extra(f)<=28);
});
test('a section gust strips clusters off the upwind side, then scatters them across the page',()=>{
 const f=fixture(),width=1174;
 const fromWind=items=>items.map(p=>({...p,x:f.field.dataset.sakuraWindFrom==='left'?p.x:width-p.x}));
 assert.equal(f.field.dataset.sakuraStyle,'gust');
 f.advance(160);const leaving=fromWind(temporary(f));
 assert.ok(leaving.length>=3&&leaving.length<pool(f),'Clusters break away one after another');
 assert.ok(leaving.every(p=>p.x<width*.4),'Every released petal starts from the canopy side');
 f.advance(1240);const scattered=fromWind(temporary(f));
 assert.equal(scattered.length,pool(f));
 assert.ok(mean(scattered.map(p=>p.x))>mean(leaving.map(p=>p.x))+width*.25,'The gust carries the petals across the page');
 assert.ok(spread(scattered)>width*.35&&spread(scattered)>spread(leaving)*1.8,'Uneven gust speeds pull the clusters apart');
});
const begin=(f,href='https://example.com/blog')=>{const detail={href,accepted:false};f.fire('sakura-navigation-start',{detail});return detail;};
test('switching sections blows along the navigation order: rightward from the left, back from the right',()=>{
 for(const [href,target,from]of[['https://example.com/','https://example.com/reading','left'],['https://example.com/reading/','https://example.com/blog','right'],['https://example.com/about/','https://example.com/','right']]){
  const f=fixture({href});f.advance(5000);begin(f,target);
  assert.equal(f.field.dataset.sakuraStyle,'gust');assert.equal(f.field.dataset.sakuraWindFrom,from,`${href} -> ${target}`);
  f.advance(300);const xs=temporary(f).map(p=>p.x);assert.ok(xs.length>0);
  assert.ok(from==='left'?xs.every(x=>x<1174*.45):xs.every(x=>x>1174*.55),'Petals leave from the upwind edge');
  assert.ok(from==='left'?+f.field.dataset.sakuraWindShift>0:+f.field.dataset.sakuraWindShift<0,'The existing field leans with the same wind');
 }
});
test('entering an article lets a soft shower fall through the first screen instead of sweeping across',()=>{
 const f=fixture({href:'https://example.com/blog/'});f.advance(5000);begin(f,'https://example.com/blog/a-quiet-post');
 assert.equal(f.field.dataset.sakuraStyle,'fall');
 f.advance(340);const holding=temporary(f);
 assert.ok(pool(f)>=24&&pool(f)<=28);
 assert.ok(holding.length>=pool(f)*.3,'Part of the shower is visible while the old page still holds');
 assert.ok(spread(holding)>1174*.5,'Petals fall across the width, not from one edge');
 assert.ok(holding.every(p=>p.y<753*.45),'The shower starts near the top');
 f.advance(1000);const early=temporary(f);
 f.advance(1400);const later=temporary(f);
 assert.ok(mean(later.map(p=>p.y))>mean(early.map(p=>p.y))+753*.15,'Petals clearly fall down the page');
 assert.ok(Math.abs(+f.field.dataset.sakuraWindShift)<9,'No strong sweeping gust');
 f.advance(4000);assert.equal(extra(f),0);assert.equal(f.field.dataset.sakuraBurstState,'idle');
});
test('both styles begin below the fixed site header, so the old page shows them during its short hold',()=>{
 for(const [options,target]of[[{},'https://example.com/reading'],[{},'https://example.com/blog/a-quiet-post'],[{width:390,height:844,heroHeight:190},'https://example.com/reading'],[{width:390,height:844,heroHeight:190},'https://example.com/blog/a-quiet-post']]){
  const f=fixture({...options,header:64,href:'https://example.com/blog/'});f.advance(5000);begin(f,target);f.advance(340);
  const below=temporary(f).filter(p=>p.y>64+4);
  assert.ok(below.length>=pool(f)*.3,`${f.field.dataset.sakuraStyle} ${options.width||1174}px: ${below.length}/${pool(f)} below the header`);
 }
});
test('a falling shower survives the page handoff with its faster fall speed',()=>{
 const storage=new Map(),wall={now:0};
 const old=fixture({href:'https://example.com/blog/',storage,wall});old.advance(5000);
 const detail=begin(old,'https://example.com/blog/a-quiet-post');assert.equal(detail.accepted,true);
 old.advance(340);old.fire('pagehide');wall.now+=200;
 const next=fixture({href:'https://example.com/blog/a-quiet-post',storage,wall});
 assert.equal(next.field.dataset.sakuraSceneSource,'continued');assert.equal(next.field.dataset.sakuraStyle,'fall');
});
test('on small screens both styles start inside the short page heading where petals are drawn',()=>{
 for(const target of ['https://example.com/reading','https://example.com/blog/a-quiet-post']){
  const f=fixture({width:390,height:844,heroHeight:190,href:'https://example.com/blog/'});f.advance(5000);begin(f,target);
  let peak=0;for(let t=0;t<2400;t+=100){f.advance(100);peak=Math.max(peak,extra(f));}
  assert.ok(peak>=pool(f)*.6,`${f.field.dataset.sakuraStyle}: ${peak}/${pool(f)} visible`);
  assert.ok(f.field.ctx.items.every(p=>p.y<190+18));
 }
});
test('every episode is shaped differently',()=>{
 const f=fixture(),shapes=[];
 for(let i=0;i<4;i++){f.advance(5000);f.fire('pageshow',{persisted:true});f.advance(400);shapes.push(temporary(f).slice(0,6).map(p=>Math.round(p.x)+','+Math.round(p.y)).join(' ')+'|'+pool(f));}
 assert.equal(new Set(shapes).size,4);
});
test('repeated lifecycle arrivals replace the bounded temporary pool rather than accumulating',()=>{
 const f=fixture();for(let i=0;i<15;i++){f.fire('pageshow',{persisted:true});f.advance(40);}f.advance(800);assert.ok(pool(f)<=28);assert.equal(extra(f),pool(f));assert.equal(f.field.dataset.sakuraBasePool,'14');
 const before=f.field.ctx.items;f.advance(16);assert.ok(f.field.ctx.items.length<=42);assert.ok(before.length<=42);
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
 for(const [options,base,[low,high]]of [[{width:390,height:844},6,[9,12]],[{saveData:true},4,[5,6]]]){
  const f=fixture(options);f.advance(800);assert.equal(f.field.dataset.sakuraBasePool,String(base));
  assert.ok(pool(f)>=low&&pool(f)<=high);assert.equal(extra(f),pool(f));f.advance(4500);assert.equal(extra(f),0);
 }
});

test('temporary petals stay visible past a short page heading and then fade by lifetime',()=>{
 const f=fixture({heroHeight:230});f.advance(800);assert.equal(extra(f),pool(f));
 f.advance(1900);assert.ok(extra(f)>0);f.advance(2200);assert.equal(extra(f),0);
});

test('temporary lifetime follows elapsed time on slow frames instead of outliving cleanup',()=>{
 const f=fixture();f.advance(800);assert.equal(extra(f),pool(f));f.advance(4000,120);
 assert.equal(extra(f),0);assert.equal(f.field.dataset.sakuraBurstState,'idle');
});

test('an active burst respects the smaller pool after resizing across the mobile breakpoint',()=>{
 const f=fixture({width:800});f.advance(800);assert.equal(extra(f),pool(f));
 f.resize(767,753);f.advance(80);assert.equal(f.field.dataset.sakuraBasePool,'6');assert.ok(extra(f)<=12);
 f.advance(4500);assert.equal(extra(f),0);
});

const transferKey='sakura-navigation-scene-v1';
test('click creates visible petals in the OLD scene, and NEW document consumes the same positions/ages',()=>{
 const storage=new Map(),wall={now:0},old=fixture({storage,wall});old.advance(5000);assert.equal(extra(old),0);
 assert.equal(begin(old).accepted,true);old.advance(340);assert.ok(extra(old)>0);assert.equal(old.field.dataset.sakuraSceneSource,'departure');
 const positions=old.field.ctx.items.map(p=>({x:p.x,y:p.y,size:p.size}));
 old.fire('sakura-navigation-handoff',{detail:'https://example.com/blog'});old.fire('pagehide');
 const saved=JSON.parse(storage.get(transferKey));assert.ok(saved.releaseAge>.25);
 const next=fixture({storage,wall,href:'https://example.com/blog/'});
 assert.equal(next.field.dataset.sakuraSceneSource,'continued');assert.equal(next.root.dataset.sakuraContinuing,'true');assert.equal(next.field.dataset.sakuraEpisode,saved.episode);
 assert.ok(+next.field.dataset.sakuraReleaseAge>=saved.releaseAge-.001);
 assert.deepEqual(next.field.ctx.items.map(p=>({x:p.x,y:p.y,size:p.size})),positions);
 assert.equal(storage.size,0);next.advance(4500);assert.equal(extra(next),0);
});
test('slow native loading captures the final OLD frame and accounts for the unobserved gap',()=>{
 const storage=new Map(),wall={now:0},old=fixture({storage,wall});old.advance(5000);begin(old);old.advance(340);old.fire('sakura-navigation-handoff',{detail:'https://example.com/blog'});
 old.advance(1500);old.fire('pagehide');const saved=JSON.parse(storage.get(transferKey));assert.ok(saved.releaseAge>1.7);
 wall.now+=120;const next=fixture({storage,wall,href:'https://example.com/blog/'});assert.equal(next.field.dataset.sakuraEpisode,saved.episode);
 assert.ok(+next.field.dataset.sakuraReleaseAge>=saved.releaseAge+.119);assert.equal(next.field.dataset.sakuraBurstState,'fading');
 next.advance(3000);assert.equal(extra(next),0);
});
test('an episode finished while loading does not restart on the destination',()=>{
 const storage=new Map(),wall={now:0},old=fixture({storage,wall});old.advance(5000);begin(old);old.advance(5000);old.fire('pagehide');
 const next=fixture({storage,wall,href:'https://example.com/blog/'});assert.equal(next.field.dataset.sakuraSceneSource,'continued');assert.equal(extra(next),0);
 next.advance(800);assert.equal(extra(next),0);
});
test('visibility-before-pagehide retains the last non-cleared snapshot',()=>{
 const storage=new Map(),wall={now:0},old=fixture({storage,wall});old.advance(5000);begin(old);old.advance(400);old.document.hidden=true;old.fire('visibilitychange');old.fire('pagehide');
 assert.ok(JSON.parse(storage.get(transferKey)).temporary.length>0);
 const next=fixture({storage,wall,href:'https://example.com/blog/'});assert.equal(next.field.dataset.sakuraSceneSource,'continued');assert.ok(extra(next)>0);
});
test('retargeting preserves the episode while cancellation removes its handoff',()=>{
 const f=fixture();f.advance(5000);begin(f);f.advance(150);const id=f.field.dataset.sakuraEpisode;
 begin(f,'https://example.com/reading');f.advance(100);assert.equal(f.field.dataset.sakuraEpisode,id);assert.equal(JSON.parse(f.storage.get(transferKey)).target,'https://example.com/reading');
 f.fire('sakura-navigation-cancel');assert.equal(extra(f),0);assert.equal(f.storage.size,0);f.fire('pagehide');assert.equal(f.storage.size,0);
});
test('blocked storage declines handoff; stale/wrong/invalid snapshots cannot restore a scene',()=>{
 const f=fixture({storageBlocked:true});f.advance(5000);assert.equal(begin(f).accepted,false);
 const storage=new Map(),wall={now:0},old=fixture({storage,wall});old.advance(5000);begin(old);old.advance(340);old.fire('pagehide');const valid=JSON.parse(storage.get(transferKey));
 for(const patch of [s=>s.target='https://elsewhere.test/blog',s=>s.target='https://example.com/reading',s=>s.at-=11000,s=>s.temporary[0].age=-999,s=>s.temporary[0].sprite=99]){
  const saved=structuredClone(valid);patch(saved);const one=new Map([[transferKey,JSON.stringify(saved)]]);const next=fixture({storage:one,wall,href:'https://example.com/blog/'});
  assert.notEqual(next.field.dataset.sakuraSceneSource,'continued');assert.equal(one.size,0);
 }
});

test('hide then re-show updates the eventual snapshot instead of replaying the hidden burst',()=>{
 const storage=new Map(),wall={now:0},old=fixture({storage,wall});old.advance(5000);begin(old);old.advance(400);
 old.document.hidden=true;old.fire('visibilitychange');old.advance(300);old.document.hidden=false;old.fire('visibilitychange');old.advance(200);old.fire('pagehide');
 assert.equal(JSON.parse(storage.get(transferKey)).temporary.length,0);
});

test('the existing field deflects together before departure, then settles without stronger speed or density',()=>{
 const calm=fixture(),wind=fixture();calm.advance(5000);wind.advance(5000);begin(wind);
 calm.advance(240);wind.advance(240);
 assert.ok(+wind.field.dataset.sakuraWindResponse>.99);assert.ok(+wind.field.dataset.sakuraWindShift>=23.9);
 const still=calm.field.ctx.items.slice(0,+calm.field.dataset.sakuraBaseCount),bent=wind.field.ctx.items.slice(0,+wind.field.dataset.sakuraBaseCount);
 const pairs=bent.map(p=>[p,still.find(q=>q.size===p.size)]).filter(([,q])=>q);
 assert.ok(pairs.length>=10);assert.ok(pairs.every(([p,q])=>p.x-q.x>18),'Existing petals must bend in a common direction, not just new petals appearing');
 assert.ok(pairs.every(([p,q])=>p.y-q.y< -5));assert.ok(pairs.every(([p,q])=>Math.abs(p.angle-q.angle-.18)<1e-8));
 wind.advance(1500);assert.equal(+wind.field.dataset.sakuraWindShift,0);assert.ok(extra(wind)<=28);wind.advance(3000);assert.equal(extra(wind),0);
});

test('fresh openings retain the original homepage intro; only a carried scene suppresses its replay',()=>{
 const fresh=fixture();assert.equal(fresh.root.dataset.sakuraContinuing,undefined);
 const css=readFileSync(new URL('../src/styles/sakura.css',import.meta.url),'utf8');
 assert.match(css,/data-sakura-continuing='true'.*\.hero-wrap \.animate-in \{ animation: none; opacity: 1; transform: none;/);
});
