import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
const source = readFileSync(new URL('../src/components/SakuraNavigation.astro', import.meta.url), 'utf8').split('<script is:inline>')[1].split('</script>')[0];
function fixture({ theme, reduced = false, quiet = false, blocked = false, stored = 'on' } = {}) {
  const handlers = new Map(), timers = new Map(), assigned = [], dispatched = []; let sequence=0, observer;
  const root = { dataset: { visualTheme: theme } };
  const storage = new Map([['sakura-effects', stored]]);
  const motion = { matches: reduced, addEventListener: (_, fn) => { motion.change = fn; } };
  const listen = (name, fn) => handlers.set(name, fn);
  const window = { addEventListener: listen, dispatchEvent:event=>dispatched.push(event) };
  const document = { documentElement: root, readyState:'complete', getElementById: () => ({dataset:{quiet:String(quiet)}}), addEventListener:listen };
  const location = {href:'https://example.com/',origin:'https://example.com',pathname:'/',search:'',assign:href=>assigned.push(href)};
  runInNewContext(source, { document, window, location, URL, Event:class{constructor(type){this.type=type;}},CustomEvent:class{constructor(type,options){this.type=type;this.detail=options?.detail;}}, matchMedia: () => motion, setTimeout:(fn,ms)=>{timers.set(++sequence,{fn,ms});return sequence;},clearTimeout:id=>timers.delete(id), localStorage: { getItem: key => { if (blocked) throw Error('denied'); return storage.get(key); } }, MutationObserver: class { constructor(fn) { observer=fn; } observe() {} } });
  const fire=(name,event={})=>handlers.get(name)?.(event);
  const click=(href,options={})=>{const link={href,target:'',hasAttribute:name=>options[name]===true,...options};const event={button:0,preventDefault(){this.defaultPrevented=true;},target:{closest:()=>link},...options};fire('click',event);return event;};
  const tick=ms=>{for(const [id,timer] of [...timers])if(timer.ms===ms){timers.delete(id);timer.fn();}};
  return {root,storage,motion,window,document,timers,assigned,dispatched,fire,click,tick,theme:value=>{root.dataset.visualTheme=value;observer();}};
}
test('arrival only runs on eligible Sakura documents', () => {
  assert.equal(fixture().root.dataset.sakuraArrival,'active');
  for(const options of [{theme:'poetize'},{reduced:true},{quiet:true},{stored:'off'}]) assert.equal(fixture(options).root.dataset.sakuraArrival,undefined);
});
test('blocked storage still supports in-memory pause', () => {
  const f=fixture({blocked:true});f.fire('sakura-preference',{detail:false});
  assert.equal(f.root.dataset.sakuraArrival,undefined);
});
test('latest ordinary navigation wins with one native history entry', () => {
  const f=fixture(); assert.equal(f.click('/blog').defaultPrevented,true);
  const old=[...f.timers.values()].find(t=>t.ms===180).fn;
  f.click('/about');old();assert.deepEqual(f.assigned,[]);
  f.tick(180);assert.deepEqual(f.assigned,['https://example.com/about']);
  assert.equal(f.dispatched.at(-1).detail,'https://example.com/about');
  f.tick(900);assert.equal(f.root.dataset.sakuraDeparture,undefined);
});
test('Escape, theme, pause and hidden page cancel pending navigation', () => {
  for(const cancel of [f=>f.fire('keydown',{key:'Escape'}),f=>f.theme('poetize'),f=>f.fire('sakura-preference',{detail:false}),f=>{f.document.hidden=true;f.fire('visibilitychange');},f=>f.fire('popstate')]){
    const f=fixture();f.click('/blog');cancel(f);f.tick(180);assert.deepEqual(f.assigned,[]);assert.equal(f.root.dataset.sakuraDeparture,undefined);
  }
});
test('native anchor semantics are preserved', () => {
  for(const [href,options] of [['/blog',{metaKey:true}],['/blog',{ctrlKey:true}],['/blog',{shiftKey:true}],['/blog',{altKey:true}],['/blog',{button:1}],['/blog',{target:'_blank'}],['/file',{download:true}],['#main-content',{}],['https://other.com/blog',{}],['mailto:hello@example.com',{}],['/rss.xml',{}],['/notes',{}],['/projects/x/docs/',{}],['/blog',{'data-no-sakura':true}],['/blog',{defaultPrevented:true}]]){
    const f=fixture();const e=f.click(href,options);if(!options.defaultPrevented)assert.notEqual(e.defaultPrevented,true,href);f.tick(180);assert.deepEqual(f.assigned,[]);
  }
});
test('a newer same-document or external navigation supersedes departure', () => {
  for(const href of ['#main-content','https://other.com/blog','/notes']){const f=fixture();f.click('/blog');f.click(href);f.tick(180);assert.deepEqual(f.assigned,[]);}
});
test('restored history stays settled and preserves the current preference', () => {
  const f=fixture();f.click('/blog');f.fire('pagehide');f.fire('pageshow',{persisted:true});
  assert.equal(f.root.dataset.sakuraArrival,undefined);assert.equal(f.root.dataset.sakuraDeparture,undefined);assert.equal(f.timers.size,0);
});
test('reduced motion, coastal theme, visibility and animation end clear arrival', () => {
  for(const action of [f=>f.theme('poetize'),f=>{f.motion.matches=true;f.motion.change();},f=>{f.document.hidden=true;f.fire('visibilitychange');},f=>f.fire('animationend',{target:{id:'main-content'},animationName:'sakura-page-arrive'})]) {
    const f=fixture(); action(f); assert.equal(f.root.dataset.sakuraArrival,undefined); assert.equal(f.timers.size,0);
  }
});
test('missing animationend has a finite fallback; old callbacks do not clear newer navigation',()=>{
  const f=fixture(),old=[...f.timers.values()][0].fn;f.click('/blog');old();assert.equal(f.root.dataset.sakuraDeparture,'active');f.tick(180);assert.equal(f.assigned.length,1);
});

test('newer delegated or opted-out same-tab links cancel the older destination',()=>{
  for(const options of [{'data-no-sakura':true},{defaultPrevented:true}]){const f=fixture();f.click('/blog');f.click('/about',options);f.tick(180);assert.deepEqual(f.assigned,[]);assert.equal(f.root.dataset.sakuraDeparture,undefined);}
});
test('title arrival does not replace and then replay the existing fade-up',()=>{
  const css=readFileSync(new URL('../src/styles/sakura.css', import.meta.url),'utf8');
  assert.match(css,/:not\(\.animate-fade-up\) \{ animation: sakura-title-arrive/);
  assert.match(css,/sakura-title-arrive \.68s/);
});
