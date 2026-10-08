// Coastal page transition: the old page floods during the navigation hold, then the new page
// continues from the saved water line and lets it drain. Section changes sweep sideways in
// navigation order; opening an article raises the tide from the bottom.

export type TideKind = 'sweep' | 'rise';
export type TideScene = { kind: TideKind; dir: 1 | -1; seed: number; front: number; clock: number; episode: string; gap: number };

export const TIDE_KEY = 'coastal-navigation-tide-v1';
/** Matches the navigation hold, so the water reaches mid-screen as the request leaves. */
export const DEPART_SECONDS = .34;
export const ARRIVE_SECONDS: Record<TideKind, number> = { sweep: 2, rise: 2.2 };
export const RETREAT_SECONDS = .42;
/** Fronts are viewport fractions: the crest's distance from the upwind edge, or the water level from the bottom. */
export const START_FRONT: Record<TideKind, number> = { sweep: -.1, rise: -.08 };
export const HOLD_FRONT: Record<TideKind, number> = { sweep: .52, rise: .6 };
/** Translucent body trailing a sweeping crest, as a share of the viewport width. */
export const SWEEP_TAIL = .62;
export const EXIT_FRONT: Record<TideKind, number> = { sweep: 1 + SWEEP_TAIL + .04, rise: -.1 };

const clamp = (value: number, low = 0, high = 1) => Math.max(low, Math.min(high, value));
const smooth = (value: number) => { const t = clamp(value); return t * t * (3 - 2 * t); };
const easeOut = (t: number) => 1 - (1 - t) ** 3;
const easeInOut = (t: number) => t < .5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;

export const isArticle = (path: string) => /^\/blog\/(?!series(?:\/|$))[^/]+\/?$/.test(path);
export const sectionOf = (path: string) => path.split('/').filter(Boolean)[0] ?? '';
export const tideKind = (to: string): TideKind => isArticle(to) ? 'rise' : 'sweep';

/** +1 sweeps left-to-right (toward a section further right in the navigation). */
export function sweepDirection(from: number, to: number, fromArticle: boolean, random = Math.random): 1 | -1 {
  if (from >= 0 && to >= 0 && from !== to) return to > from ? 1 : -1;
  // Leaving an article for its list reads as going back.
  if (fromArticle) return -1;
  return random() < .5 ? -1 : 1;
}

export function departFront(kind: TideKind, t: number, from = START_FRONT[kind]) {
  const hold = HOLD_FRONT[kind];
  if (t < DEPART_SECONDS) return from + (hold - from) * easeOut(clamp(t / DEPART_SECONDS));
  // A slow response keeps the water near mid-screen instead of finishing on the old page.
  return hold + .06 * (1 - Math.exp(-(t - DEPART_SECONDS) / 1.2));
}

export function arriveFront(kind: TideKind, from: number, t: number) {
  const u = clamp(t / ARRIVE_SECONDS[kind]);
  // The arriving tide swells once more before it drains, so the handoff never reads as a cut.
  const swell = kind === 'rise' ? .05 * Math.sin(Math.PI * Math.min(1, u / .45)) : 0;
  return from + (EXIT_FRONT[kind] - from) * easeInOut(u) + swell;
}

export const retreatFront = (kind: TideKind, from: number, t: number) =>
  from + (START_FRONT[kind] - from) * easeInOut(clamp(t / RETREAT_SECONDS));

export function parseTideScene(raw: string | null, href: string, now: number): TideScene | null {
  if (!raw || raw.length > 2000) return null;
  try {
    const saved = JSON.parse(raw), target = new URL(saved.target), current = new URL(href);
    target.searchParams.delete('visual-theme'); current.searchParams.delete('visual-theme');
    const gap = (now - saved.at) / 1000;
    if (target.origin !== current.origin || target.pathname.replace(/\/$/, '') !== current.pathname.replace(/\/$/, '') || target.search !== current.search) return null;
    if (!Number.isFinite(gap) || gap < 0 || gap > 10) return null;
    if ((saved.kind !== 'sweep' && saved.kind !== 'rise') || (saved.dir !== 1 && saved.dir !== -1)) return null;
    if (![saved.seed, saved.front, saved.clock].every(Number.isFinite) || saved.seed < 0 || saved.seed >= 1 || saved.front < -.2 || saved.front > 1 || saved.clock < 0 || saved.clock > 60) return null;
    if (typeof saved.episode !== 'string' || saved.episode.length > 80) return null;
    return { kind: saved.kind, dir: saved.dir, seed: saved.seed, front: saved.front, clock: saved.clock, episode: saved.episode, gap };
  } catch { return null; }
}

type Color = [number, number, number];
const SEA: Record<'light' | 'dark', { crest: Color; body: Color; deep: Color; foam: Color }> = {
  light: { crest: [124, 214, 230], body: [62, 168, 204], deep: [30, 110, 152], foam: [255, 255, 255] },
  dark: { crest: [80, 162, 192], body: [30, 98, 134], deep: [10, 50, 80], foam: [214, 240, 246] },
};
const rgba = ([r, g, b]: Color, a: number) => `rgba(${r}, ${g}, ${b}, ${Math.max(0, a).toFixed(3)})`;
const seeded = (value: number) => {
  let s = (Math.floor(value * 2 ** 32) >>> 0) || 1;
  return () => (s = Math.imul(s, 1664525) + 1013904223 >>> 0) / 2 ** 32;
};

type Foam = { u: number; back: number; r: number; a: number; wobble: number };
type Phase = 'idle' | 'depart' | 'arrive' | 'retreat';
export interface CoastalTide { setActive(active: boolean): void; resize(): void }

export function initCoastalTide(canvas: HTMLCanvasElement, { active }: { active: () => boolean }): CoastalTide | null {
  const root = document.documentElement;
  // The stylesheet paints the saved water line until the first Canvas frame takes over.
  const settle = () => { delete root.dataset.coastalArrival; root.style.removeProperty('--coastal-tide'); };
  const ctx = canvas.getContext('2d');
  if (!ctx) { settle(); return null; }
  let width = 0, height = 0, small = false, raf = 0, elapsed = 0, last = 0, leaving = false;
  let phase: Phase = 'idle', kind: TideKind = 'sweep', dir: 1 | -1 = 1, seed = 0;
  let front = 0, from = 0, clock = 0, episode = '', pending = '';
  let phases = [0, 0], foam: Foam[] = [];

  const pathOf = (href: string) => { try { return new URL(href, location.href).pathname; } catch { return '/'; } };
  const sectionIndex = (path: string) => [...document.querySelectorAll<HTMLAnchorElement>('.nav-link[href]')]
    .findIndex(link => sectionOf(pathOf(link.href)) === sectionOf(path));
  const setup = (nextKind: TideKind, nextDir: 1 | -1, nextSeed: number) => {
    kind = nextKind; dir = nextDir; seed = nextSeed;
    const random = seeded(seed);
    phases = [random() * Math.PI * 2, random() * Math.PI * 2];
    foam = Array.from({ length: small ? 16 : 30 }, () => ({ u: random(), back: random() ** 1.6, r: 1.2 + random() * 3.2, a: .45 + random() * .45, wobble: random() * Math.PI * 2 }));
    canvas.dataset.tide = kind;
    canvas.dataset.tideFrom = kind === 'rise' ? 'bottom' : dir > 0 ? 'left' : 'right';
  };
  const forget = () => { try { sessionStorage.removeItem(TIDE_KEY); } catch {} };
  const save = (target: string) => {
    try {
      sessionStorage.setItem(TIDE_KEY, JSON.stringify({ target, at: Date.now(), kind, dir, seed, front: clamp(front, -.2, 1), clock, episode }));
      return true;
    } catch { forget(); return false; }
  };

  // `back` and `turn` trace the fainter swells inside the water body behind the crest.
  const sweepCrest = (y: number, back = 0, turn = 0) => {
    const base = (dir > 0 ? front * width : width - front * width) - dir * back;
    const bow = width * .035, a1 = Math.min(26, width * .035), a2 = Math.min(10, width * .015);
    return base + dir * (bow * Math.sin(Math.PI * clamp(y / height)) + a1 * Math.sin(y / 130 + phases[0] + turn + clock * 1.6) + a2 * Math.sin(y / 47 + phases[1] - turn - clock * 2.7));
  };
  const riseCrest = (x: number, back = 0, turn = 0) => {
    const a1 = Math.min(16, height * .02), a2 = Math.min(7, height * .009);
    return height - front * height + back + a1 * Math.sin(x / 150 + phases[0] + turn + clock * 1.8) + a2 * Math.sin(x / 53 + phases[1] - turn - clock * 3.1);
  };
  const swells = [[70, 1.9, .24], [150, 3.4, .14]];
  const foamLine = (line: number[], dx: number, dy: number, lineWidth: number, color: string) => {
    ctx.beginPath(); ctx.moveTo(line[0] + dx, line[1] + dy);
    for (let i = 2; i < line.length; i += 2) ctx.lineTo(line[i] + dx, line[i + 1] + dy);
    ctx.strokeStyle = color; ctx.lineWidth = lineWidth; ctx.stroke();
  };
  const paint = (fade: number) => {
    ctx.clearRect(0, 0, width, height);
    const c = root.classList.contains('dark') ? SEA.dark : SEA.light;
    const line: number[] = [];
    if (kind === 'sweep') {
      const steps = Math.round(clamp(height / 24, 16, 48));
      for (let i = 0; i <= steps; i++) { const y = -20 + (height + 40) * i / steps; line.push(sweepCrest(y), y); }
      const base = dir > 0 ? front * width : width - front * width, tail = base - dir * SWEEP_TAIL * width;
      ctx.beginPath(); ctx.moveTo(tail, -20);
      for (let i = 0; i < line.length; i += 2) ctx.lineTo(line[i], line[i + 1]);
      ctx.lineTo(tail, height + 20); ctx.closePath();
      const fill = ctx.createLinearGradient(base, 0, tail, 0);
      fill.addColorStop(0, rgba(c.crest, .62 * fade)); fill.addColorStop(.32, rgba(c.body, .5 * fade)); fill.addColorStop(1, rgba(c.deep, 0));
      ctx.fillStyle = fill; ctx.fill();
      for (const [back, turn, alpha] of swells) {
        const swell: number[] = [];
        for (let i = 0; i < line.length; i += 2) swell.push(sweepCrest(line[i + 1], back, turn), line[i + 1]);
        foamLine(swell, 0, 0, 1.6, rgba(c.foam, alpha * fade));
      }
      foamLine(line, 0, 0, 5, rgba(c.foam, .9 * fade)); foamLine(line, -dir * 18, 0, 2, rgba(c.foam, .42 * fade));
      for (const d of foam) {
        const y = d.u * height, x = sweepCrest(y) - dir * (6 + d.back * 72) + Math.sin(clock * 3 + d.wobble) * 3;
        ctx.beginPath(); ctx.arc(x, y, d.r, 0, Math.PI * 2); ctx.fillStyle = rgba(c.foam, d.a * fade); ctx.fill();
      }
    } else {
      const steps = Math.round(clamp(width / 30, 16, 60)), level = height - front * height;
      for (let i = 0; i <= steps; i++) { const x = -20 + (width + 40) * i / steps; line.push(x, riseCrest(x)); }
      ctx.beginPath(); ctx.moveTo(-20, height + 20);
      for (let i = 0; i < line.length; i += 2) ctx.lineTo(line[i], line[i + 1]);
      ctx.lineTo(width + 20, height + 20); ctx.closePath();
      const fill = ctx.createLinearGradient(0, level - 16, 0, Math.max(level, height));
      fill.addColorStop(0, rgba(c.crest, .6 * fade)); fill.addColorStop(.2, rgba(c.body, .52 * fade)); fill.addColorStop(1, rgba(c.deep, .66 * fade));
      ctx.fillStyle = fill; ctx.fill();
      for (const [back, turn, alpha] of swells) {
        const swell: number[] = [];
        for (let i = 0; i < line.length; i += 2) swell.push(line[i], riseCrest(line[i], back, turn));
        foamLine(swell, 0, 0, 1.6, rgba(c.foam, alpha * fade));
      }
      foamLine(line, 0, 0, 5, rgba(c.foam, .9 * fade)); foamLine(line, 0, 16, 2, rgba(c.foam, .42 * fade));
      for (const d of foam) {
        const x = d.u * width, y = riseCrest(x) + 6 + d.back * 62 + Math.sin(clock * 3 + d.wobble) * 3;
        ctx.beginPath(); ctx.arc(x, y, d.r, 0, Math.PI * 2); ctx.fillStyle = rgba(c.foam, d.a * fade); ctx.fill();
      }
    }
  };
  const stop = () => {
    cancelAnimationFrame(raf); raf = 0; phase = 'idle';
    canvas.dataset.tidePhase = 'idle'; ctx.clearRect(0, 0, width, height); canvas.hidden = true;
    settle();
  };
  const frame = (now: number) => {
    raf = 0;
    if (!active()) { stop(); return; }
    if (leaving || document.hidden) return;
    // Advance visible frames only. A delayed first callback or hidden tab must
    // not consume the arrival before the user has seen it.
    const delta = Math.min(.05, Math.max(0, now - last) / 1000);
    const t = elapsed += delta;
    clock += delta; last = now;
    let fade = 1;
    if (phase === 'depart') front = departFront(kind, t, from);
    else if (phase === 'arrive') {
      const u = t / ARRIVE_SECONDS[kind];
      if (u >= 1) { stop(); return; }
      front = arriveFront(kind, from, t); fade = 1 - smooth((u - .72) / .28);
    } else if (phase === 'retreat') {
      if (t >= RETREAT_SECONDS) { stop(); return; }
      front = retreatFront(kind, from, t); fade = 1 - .5 * smooth(t / RETREAT_SECONDS);
    } else return;
    paint(fade); settle();
    raf = requestAnimationFrame(frame);
  };
  const begin = (next: Phase, at: number) => {
    phase = next; from = front = at; elapsed = 0; last = performance.now();
    canvas.dataset.tidePhase = next; canvas.hidden = false;
    // Reproduce the outgoing frame before removing the first-paint fallback.
    paint(1); settle();
    if (!raf && !document.hidden) raf = requestAnimationFrame(frame);
  };
  const resize = () => {
    width = innerWidth; height = innerHeight; small = width <= 640;
    // Large translucent fills are fill-rate bound, so the backing store stays modest.
    const dpr = Math.min(devicePixelRatio || 1, small ? 1 : 1.25, Math.sqrt(2_400_000 / (width * height)));
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  };

  window.addEventListener('coastal-navigation-start', event => {
    const request = (event as CustomEvent<{ href: string; accepted: boolean }>).detail;
    if (!active()) return;
    // A repeated choice during the hold keeps the wave already on its way.
    if (phase !== 'depart') {
      const here = location.pathname, to = pathOf(request.href), nextKind = tideKind(to);
      const nextDir = nextKind === 'rise' ? 1 : sweepDirection(sectionIndex(here), sectionIndex(to), isArticle(here));
      // Clicking again while the last tide drains turns the same water around instead of restarting it.
      const reuse = phase !== 'idle' && nextKind === kind && nextDir === dir && front <= HOLD_FRONT[kind];
      if (!reuse) { setup(nextKind, nextDir, Math.random()); clock = 0; episode = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`; }
      begin('depart', reuse ? front : START_FRONT[nextKind]);
    }
    pending = request.href;
    request.accepted = save(pending);
    if (!request.accepted) { pending = ''; stop(); }
  });
  window.addEventListener('coastal-navigation-handoff', event => {
    pending = (event as CustomEvent<string>).detail;
    save(pending);
  });
  window.addEventListener('coastal-navigation-abandon', event => {
    if (pending !== (event as CustomEvent<string>).detail) return;
    pending = ''; forget();
    if (phase === 'depart') begin('retreat', front);
  });
  window.addEventListener('coastal-navigation-cancel', () => {
    pending = ''; forget();
    if (phase === 'depart') begin('retreat', front);
  });
  // The last live frame stays painted for the outgoing document; history restore starts dry.
  window.addEventListener('pagehide', () => {
    leaving = true;
    if (pending) save(pending);
    cancelAnimationFrame(raf); raf = 0;
  });
  window.addEventListener('pageshow', event => {
    if (!event.persisted) return;
    leaving = false; pending = ''; forget(); stop();
  });

  resize();
  let scene: TideScene | null = null;
  try { scene = parseTideScene(sessionStorage.getItem(TIDE_KEY), location.href, Date.now()); } catch {}
  forget();
  if (scene && active()) {
    setup(scene.kind, scene.dir, scene.seed); clock = scene.clock; episode = scene.episode;
    canvas.dataset.tideSource = 'continued';
    begin('arrive', scene.front);
  } else settle();
  root.dataset.coastalReady = 'true';

  return {
    setActive(next) {
      if (leaving) return; // Preserve the outgoing frame and saved scene.
      if (!active()) { stop(); return; }
      if (!next) { cancelAnimationFrame(raf); raf = 0; return; }
      if (!raf && phase !== 'idle') { last = performance.now(); raf = requestAnimationFrame(frame); }
    },
    resize,
  };
}
