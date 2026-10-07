import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {test} from 'node:test';
import ts from 'typescript';
const source=ts.transpile(readFileSync(new URL('../src/lib/coastal-sea.ts',import.meta.url),'utf8'),{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS});
const load=(globals={})=>{const exported={};runInNewContext(source,{exports:exported,Math,...globals});return exported;};
const lib=load();
const rect=(left,top,width,height)=>({left,top,width,height,right:left+width,bottom:top+height});
const within=(x,y,r,pad=0)=>x>=r.left-pad&&x<=r.left+r.width+pad&&y>=r.top-pad&&y<=r.top+r.height+pad;

function fixture({header=64,width=1440,height=900,ambient=true,scene='home',src='/themes/coastal/home-wide-2172.webp',natural=[2172,724],position='40% 50%',heroHeight=580,title=rect(420,200,600,90)}={}){
 let time=0,id=0,seed=4242;const frames=new Map(),events=new Map(),sprites=[];
 const env={};
 const ctx={items:[],clears:0,globalAlpha:1,strokeStyle:'',lineWidth:1,lineCap:'',lineJoin:'',x:0,y:0,clearRect(){this.items=[];this.clears++;},setTransform(){},save(){},restore(){this.x=this.y=0;},translate(a,b){this.x=a;this.y=b;},rotate(){},rect(){},clip(){},beginPath(){},moveTo(){},quadraticCurveTo(){},
  stroke(){if(this.strokeStyle==='#fbfdff')this.items.push({kind:'gull',x:this.x,y:this.y,alpha:this.globalAlpha});},
  drawImage(img,x,y,w,h){const kind=['dash','star','bubble'][sprites.indexOf(img)];this.items.push({kind:kind==='bubble'?'bubble':'glint',x:x+w/2,y:y+h/2,w,h,alpha:this.globalAlpha});}};
 const canvas={hidden:true,width:0,height:0,dataset:{},getContext:()=>ctx};
 const sprite=()=>{const c={width:0,height:0,getContext:()=>({setTransform(){},createRadialGradient:()=>({addColorStop(){}}),fillRect(){},beginPath(){},ellipse(){},arc(){},fill(){},stroke(){}})};sprites.push(c);return c;};
 const image={naturalWidth:natural[0],naturalHeight:natural[1],currentSrc:src,getBoundingClientRect:()=>rect(0,-env.scrollY,width,heroHeight),addEventListener(){},removeEventListener(){}};
 const titleNode={getBoundingClientRect:()=>rect(title.left,title.top-env.scrollY,title.width,title.height)};
 const hero={querySelectorAll:()=>[titleNode]};
 const sceneNode={dataset:{scene},querySelector:()=>image,parentElement:{closest:()=>hero},getBoundingClientRect:()=>rect(0,-env.scrollY,width,heroHeight)};
 const seeded=Object.create(Math);seeded.random=()=>((seed=Math.imul(seed,1664525)+1013904223)>>>0)/2**32;
 Object.assign(env,{exports:{},Math:seeded,innerWidth:width,innerHeight:height,devicePixelRatio:2,scrollY:0,
  document:{documentElement:{classList:{contains:()=>false}},querySelector:s=>s==='.coastal-scene'?sceneNode:s==='#site-header'?{getBoundingClientRect:()=>rect(0,0,width,header)}:null,createElement:sprite},
  getComputedStyle:()=>({objectPosition:position}),performance:{now:()=>time},
  requestAnimationFrame:fn=>{frames.set(++id,fn);return id;},cancelAnimationFrame:key=>frames.delete(key),
  addEventListener:(name,fn)=>events.set(name,fn),removeEventListener:name=>events.delete(name)});
 runInNewContext(source,env);
 const sea=env.exports.initCoastalSea(canvas,{ambient});
 const advance=(ms,interval=1000/60)=>{for(const end=time+ms;time<end;){time+=interval;const work=[...frames.values()];frames.clear();for(const fn of work)fn(time);}};
 const painted=lib.coverRect(rect(0,0,width,heroHeight),natural[0],natural[1],lib.parseObjectPosition(position));
 const zones=lib.SCENE_ZONES[/portrait/.test(src)?'home-portrait':scene];
 const box=rect(0,0,width,heroHeight),above=rect(0,0,width,heroHeight-72);
 return{sea,canvas,ctx,frames,advance,env,
  scroll(y){env.scrollY=y;events.get('scroll')?.();},
  sky:()=>lib.flightLanes(lib.projectZones(zones.sky,painted,box),lib.projectZones(zones.sea,painted,above),header+6).map(r=>({...r,top:r.top-env.scrollY})),
  water:()=>lib.projectZones(zones.sea,painted,above).map(r=>({...r,top:r.top-env.scrollY})),
  title:()=>({...title,top:title.top-env.scrollY}),
  header,drawn:kind=>ctx.items.filter(i=>i.kind===kind)};
}

test('object-position values resolve to alignment ratios',()=>{
 assert.deepEqual([...lib.parseObjectPosition('60% 50%')],[.6,.5]);
 assert.deepEqual([...lib.parseObjectPosition('center 53%')],[.5,.53]);
 assert.deepEqual([...lib.parseObjectPosition('top right')],[1,0]);
 assert.deepEqual([...lib.parseObjectPosition('')],[.5,.5]);
});
test('object-fit cover maps the painting the way the browser crops it',()=>{
 const wide=lib.coverRect(rect(0,0,1440,580),2172,724,[.4,.5]);
 assert.ok(Math.abs(wide.height-580)<1e-9&&Math.abs(wide.width-1740)<1);
 assert.ok(Math.abs(wide.left-(1440-wide.width)*.4)<1e-9&&wide.top===0);
 const tall=lib.coverRect(rect(0,100,390,460),1672,941,[.6,.5]);
 assert.ok(Math.abs(tall.height-460)<1e-9&&tall.top===100&&tall.left<0);
});
test('zones are clipped to the visible painting and slivers are dropped',()=>{
 const painted=rect(-200,0,1800,600);
 const [sea]=lib.projectZones([[0,.5,.5,1]],painted,rect(0,0,1400,600));
 assert.equal(sea.left,0);assert.equal(sea.width,700);assert.equal(sea.top,300);
 assert.equal(lib.projectZones([[0,0,.1,.5]],painted,rect(0,0,1400,600)).length,0);
});
test('gulls keep below the fixed header and skim the sea when a short hero crops the sky away',()=>{
 const sky=[rect(100,10,600,90)],sea=[rect(0,200,300,80),rect(300,150,900,200)];
 assert.equal(JSON.stringify(lib.flightLanes(sky,sea,70)),JSON.stringify([{left:100,top:70,width:600,height:30}]));
 const [lane]=lib.flightLanes(sky,sea,95);
 assert.equal(lane.left,300);assert.equal(lane.top,150);assert.equal(lane.height,90,'The upper part of the largest sea');
 assert.equal(lib.flightLanes([],[rect(0,0,40,40)],0).length,0);
});
test('picked points never land on text, and give up instead of forcing one',()=>{
 const random=(()=>{let s=7;return()=>((s=Math.imul(s,1664525)+1013904223)>>>0)/2**32;})();
 const sea=[rect(0,0,400,200)],text=[rect(100,50,200,100)];
 for(let i=0;i<200;i++){const p=lib.pickPoint(sea,text,random);if(p)assert.ok(!within(p.x,p.y,text[0]));}
 assert.equal(lib.pickPoint(sea,[rect(-10,-10,500,300)],random),null);
 assert.equal(lib.pickPoint([],[],random),null);
});
test('gulls glide inside the sky, glints twinkle on the sea away from the title, bubbles rise from below',()=>{
 const f=fixture();f.sea.setActive(true);
 const seen={gull:0,glint:0,bubble:0};
 for(let i=0;i<40;i++){
  f.advance(100);
  for(const item of f.ctx.items){
   seen[item.kind]++;
   if(item.kind==='gull')assert.ok(f.sky().some(r=>within(item.x,item.y,r,2)),`gull at ${item.x},${item.y}`);
   if(item.kind==='glint'){assert.ok(f.water().some(r=>within(item.x,item.y,r,1)),`glint at ${item.x},${item.y}`);assert.ok(!within(item.x,item.y,f.title()));}
   if(item.kind==='bubble')assert.ok(item.y>900*.3&&item.y<=900+8);
   if(item.kind!=='bubble')assert.ok(item.y>f.header,'Nothing is placed under the fixed header');
  }
  assert.ok(f.drawn('gull').length<=3&&f.drawn('glint').length<=16&&f.drawn('bubble').length<=9);
 }
 assert.ok(seen.gull>0&&seen.glint>0&&seen.bubble>0,JSON.stringify(seen));
 assert.equal(f.canvas.hidden,false);
 assert.ok(+f.canvas.dataset.gulls>0&&+f.canvas.dataset.glints>0&&+f.canvas.dataset.bubbles>0);
 assert.equal(f.canvas.width,2160,'DPR is capped at 1.5 on desktop');
});
test('glints and gulls ride along with the painting while the page scrolls',()=>{
 const f=fixture();f.sea.setActive(true);f.advance(1500);
 f.scroll(240);
 for(let i=0;i<12;i++){f.advance(100);for(const g of f.drawn('glint'))assert.ok(f.water().some(r=>within(g.x,g.y,r,1)));for(const g of f.drawn('gull'))assert.ok(f.sky().some(r=>within(g.x,g.y,r,2)));}
});
test('a short inner hero without visible sky still gets gulls, flying low over the water',()=>{
 const f=fixture({ambient:false,scene:'studio',src:'/themes/coastal/studio-1672.webp',natural:[1672,941],position:'55% 45%',heroHeight:340});
 assert.equal(lib.projectZones(lib.SCENE_ZONES.studio.sky,lib.coverRect(rect(0,0,1440,340),1672,941,[.55,.45]),rect(0,0,1440,340)).length,0,'The painted sky is cropped away');
 f.sea.setActive(true);f.advance(2500);
 const gulls=f.drawn('gull');assert.ok(gulls.length>0);
 for(const g of gulls)assert.ok(f.sky().some(r=>within(g.x,g.y,r,2)));
});
test('a gull crossing a title fades out as if it flew behind the lettering',()=>{
 const title=rect(1040,90,60,30);
 const f=fixture({ambient:false,scene:'studio',src:'/themes/coastal/studio-1672.webp',natural:[1672,941],position:'55% 45%',heroHeight:340,title});
 const [lane]=f.sky();assert.ok(within(1070,105,lane),'The title sits inside the only flight lane');
 f.sea.setActive(true);let near=0;
 for(let i=0;i<300;i++){f.advance(100);for(const g of f.drawn('gull')){assert.ok(!within(g.x,g.y,title,10),`gull drawn on the title at ${g.x},${g.y}`);if(within(g.x,g.y,title,40))near++;}}
 assert.ok(near>0,'Gulls still fly close to the title');
});
test('reading pages keep bubbles off and park the canvas once the hero scrolls away',()=>{
 const f=fixture({ambient:false,scene:'writing',src:'/themes/coastal/writing-1672.webp',natural:[1672,941],position:'50% 53%',heroHeight:360});
 f.sea.setActive(true);f.advance(1500);
 assert.equal(f.drawn('bubble').length,0);assert.ok(f.drawn('gull').length+f.drawn('glint').length>0);
 f.scroll(900);f.advance(200);
 assert.equal(f.canvas.hidden,true);assert.equal(f.frames.size,0,'No animation frames while nothing can be seen');
 f.scroll(0);assert.equal(f.canvas.hidden,false);f.advance(1000);assert.ok(f.drawn('gull').length+f.drawn('glint').length>0);
});
test('small screens run lighter: fewer gulls, glints and bubbles at 30fps with a lower DPR',()=>{
 const f=fixture({width:390,height:844,src:'/themes/coastal/home-portrait-940.webp',natural:[940,1670],position:'50% 50%',heroHeight:460,title:rect(40,160,310,80)});
 f.sea.setActive(true);f.advance(500);
 const start=f.ctx.clears;f.advance(1000);
 assert.ok(f.ctx.clears-start<=31&&f.ctx.clears-start>=25,`${f.ctx.clears-start} paints per second`);
 assert.equal(f.canvas.width,488);
 f.advance(3000);
 for(let i=0;i<20;i++){f.advance(100);assert.ok(f.drawn('gull').length<=2&&f.drawn('glint').length<=8&&f.drawn('bubble').length<=5);for(const g of f.drawn('gull'))assert.ok(f.sky().some(r=>within(g.x,g.y,r,2)));}
});
test('shrinking to a phone width trims the pools that were filled at desktop size',()=>{
 const f=fixture();f.sea.setActive(true);f.advance(3000);
 assert.ok(f.drawn('bubble').length>5);
 Object.assign(f.env,{innerWidth:390,innerHeight:844});f.sea.resize();
 for(let i=0;i<10;i++){f.advance(100);assert.ok(f.drawn('bubble').length<=5&&f.drawn('glint').length<=8&&f.drawn('gull').length<=2);}
});
test('turning the effects off hides the canvas and stops every frame',()=>{
 const f=fixture();f.sea.setActive(true);f.advance(500);
 f.sea.setActive(false);assert.equal(f.canvas.hidden,true);assert.equal(f.frames.size,0);assert.equal(f.ctx.items.length,0);
 f.scroll(10);assert.equal(f.frames.size,0,'Scrolling does not wake a disabled field');
 f.sea.destroy();assert.equal(f.frames.size,0);
});
