import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { runInNewContext } from 'node:vm';
const transpile = source => ts.transpile(source, { target: ts.ScriptTarget.ES2022 });
const tocBounds = runInNewContext(transpile(readFileSync(new URL('../src/lib/toc-geometry.ts', import.meta.url), 'utf8').replace('export function', 'function')) + '; tocBounds');

const source = transpile(readFileSync(new URL('../src/components/TableOfContents.astro', import.meta.url), 'utf8')
  .match(/<script>([\s\S]*?)<\/script>/)[1].replace(/import .*?;\n/, ''));

// Run the actual component controller with deterministic geometry and timers.
function fixture({ pinned = false, top = 400, bottom = 1600, height = 900, fine = true } = {}) {
  let document, timerId = 0, now = 0, pointerTarget;
  const timers = new Map(), storage = new Map([['codeverse.articleToc.pin.v2', pinned ? '1' : '0']]);
  const rect = { top, bottom, left: 290 };
  class Element {
    constructor() { this.dataset = {}; this.attrs = new Map(); this.events = new Map(); this.classes = new Set(); this.inert = false;
      this.classList = { toggle: (c, on) => on ? this.classes.add(c) : this.classes.delete(c) };
      this.style = { setProperty: (k, v) => this.attrs.set(k, v) }; }
    addEventListener(type, fn) { this.events.set(type, [...(this.events.get(type) || []), fn]); }
    fire(type, event = {}) { for (const fn of this.events.get(type) || []) fn(event); }
    setAttribute(k, v) { this.attrs.set(k, v); }
    removeAttribute(k) { this.attrs.delete(k); }
    contains(e) { return this === e || (this === toc && [panel, trigger, pin, close].includes(e)) || (this === panel && [pin, close].includes(e)); }
    querySelectorAll() { return []; }
    getBoundingClientRect() { return rect; }
    closest() { return null; }
    focus() { document.activeElement = this; }
    blur() { document.activeElement = null; }
  }
  const toc = new Element(), panel = new Element(), trigger = new Element(), pin = new Element(), close = new Element(), main = new Element(), root = new Element();
  const ids = { 'article-toc': toc, 'article-toc-panel': panel, 'article-toc-trigger': trigger, 'article-toc-pin': pin, 'article-toc-close': close };
  document = Object.assign(new Element(), { activeElement: null, documentElement: root, getElementById: id => ids[id], querySelector: () => main, elementFromPoint: () => pointerTarget || main });
  const timeout = (fn, delay = 0) => { const id = ++timerId; timers.set(id, { fn, at: now + delay }); return id; };
  const window = Object.assign(new Element(), { setTimeout: timeout });
  const context = { document, window, innerWidth: 1440, innerHeight: height, localStorage: { getItem: k => storage.get(k), setItem: (k,v) => storage.set(k,v) }, getComputedStyle: () => ({ getPropertyValue: () => '64' }), matchMedia: () => ({ matches: fine }), ResizeObserver: class { observe() {} }, clearTimeout: id => timers.delete(id), requestAnimationFrame: fn => timeout(fn, 16), tocBounds };
  runInNewContext(source, context);
  const tick = (ms = 500) => {
    const end = now + ms;
    for (;;) { const next = [...timers].filter(([,t]) => t.at <= end).sort((a,b) => a[1].at - b[1].at)[0]; if (!next) break; timers.delete(next[0]); now = next[1].at; next[1].fn(); }
    now = end;
  };
  const update = (next, event = 'scroll') => { Object.assign(rect, next); window.fire(event); tick(); };
  const pointer = (x, y, target) => { pointerTarget = target; document.fire('pointermove', { pointerType: 'mouse', clientX: x, clientY: y }); tick(); };
  const visible = () => toc.classes.has('is-open');
  const expectHidden = () => { assert.equal(visible(), false); assert.equal(panel.inert, true); assert.equal(panel.attrs.get('aria-hidden'), 'true'); assert.equal(trigger.attrs.get('aria-expanded'), 'false'); };
  return { toc, panel, trigger, pin, close, document, window, context, rect, storage, tick, update, pointer, visible, expectHidden };
}

test('visible interval covers hero, entry, middle, exit, footer and short viewports', () => {
  for (const [top, bottom, height, available] of [[1000,2000,900,false],[860,1860,900,false],[616,1800,1173,true],[-120,1200,900,true],[-1200,207,900,false],[-1200,208,900,true],[-1600,-100,900,false],[-100,1800,200,false]]) {
    const b = tocBounds({ top, bottom }, height, 64);
    assert.equal(b.available, available, `${top},${bottom},${height}`);
    if (available) { assert.ok(b.top >= top); assert.ok(b.bottom <= bottom); assert.ok(b.top >= 80); assert.ok(b.bottom <= height - 16); assert.equal(b.height,b.bottom-b.top); }
  }
  for(let top=-2000;top<1800;top+=17) for (const articleHeight of [128,300,1800,10000]) {
    const bottom = top + articleHeight, b = tocBounds({top,bottom},900,64);
    if(b.available) assert.ok(b.top >= top && b.top + b.height <= bottom && b.top + b.height <= 884);
  }
});

test('persisted pin hides outside body and restores without losing stored intent', () => {
  const f=fixture({pinned:true,top:1000,bottom:2400}); f.expectHidden(); assert.equal(f.trigger.inert,true);
  f.update({top:616,bottom:2016}); assert.equal(f.visible(),true); assert.equal(f.toc.attrs.get('--toc-top'),'616px');
  f.update({top:-120,bottom:1280}); assert.equal(f.toc.attrs.get('--toc-top'),'80px');
  f.update({top:-1250,bottom:150}); f.expectHidden(); assert.equal(f.toc.dataset.state,'pinned');
  f.update({top:-1500,bottom:-100}); f.expectHidden();
  f.update({top:400,bottom:1800}); assert.equal(f.visible(),true); assert.equal(f.storage.get('codeverse.articleToc.pin.v2'),'1');
});

test('temporary pointer hold cannot bypass article bounds; stationary pointer is re-sensed', () => {
  const f=fixture(); f.pointer(30,500); assert.equal(f.visible(),true);
  f.pointer(100,500,f.panel); assert.equal(f.visible(),true);
  f.update({top:950,bottom:2150}); f.expectHidden(); assert.equal(f.toc.dataset.state,'collapsed');
  f.update({top:400,bottom:1600}); assert.equal(f.visible(),true);
  f.update({top:-1400,bottom:-200}); f.expectHidden();
  f.update({top:400,bottom:1600}); assert.equal(f.visible(),true);
  f.pointer(1300,500); f.expectHidden();
});

test('delayed reveal is cancelled when the body leaves before the timer fires', () => {
  const f=fixture(); f.document.fire('pointermove',{pointerType:'mouse',clientX:30,clientY:500});
  f.update({top:1000,bottom:2200}); f.expectHidden(); assert.equal(f.toc.dataset.state,'collapsed');
});

test('keyboard and touch entry share the boundary gate, including focus and Escape', () => {
  for (const detail of [0,1]) {
    const f=fixture({top:1000,bottom:2200,fine:detail===0});
    f.trigger.fire('click',{detail}); f.pin.fire('click'); f.expectHidden();
    f.update({top:400,bottom:1600}); f.trigger.fire('click',{detail}); assert.equal(f.visible(),true);
    f.update({top:200,bottom:1400}); assert.equal(f.visible(),true);
    if(detail===0) assert.equal(f.document.activeElement,f.close);
    f.toc.fire('keydown',{key:'Escape',preventDefault(){}}); f.expectHidden();
    f.trigger.fire('click',{detail}); f.update({top:-1100,bottom:100}); f.expectHidden(); assert.equal(f.document.activeElement,null);
  }
});

test('resize/hash/pageshow enforce bounds and keep long TOCs internally constrained', () => {
  const f=fixture({pinned:true});
  for(const event of ['resize','hashchange','pageshow']) {
    f.update({top:-1000,bottom:230},event); assert.equal(f.visible(),true); assert.equal(f.toc.attrs.get('--toc-height'),'150px');
    f.update({top:-1000,bottom:190},event); f.expectHidden();
    f.update({top:400,bottom:1600},event); assert.equal(f.visible(),true);
  }
  f.context.innerHeight=200; f.window.fire('resize'); f.tick(); f.expectHidden();
});
