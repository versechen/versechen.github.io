/**
 * 海蓝诗境的海边动效：头图天空里滑翔的海鸥、海面上闪烁的波光，以及页面底部缓缓升起的气泡。
 * 海鸥和波光只落在每幅插画真实的天空 / 海面上：区域以图片归一化坐标描述，
 * 再按 object-fit: cover 与 object-position 换算到屏幕。
 */

/** [x0, y0, x1, y1]，相对插画原图的 0–1 坐标。 */
export type Zone = readonly [number, number, number, number];
export interface Rect { left: number; top: number; width: number; height: number }
interface SceneZones { sea: readonly Zone[]; sky: readonly Zone[] }

export const SCENE_ZONES: Readonly<Record<string, SceneZones>> = {
  home: { sea: [[0, .38, .76, .98], [.76, .6, 1, .98]], sky: [[.02, .03, .98, .24]] },
  'home-portrait': { sea: [[.02, .39, .52, .74]], sky: [[.02, .03, .45, .21]] },
  writing: { sea: [[.12, .37, .5, .58]], sky: [[.08, .04, .66, .26]] },
  journal: { sea: [[.53, .3, .7, .47], [.62, .47, .75, .56], [.38, .29, .53, .33]], sky: [[.46, .14, .64, .26], [.66, .03, .8, .1]] },
  harbor: { sea: [[.55, .55, .85, .86], [.46, .64, .56, .8]], sky: [[.5, .02, .98, .13]] },
  bookshop: { sea: [[.74, .47, .98, .62], [.62, .47, .74, .52]], sky: [[.67, .07, .9, .2]] },
  studio: { sea: [[.64, .25, .82, .32], [.72, .32, .79, .57]], sky: [[.64, .02, .9, .18]] },
  garden: { sea: [[.33, .19, .6, .36], [.41, .38, .52, .62], [.55, .55, .75, .62]], sky: [[.42, .01, .6, .1]] },
  cafe: { sea: [[.7, .36, .98, .5], [.75, .5, .88, .58]], sky: [[.55, .02, .75, .16]] },
  atlas: { sea: [[.25, .25, .42, .4], [.32, .35, .58, .47], [.6, .47, .76, .55]], sky: [[.52, .01, .72, .07], [.3, .13, .55, .19]] },
};

const KEYWORDS: Readonly<Record<string, number>> = { left: 0, top: 0, center: .5, right: 1, bottom: 1 };

/** 解析计算后的 object-position（如 "60% 50%"、"center 53%"），返回 0–1 的对齐比例。 */
export const parseObjectPosition = (value: string): [number, number] => {
  let [x = 'center', y = 'center'] = value.trim().split(/\s+/);
  if (x === 'top' || x === 'bottom' || y === 'left' || y === 'right') [x, y] = [y, x];
  const read = (part: string) => part in KEYWORDS ? KEYWORDS[part] : part.endsWith('%') ? Number.parseFloat(part) / 100 : .5;
  return [read(x), read(y)];
};

/** object-fit: cover 时插画实际铺开的矩形（可能超出 box，被裁掉的部分不可见）。 */
export const coverRect = (box: Rect, naturalWidth: number, naturalHeight: number, [px, py]: readonly [number, number]): Rect => {
  const scale = Math.max(box.width / naturalWidth, box.height / naturalHeight);
  const width = naturalWidth * scale, height = naturalHeight * scale;
  return { left: box.left + (box.width - width) * px, top: box.top + (box.height - height) * py, width, height };
};

export const intersect = (a: Rect, b: Rect): Rect | null => {
  const left = Math.max(a.left, b.left), top = Math.max(a.top, b.top);
  const right = Math.min(a.left + a.width, b.left + b.width), bottom = Math.min(a.top + a.height, b.top + b.height);
  return right > left && bottom > top ? { left, top, width: right - left, height: bottom - top } : null;
};

/** 把归一化区域投到屏幕，并裁到可见的插画框内；过窄的碎片直接丢弃。 */
export const projectZones = (zones: readonly Zone[], painted: Rect, clip: Rect): Rect[] => zones.flatMap(([x0, y0, x1, y1]) => {
  const rect = intersect({ left: painted.left + x0 * painted.width, top: painted.top + y0 * painted.height, width: (x1 - x0) * painted.width, height: (y1 - y0) * painted.height }, clip);
  return rect && rect.width >= 12 && rect.height >= 8 ? [rect] : [];
});

const inside = (x: number, y: number, r: Rect) => x >= r.left && x <= r.left + r.width && y >= r.top && y <= r.top + r.height;
const distance = (x: number, y: number, r: Rect) => Math.hypot(Math.max(r.left - x, 0, x - r.left - r.width), Math.max(r.top - y, 0, y - r.top - r.height));

/**
 * 海鸥的航线：画里露出天空就在天空飞；矮头图把天空裁掉时，改为贴着最大一片海面的上半部掠过。
 * 航线都压在固定站头下方（top 之下），免得与导航文字叠在一起。
 */
export const flightLanes = (sky: readonly Rect[], sea: readonly Rect[], top: number): Rect[] => {
  const below = (r: Rect) => intersect(r, { left: r.left, top, width: r.width, height: Infinity });
  const open = sky.flatMap(r => { const lane = below(r); return lane && lane.height >= 18 && lane.width >= 60 ? [lane] : []; });
  if (open.length) return open;
  const water = sea.flatMap(r => below(r) ?? []).sort((a, b) => b.width * b.height - a.width * a.height)[0];
  return water && water.width >= 60 && water.height >= 36 ? [{ ...water, height: water.height * .45 }] : [];
};

/** 按面积加权在区域里取一点，避开文字；多次落在文字上就放弃，宁缺勿扰。 */
export const pickPoint = (rects: readonly Rect[], avoid: readonly Rect[], random: () => number = Math.random): { x: number; y: number } | null => {
  const total = rects.reduce((sum, r) => sum + r.width * r.height, 0);
  if (!total) return null;
  for (let attempt = 0; attempt < 6; attempt++) {
    let roll = random() * total, rect = rects[rects.length - 1];
    for (const r of rects) { roll -= r.width * r.height; if (roll <= 0) { rect = r; break; } }
    const x = rect.left + random() * rect.width, y = rect.top + random() * rect.height;
    if (!avoid.some(r => inside(x, y, r))) return { x, y };
  }
  return null;
};

interface Gull { zone: number; u: number; v: number; dir: 1 | -1; speed: number; span: number; seed: number; wait: number }
interface Glint { u: number; v: number; age: number; life: number; size: number; star: boolean }
interface Bubble { x: number; y: number; r: number; speed: number; sway: number; seed: number; age: number; life: number; wait: number }

export interface CoastalSea { setActive(active: boolean): void; resize(): void; destroy(): void }

const TEXT = 'h1, h2, h3, p, a, button, time, input, label, span, small, li';
const WAVE_BAND = 72;
const smooth = (value: number) => { const t = Math.max(0, Math.min(1, value)); return t * t * (3 - 2 * t); };
const between = (min: number, max: number) => min + Math.random() * (max - min);

const sprite = (width: number, height: number, paint: (ctx: CanvasRenderingContext2D) => void) => {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (ctx) paint(ctx);
  return canvas;
};

export function initCoastalSea(canvas: HTMLCanvasElement, { ambient }: { ambient: boolean }): CoastalSea | null {
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const root = document.documentElement;
  const scene = document.querySelector<HTMLElement>('.coastal-scene');
  const image = scene?.querySelector('img') ?? null;
  const hero = scene?.parentElement?.closest<HTMLElement>('section, header, .page-hero') ?? scene?.parentElement ?? null;
  const siteHeader = document.querySelector<HTMLElement>('#site-header');

  // 波光：横向的碎光为主，偶尔一颗四角星；气泡：带高光的透明小圈。
  const dash = sprite(64, 16, c => {
    const g = c.createRadialGradient(32, 8, 0, 32, 8, 32);
    g.addColorStop(0, 'rgba(255,252,238,1)'); g.addColorStop(.35, 'rgba(255,246,214,.7)'); g.addColorStop(1, 'rgba(255,246,214,0)');
    c.setTransform(1, 0, 0, .25, 0, 6); c.fillStyle = g; c.fillRect(0, -24, 64, 64);
  });
  const star = sprite(48, 48, c => {
    const g = c.createRadialGradient(24, 24, 0, 24, 24, 16);
    g.addColorStop(0, 'rgba(255,250,232,.9)'); g.addColorStop(1, 'rgba(255,250,232,0)');
    c.fillStyle = g; c.fillRect(0, 0, 48, 48);
    c.fillStyle = 'rgba(255,255,248,.95)';
    for (const [w, h] of [[22, 1.6], [1.6, 22]]) { c.beginPath(); c.ellipse(24, 24, w, h, 0, 0, Math.PI * 2); c.fill(); }
  });
  const bubble = sprite(48, 48, c => {
    const g = c.createRadialGradient(20, 18, 2, 24, 24, 21);
    g.addColorStop(0, 'rgba(225,250,252,.28)'); g.addColorStop(.8, 'rgba(150,222,236,.1)'); g.addColorStop(1, 'rgba(150,222,236,0)');
    c.fillStyle = g; c.beginPath(); c.arc(24, 24, 21, 0, Math.PI * 2); c.fill();
    c.strokeStyle = 'rgba(96,186,210,.78)'; c.lineWidth = 2.2; c.beginPath(); c.arc(24, 24, 20, 0, Math.PI * 2); c.stroke();
    c.strokeStyle = 'rgba(255,255,255,.95)'; c.lineWidth = 2.6; c.lineCap = 'round'; c.beginPath(); c.arc(24, 24, 14, Math.PI * 1.08, Math.PI * 1.42); c.stroke();
  });

  let width = 0, height = 0, small = false, active = false, parked = false, raf = 0, previous = 0, measuredAt = -Infinity, glintClock = 0, lid = 0;
  // 以下矩形都是文档坐标（top 已加 scrollY），逐帧只需减去当前滚动量。
  let painted: Rect | null = null, sceneBox: Rect | null = null, sky: Rect[] = [], sea: Rect[] = [], avoid: Rect[] = [];
  let drawn = { gulls: 0, glints: 0, bubbles: 0 };
  const gulls: Gull[] = [], glints: Glint[] = [], bubbles: Bubble[] = [];

  const page = (r: DOMRect, pad = 0): Rect => ({ left: r.left - pad, top: r.top + scrollY - pad, width: r.width + pad * 2, height: r.height + pad * 2 });
  const measure = (time: number) => {
    measuredAt = time;
    // 固定站头盖在画布之下的层级里，这一条带不画任何东西。
    lid = Math.max(0, siteHeader?.getBoundingClientRect().bottom ?? 0);
    painted = sceneBox = null; sky = []; sea = []; avoid = [];
    Object.assign(canvas.dataset, { gulls: String(drawn.gulls), glints: String(drawn.glints), bubbles: String(drawn.bubbles) });
    if (!scene || !image || !hero || !image.naturalWidth || !image.naturalHeight) return;
    const box = scene.getBoundingClientRect();
    if (!box.width || !box.height) return;
    const zones = SCENE_ZONES[/portrait/.test(image.currentSrc) ? 'home-portrait' : scene.dataset.scene ?? ''];
    if (!zones) return;
    sceneBox = page(box);
    painted = coverRect(page(image.getBoundingClientRect()), image.naturalWidth, image.naturalHeight, parseObjectPosition(getComputedStyle(image).objectPosition));
    // 头图底部是页面底色的浪花遮罩，波光停在浪花之上。
    sea = projectZones(zones.sea, painted, { ...sceneBox, height: sceneBox.height - WAVE_BAND });
    sky = flightLanes(projectZones(zones.sky, painted, sceneBox), sea, lid + 6);
    avoid = Array.from(hero.querySelectorAll<HTMLElement>(TEXT), el => el.getBoundingClientRect())
      .filter(r => r.width && r.height).map(r => page(r, 10));
  };
  const heroInView = () => !!sceneBox && sceneBox.top - scrollY < height && sceneBox.top + sceneBox.height - scrollY > 0;
  const needed = () => ambient || heroInView();

  const launch = (gull: Gull, first = false) => {
    gull.zone = 0;
    let roll = Math.random() * sky.reduce((sum, r) => sum + r.width, 0);
    for (let i = 0; i < sky.length; i++) { roll -= sky[i].width; if (roll <= 0) { gull.zone = i; break; } }
    const rect = sky[gull.zone];
    gull.dir = Math.random() < .5 ? 1 : -1;
    gull.u = first ? between(.15, .65) : gull.dir > 0 ? 0 : 1;
    gull.v = between(.2, .8);
    gull.span = (small ? between(9, 13) : between(12, 20)) * (.75 + gull.v * .4);
    gull.speed = Math.min(34, Math.max(10, (rect?.width ?? 300) / between(9, 16)));
    gull.seed = Math.random() * 100;
    gull.wait = 0;
  };
  const drawGull = (x: number, y: number, gull: Gull, t: number, alpha: number) => {
    const beat = smooth((Math.sin(t * .9 + gull.seed) - .25) / .45);
    const wing = .35 * (1 - beat) + Math.sin(t * 8.5 + gull.seed) * beat;
    const s = gull.span / 2, lift = s * .5, tip = -s * .36 * wing;
    ctx.save();
    ctx.translate(x, y); ctx.rotate(Math.sin(t * .6 + gull.seed) * .07 * gull.dir);
    ctx.beginPath(); ctx.moveTo(-s, tip); ctx.quadraticCurveTo(-s * .45, -lift, 0, 0); ctx.quadraticCurveTo(s * .45, -lift, s, tip);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.globalAlpha = alpha * .4; ctx.strokeStyle = '#123448'; ctx.lineWidth = Math.max(2.2, gull.span * .2); ctx.stroke();
    ctx.globalAlpha = alpha * .95; ctx.strokeStyle = '#fbfdff'; ctx.lineWidth = Math.max(1.3, gull.span * .11); ctx.stroke();
    ctx.restore();
  };
  const flyGulls = (dt: number, t: number) => {
    const cap = sky.length ? (small ? 2 : 3) : 0;
    while (gulls.length < cap) {
      const gull: Gull = { zone: 0, u: 0, v: 0, dir: 1, speed: 0, span: 0, seed: 0, wait: 0 };
      launch(gull, gulls.length === 0);
      if (gulls.length) gull.wait = between(1.5, 7) * gulls.length;
      gulls.push(gull);
    }
    gulls.length = Math.min(gulls.length, cap);
    for (const gull of gulls) {
      if (gull.wait > 0) { gull.wait -= dt; if (gull.wait <= 0) launch(gull); continue; }
      const rect = sky[gull.zone];
      if (!rect) { launch(gull); continue; }
      gull.u += gull.dir * gull.speed * dt / rect.width;
      if (gull.u < 0 || gull.u > 1) { gull.wait = between(2.5, 8); continue; }
      const x = rect.left + gull.u * rect.width;
      const y = rect.top + rect.height * Math.min(1, Math.max(0, gull.v + Math.sin(t * .5 + gull.seed) * .12));
      // 飞到文字附近就淡去，像从标题背后穿过。
      const clear = avoid.reduce((least, r) => Math.min(least, smooth(distance(x, y, r) / 28)), 1);
      const alpha = smooth(Math.min(gull.u, 1 - gull.u) * rect.width / 40) * clear;
      if (alpha < .02) continue;
      drawGull(x, y - scrollY, gull, t, alpha);
      drawn.gulls++;
    }
  };

  const sparkle = (dt: number) => {
    if (!painted || !sea.length) { glints.length = 0; return; }
    const view: Rect = { left: 0, top: scrollY + lid, width, height: height - lid };
    const visible = sea.flatMap(r => intersect(r, view) ?? []);
    const area = visible.reduce((sum, r) => sum + r.width * r.height, 0);
    glintClock += dt * Math.min(small ? 4 : 9, area / 14000);
    while (glintClock >= 1) {
      glintClock -= 1;
      if (glints.length >= (small ? 8 : 16)) continue;
      const point = pickPoint(visible, avoid);
      if (!point) continue;
      const isStar = Math.random() < .25;
      glints.push({ u: (point.x - painted.left) / painted.width, v: (point.y - painted.top) / painted.height, age: 0, life: between(.7, 1.6), size: isStar ? between(6, 10) : between(8, 18), star: isStar });
    }
    glints.length = Math.min(glints.length, small ? 8 : 16);
    const dim = root.classList.contains('dark') ? .78 : 1;
    for (let i = glints.length - 1; i >= 0; i--) {
      const glint = glints[i];
      glint.age += dt;
      if (glint.age >= glint.life) { glints.splice(i, 1); continue; }
      const pulse = Math.sin(Math.PI * glint.age / glint.life);
      const x = painted.left + glint.u * painted.width, y = painted.top - scrollY + glint.v * painted.height;
      const size = glint.size * (.55 + .45 * pulse);
      ctx.globalAlpha = pulse * pulse * .92 * dim;
      if (glint.star) ctx.drawImage(star, x - size, y - size, size * 2, size * 2);
      else ctx.drawImage(dash, x - size, y - size / 4, size * 2, size / 2);
      drawn.glints++;
    }
    ctx.globalAlpha = 1;
  };

  const rise = (b: Bubble, initial = false) => {
    b.r = small ? between(2.5, 5) : between(3, 7);
    b.x = between(.04, .96) * width;
    b.speed = between(16, 36);
    b.life = height * between(.32, .62) / b.speed;
    b.y = height + b.r;
    b.sway = between(.6, 1.3); b.seed = Math.random() * 100;
    b.age = initial ? Math.random() * b.life * .7 : 0;
    b.y -= b.speed * b.age;
    b.wait = initial ? 0 : between(.5, 4.5);
  };
  const bubbleUp = (dt: number) => {
    const cap = small ? 5 : 9;
    bubbles.length = Math.min(bubbles.length, cap);
    while (bubbles.length < cap) {
      const b: Bubble = { x: 0, y: 0, r: 0, speed: 0, sway: 0, seed: 0, age: 0, life: 1, wait: 0 };
      rise(b, true); bubbles.push(b);
    }
    for (const b of bubbles) {
      if (b.wait > 0) { b.wait -= dt; continue; }
      b.age += dt; b.y -= b.speed * dt;
      const p = b.age / b.life;
      if (p >= 1) { rise(b); continue; }
      ctx.globalAlpha = smooth(p / .12) * (1 - smooth((p - .55) / .45)) * .78;
      const x = b.x + Math.sin(b.age * b.sway + b.seed) * 7;
      ctx.drawImage(bubble, x - b.r, b.y - b.r, b.r * 2, b.r * 2);
      drawn.bubbles++;
    }
    ctx.globalAlpha = 1;
  };

  const frame = (time: number) => {
    raf = 0;
    if (!active) return;
    if (small && time - previous < 1000 / 30 - 3) { raf = requestAnimationFrame(frame); return; }
    const dt = Math.min(Math.max(time - previous, 0) / 1000, .05);
    previous = time;
    if (time - measuredAt > 1000) measure(time);
    ctx.clearRect(0, 0, width, height);
    if (!needed()) { park(); return; }
    drawn = { gulls: 0, glints: 0, bubbles: 0 };
    const t = time / 1000;
    ctx.save();
    ctx.beginPath(); ctx.rect(0, lid, width, height - lid); ctx.clip();
    if (heroInView()) { sparkle(dt); flyGulls(dt, t); }
    if (ambient) bubbleUp(dt);
    ctx.restore();
    raf = requestAnimationFrame(frame);
  };
  const run = () => {
    parked = false; canvas.hidden = false;
    if (!raf) { previous = performance.now(); raf = requestAnimationFrame(frame); }
  };
  const park = () => { parked = true; canvas.hidden = true; ctx.clearRect(0, 0, width, height); };
  const onScroll = () => { if (active && parked && heroInView()) run(); };
  const onImage = () => measure(performance.now());

  const resize = () => {
    width = innerWidth; height = innerHeight; small = width <= 640;
    const dpr = Math.min(devicePixelRatio || 1, small ? 1.25 : 1.5);
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    measure(performance.now());
  };
  const setActive = (next: boolean) => {
    active = next;
    if (active) {
      measure(performance.now());
      if (needed()) run(); else park();
      return;
    }
    cancelAnimationFrame(raf); raf = 0; parked = false;
    canvas.hidden = true; ctx.clearRect(0, 0, width, height);
  };

  addEventListener('scroll', onScroll, { passive: true });
  image?.addEventListener('load', onImage);
  resize();
  return {
    setActive,
    resize,
    destroy() {
      setActive(false);
      removeEventListener('scroll', onScroll);
      image?.removeEventListener('load', onImage);
    },
  };
}
