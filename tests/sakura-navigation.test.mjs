import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {test} from 'node:test';
const source=readFileSync(new URL('../src/components/SakuraNavigation.astro',import.meta.url),'utf8').split('<script is:inline>')[1].split('</script>')[0];
function fixture({theme,reduced=false,quiet=false,paused=false,ready=true,accept=true}={}){
 const events=new Map(),timers=new Map(),assigned=[],signals=[];let id=0,now=0,observer;
 const root={dataset:{visualTheme:theme,sakuraReady:String(ready),sakuraMotion:paused?'off':'on'}};
 const motion={matches:reduced,addEventListener(_,fn){this.change=fn;}};
 const storage=new Map([['sakura-effects',paused?'off':'on']]);
 const listen=(k,fn)=>events.set(k,[...(events.get(k)||[]),fn]);
 const fire=(k,e={})=>{for(const fn of events.get(k)||[])fn(e);};
 const window={stops:0,stop(){this.stops++;},addEventListener:listen,dispatchEvent(e){signals.push(e);if(e.type==='sakura-navigation-start')e.detail.accepted=accept;fire(e.type,e);},scrollTo(options){window.scroll=options;},navigation:{activation:{entry:{index:2},from:{index:1}}}};
 const document={documentElement:root,readyState:'complete',hidden:false,getElementById:()=>({dataset:{quiet:String(quiet)}}),addEventListener:listen};
 const location={href:'https://example.com/',origin:'https://example.com',pathname:'/',search:'',hash:'',assign:url=>assigned.push(url)};
 runInNewContext(source,{document,window,location,URL,performance:{now:()=>now},matchMedia:()=>motion,localStorage:{getItem:k=>storage.get(k)},setTimeout:(fn,ms)=>{timers.set(++id,{fn,ms,at:now+ms});return id;},clearTimeout:k=>timers.delete(k),Event:class{constructor(type){this.type=type;}},CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}},MutationObserver:class{constructor(fn){observer=fn;}observe(){}}});
 const click=(href,options={})=>{const link={href,target:'',hasAttribute:k=>options[k]===true,matches:()=>options.nav!==false,...options};const e={...options,button:options.button??0,target:{closest:()=>link},preventDefault(){this.defaultPrevented=true;}};fire('click',e);return e;};
 const advance=ms=>{now+=ms;for(const[k,t]of[...timers])if(t.at<=now){timers.delete(k);t.fn();}};
 return{root,motion,storage,document,window,location,timers,assigned,signals,fire,click,advance,theme(value){root.dataset.visualTheme=value;observer();}};
}
test('old page starts its renderer before native navigation receives the URL',()=>{
 const f=fixture();assert.equal(f.click('/blog').defaultPrevented,true);
 assert.ok(f.signals.some(e=>e.type==='sakura-navigation-start'));assert.deepEqual(f.assigned,[]);
 f.advance(339);assert.deepEqual(f.assigned,[]);f.advance(1);assert.deepEqual(f.assigned,['https://example.com/blog']);
 assert.ok(f.signals.some(e=>e.type==='sakura-navigation-handoff'));
});
test('rapid changes retain the first departure deadline and only the last target wins',()=>{
 const f=fixture();f.click('/blog');const old=[...f.timers.values()].find(t=>t.ms===340).fn;
 f.advance(220);f.click('/reading');old();assert.deepEqual(f.assigned,[]);f.advance(120);
 assert.deepEqual(f.assigned,['https://example.com/reading']);
});
test('a newer target supersedes an already-started native request immediately',()=>{
 const f=fixture();f.click('/blog');f.advance(340);f.click('/reading');assert.deepEqual(f.assigned,['https://example.com/blog','https://example.com/reading']);
});
test('Escape, pause, theme and hiding before handoff cancel the pending destination',()=>{
 for(const cancel of [f=>f.fire('keydown',{key:'Escape'}),f=>f.fire('sakura-preference',{detail:false}),f=>f.theme('poetize'),f=>{f.motion.matches=true;f.motion.change();},f=>{f.document.hidden=true;f.fire('visibilitychange');}]){
  const f=fixture();f.click('/blog');cancel(f);f.advance(500);assert.deepEqual(f.assigned,[]);assert.equal(f.root.dataset.sakuraDeparture,undefined);
 }
});
test('modified, middle, download, target, external, hash and utility links keep native semantics',()=>{
 for(const [href,options]of[['/blog',{ctrlKey:true}],['/blog',{metaKey:true}],['/blog',{shiftKey:true}],['/blog',{altKey:true}],['/blog',{button:1}],['/file',{download:true}],['/blog',{target:'_blank'}],['/blog',{target:'_top'}],['https://elsewhere.test',{}],['mailto:a@example.com',{}],['#content',{}],['/blog#content',{}],['/rss.xml',{}],['/notes',{}],['/projects/a/docs/',{}],['/blog',{'data-no-sakura':true}],['/blog',{defaultPrevented:true}]]){
  const f=fixture(),e=f.click(href,options);if(!options.defaultPrevented)assert.notEqual(e.defaultPrevented,true,href);f.advance(400);assert.equal(f.assigned.length,0);
 }
});
test('same-page top navigation scrolls up without reload or another breeze',()=>{
 const f=fixture();f.location.href='https://example.com/?wind=version';f.location.search='?wind=version';
 assert.equal(f.click('/').defaultPrevented,true);assert.equal(f.window.scroll.top,0);
 assert.ok(!f.signals.some(e=>e.type==='sakura-navigation-start'));f.advance(500);assert.deepEqual(f.assigned,[]);
});
test('unavailable renderer/storage and paused or reduced motion never hold a link',()=>{
 for(const options of[{ready:false},{accept:false},{paused:true},{reduced:true},{theme:'poetize'},{quiet:true}]){
  const f=fixture(options),e=f.click('/blog');assert.notEqual(e.defaultPrevented,true);f.advance(400);assert.equal(f.assigned.length,0);
 }
});
test('pagehide then visibilitychange does not erase the departing Canvas handoff',()=>{
 const f=fixture();f.click('/blog');f.advance(340);f.fire('pagehide');
 const n=f.signals.filter(e=>e.type==='sakura-navigation-cancel').length;
 f.document.hidden=true;f.fire('visibilitychange');assert.equal(f.signals.filter(e=>e.type==='sakura-navigation-cancel').length,n);
});
test('history restoration stays browser-owned; its popstate does not cancel fresh arrival',()=>{
 const f=fixture();f.fire('pagehide');f.window.navigation.activation={entry:{index:1},from:{index:2}};f.fire('pageshow',{persisted:true});f.fire('popstate');
 assert.equal(f.root.dataset.sakuraArrival,'active');assert.equal(f.root.dataset.sakuraDirection,'back');assert.deepEqual(f.assigned,[]);
});
test('Canvas completion never cancels a legitimate pending navigation',()=>{
 const f=fixture();f.click('/blog');f.fire('sakura-arrival-end');f.fire('DOMContentLoaded');f.advance(340);assert.equal(f.assigned.length,1);
});
test('network fallback settles the scene without reviving a stale destination',()=>{
 const f=fixture();f.click('/blog');f.advance(340);f.advance(5000);
 assert.equal(f.root.dataset.sakuraDeparture,undefined);assert.ok(f.signals.some(e=>e.type==='sakura-navigation-abandon'));
 assert.deepEqual(f.assigned,['https://example.com/blog']);
});

test('current-page choice stops an already-started load before scrolling the old page',()=>{
 const f=fixture();f.click('/blog');f.advance(340);f.click('/');assert.equal(f.window.stops,1);assert.equal(f.window.scroll.top,0);
 f.click('/reading');assert.equal(f.assigned.length,1);f.advance(340);assert.equal(f.assigned.at(-1),'https://example.com/reading');
});
test('Escape aborts an in-flight load and restores the next old-page display opportunity',()=>{
 const f=fixture();f.click('/blog');f.advance(340);f.fire('keydown',{key:'Escape'});assert.equal(f.window.stops,1);
 f.click('/reading');assert.equal(f.assigned.length,1);f.advance(339);assert.equal(f.assigned.length,1);f.advance(1);assert.equal(f.assigned.length,2);
});
test('same-context native targets cancel an older pending departure without interception',()=>{
 for(const target of ['_top','_parent']){const f=fixture();f.click('/blog');const e=f.click('/reading',{target});assert.notEqual(e.defaultPrevented,true);f.advance(500);assert.deepEqual(f.assigned,[]);}
});
