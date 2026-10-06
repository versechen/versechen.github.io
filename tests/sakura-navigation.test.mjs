import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
const source = readFileSync(new URL('../src/components/SakuraNavigation.astro', import.meta.url), 'utf8').split('<script is:inline>')[1].split('</script>')[0];
function fixture({ theme, reduced = false, quiet = false, blocked = false, stored = 'on' } = {}) {
  const handlers = new Map(), timers = new Map(); let sequence=0, observer;
  const root = { dataset: { visualTheme: theme } };
  const storage = new Map([['sakura-effects', stored]]);
  const motion = { matches: reduced, addEventListener: (_, fn) => { motion.change = fn; } };
  const listen = (name, fn) => handlers.set(name, fn);
  const window = { addEventListener: listen, navigation:{activation:{entry:{index:2},from:{index:1}}} };
  const document = { documentElement: root, readyState:'complete', getElementById: () => ({dataset:{quiet:String(quiet)}}), addEventListener:listen };
  runInNewContext(source, { document, window, matchMedia: () => motion, setTimeout:fn=>{timers.set(++sequence,fn);return sequence;},clearTimeout:id=>timers.delete(id), localStorage: { getItem: key => { if (blocked) throw Error('denied'); return storage.get(key); } }, MutationObserver: class { constructor(fn) { observer=fn; } observe() {} } });
  return {root,storage,motion,window,document,timers,fire:(name,event={})=>handlers.get(name)?.(event),theme:value=>{root.dataset.visualTheme=value;observer();}};
}
test('arrival only runs on eligible Sakura documents', () => {
  assert.equal(fixture().root.dataset.sakuraArrival,'active');
  for(const options of [{theme:'poetize'},{reduced:true},{quiet:true},{stored:'off'}]) assert.equal(fixture(options).root.dataset.sakuraArrival,undefined);
});
test('blocked storage still supports in-memory pause', () => {
  const f=fixture({blocked:true});f.fire('sakura-preference',{detail:false});
  assert.equal(f.root.dataset.sakuraArrival,undefined);
});
test('rapid navigation clears old callbacks and old completion cannot clear new arrival', () => {
  const f=fixture(), old=[...f.timers.values()][0];
  f.fire('pagehide');assert.equal(f.timers.size,0);
  f.fire('pageshow',{persisted:true});old();
  assert.equal(f.root.dataset.sakuraArrival,'active');assert.equal(f.timers.size,1);
  [...f.timers.values()][0]();assert.equal(f.root.dataset.sakuraArrival,undefined);
});
test('back/forward restores the correct direction and current preference', () => {
  const f=fixture();f.fire('pagehide');f.window.navigation.activation={entry:{index:1},from:{index:2}};
  f.fire('pageshow',{persisted:true});assert.equal(f.root.dataset.sakuraDirection,'back');
  f.fire('pagehide');f.storage.set('sakura-effects','off');f.fire('pageshow',{persisted:true});
  assert.equal(f.root.dataset.sakuraArrival,undefined);
});
test('reduced motion, coastal theme, visibility and animation end clear the arrival', () => {
  for(const action of [f=>f.theme('poetize'),f=>{f.motion.matches=true;f.motion.change();},f=>{f.document.hidden=true;f.fire('visibilitychange');},f=>f.fire('animationend',{target:{id:'sakura-passage'}})]) {
    const f=fixture(); action(f); assert.equal(f.root.dataset.sakuraArrival,undefined); assert.equal(f.timers.size,0);
  }
});
test('normal pageshow does not replay; storage changes are respected', () => {
  const f=fixture();f.fire('animationend',{target:{id:'sakura-passage'}});f.fire('pageshow',{persisted:false});
  assert.equal(f.root.dataset.sakuraArrival,undefined);
  f.storage.set('sakura-effects','off');f.fire('storage');f.fire('pageshow',{persisted:true});assert.equal(f.root.dataset.sakuraArrival,undefined);
});

// The refinement stays on the existing transition and automatic entry wind.
const effectsSource = readFileSync(new URL('../src/lib/sakura-effects.ts', import.meta.url), 'utf8');
function windFixture({ small = false, allowed = true } = {}) {
  const breeze = effectsSource.match(/const breeze = \(\) => \{([\s\S]*?)\n  \};/)[0];
  const arrival = effectsSource.match(/const arrivalBreeze = \(\) => \{([\s\S]*?)\n  \};/)[0];
  const petals = Array.from({length:6},(_,i)=>({x:300+i*20,y:150+i*30}));
  const api = {};
  runInNewContext(`let gust=0,lastGust=-5000;${breeze};${arrival};api.arrive=arrivalBreeze;api.wind=breeze;api.gust=()=>gust;`,
    {api,small,active:()=>allowed,petals,width:1200,height:800,performance:{now:()=>1000}});
  return {api,petals};
}
test('automatic arrival is gentle and never teleports the existing field',()=>{
  for(const [small,expected] of [[false,.28],[true,.2]]){
    const f=windFixture({small}),before=structuredClone(f.petals);f.api.arrive();
    assert.equal(f.api.gust(),expected);assert.deepEqual(f.petals,before);
  }
  const blocked=windFixture({allowed:false});blocked.api.arrive();assert.equal(blocked.api.gust(),0);
});
test('explicit wind retains the original strength and reuses the original pool',()=>{
  for(const [small,expected] of [[false,2.2],[true,1.6]]){
    const f=windFixture({small});f.api.arrive();f.api.wind();assert.equal(f.api.gust(),expected);
    assert.equal(f.petals.length,6);assert.ok(f.petals[0].x<=240);assert.equal(f.petals[1].x,320);
    f.api.arrive();assert.equal(f.api.gust(),small?.2:.28,'History arrival must settle any earlier manual gust');
  }
});
test('sparse pink-white passage stays visible, falls downward and fades before cleanup',()=>{
  const css=readFileSync(new URL('../src/styles/sakura.css',import.meta.url),'utf8');
  assert.match(css,/sakura-wind-in 1\.5s/);assert.match(css,/animation-duration: 1\.35s/);
  assert.match(css,/clamp\(760px, 100vw, 1200px\) auto no-repeat/);
  assert.match(css,/translate\(-5%, -8%\) rotate\(-2deg\)/);
  assert.match(css,/translate\(5%, -8%\) rotate\(2deg\)/);
  assert.match(css,/translate\(7%, 14%\) rotate\(3deg\); opacity: 0/);
  assert.match(css,/translate\(-7%, 14%\) rotate\(-3deg\); opacity: 0/);
  assert.equal((css.match(/48% \{ opacity: \.5; \}/g)||[]).length,2);
  assert.match(source,/, 1800\)/);assert.doesNotMatch(source,/preventDefault|location\.assign/);
  const svg=readFileSync(new URL('../src/assets/images/sakura-wind.svg',import.meta.url),'utf8');
  assert.equal((svg.match(/<use /g)||[]).length,10);
  assert.ok([...svg.matchAll(/scale\(([.0-9]+)\)/g)].every(m=>+m[1]<=.3));
  assert.deepEqual([...svg.matchAll(/stop-color="(#[a-f0-9]+)"/g)].map(m=>m[1]),['#fffdfd','#ffe8ee','#f1bfcd']);
});
