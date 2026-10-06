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
  const window = { addEventListener: listen };
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
test('back/forward uses the same quiet fade and restores current preference', () => {
  const f=fixture();f.fire('pagehide');
  f.fire('pageshow',{persisted:true});assert.equal(f.root.dataset.sakuraArrival,'active');assert.equal(f.root.dataset.sakuraDirection,undefined);
  f.fire('pagehide');f.storage.set('sakura-effects','off');f.fire('pageshow',{persisted:true});
  assert.equal(f.root.dataset.sakuraArrival,undefined);
});
test('reduced motion, coastal theme, visibility and animation end clear the arrival', () => {
  for(const action of [f=>f.theme('poetize'),f=>{f.motion.matches=true;f.motion.change();},f=>{f.document.hidden=true;f.fire('visibilitychange');},f=>f.fire('animationend',{target:{id:'main-content'},animationName:'sakura-page-fade'})]) {
    const f=fixture(); action(f); assert.equal(f.root.dataset.sakuraArrival,undefined); assert.equal(f.timers.size,0);
  }
});
test('normal pageshow does not replay; storage changes are respected', () => {
  const f=fixture();f.fire('animationend',{target:{id:'main-content'},animationName:'sakura-page-fade'});f.fire('pageshow',{persisted:false});
  assert.equal(f.root.dataset.sakuraArrival,undefined);
  f.storage.set('sakura-effects','off');f.fire('storage');f.fire('pageshow',{persisted:true});assert.equal(f.root.dataset.sakuraArrival,undefined);
});
