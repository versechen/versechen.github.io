/** A single, bounded Canvas loop shared by all Sakura pages. Native navigation owns history. */
export function initSakura() {
  const canvas = document.querySelector<HTMLCanvasElement>('#sakura-petals');
  const tools = document.querySelector<HTMLElement>('#sakura-tools');
  const toggle = document.querySelector<HTMLButtonElement>('#sakura-effects-toggle');
  const gustButton = document.querySelector<HTMLButtonElement>('#sakura-gust');
  const ctx = canvas?.getContext('2d');
  if (!canvas || !ctx || !tools || !toggle || !gustButton) return;
  const root = document.documentElement;
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const coarse = matchMedia('(pointer: coarse)');
  const quiet = !!document.querySelector('#notes-app, .docs-shell, .editor-demo');
  const hero = document.querySelector<HTMLElement>('.hero-wrap, .page-hero, .post-header, .blog-head, .projects-hero');
  const article = document.querySelector<HTMLElement>('.article-main');
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  let enabled = true;
  const readPreference = () => { try { enabled = localStorage.getItem('sakura-effects') !== 'off'; } catch {} };
  readPreference();
  let width = 0, height = 0, small = false, dark = false, departed = false;
  let raf = 0, scrollFrame = 0, previous = 0, elapsed = 0, gust = 0, lastGust = -5000;
  let pointerWind = 0, lastPointer = 0, previousX = 0;
  let heroBottom = 0, articleTop = Infinity, articleBottom = -Infinity, releaseAge = -1;
  let safeLeft = 0, safeRight = 0;
  type Petal = { x: number; y: number; depth: number; size: number; phase: number; turn: number; speed: number; sprite: number; age: number; lifetime: number };
  let petals: Petal[] = [];
  let temporary: Petal[] = [];
  let pendingTarget = '', capturedOnHide = false, episode = '';
  const handoffKey = 'sakura-navigation-scene-v1';
  const smooth = (value: number) => { const t = Math.max(0, Math.min(1, value)); return t * t * (3 - 2 * t); };
  // Cache three shaded, notched petals. No gradients / paths / DOM allocations per frame.
  const sprites = ['#ffe8ee', '#f9dae3', '#fff4f6'].map(color => {
    const tile = document.createElement('canvas'); tile.width = tile.height = 64;
    const c = tile.getContext('2d')!;
    const fill = c.createLinearGradient(12, 10, 48, 54);
    fill.addColorStop(0, '#fff5f9'); fill.addColorStop(.48, color); fill.addColorStop(1, '#efbacb');
    c.fillStyle = fill;
    c.beginPath(); c.moveTo(32, 58); c.bezierCurveTo(4, 40, 6, 3, 27, 8);
    c.lineTo(32, 15); c.lineTo(37, 8); c.bezierCurveTo(59, 4, 59, 39, 32, 58); c.fill();
    c.strokeStyle = '#fff4f9aa'; c.lineWidth = 1.3;
    c.beginPath(); c.moveTo(32, 53); c.quadraticCurveTo(25, 34, 31, 21); c.stroke();
    return tile;
  });
  const makePetal = (scatter = true): Petal => {
    const depth = Math.random();
    return { x: Math.random() * width, y: scatter ? Math.random() * height : -28,
      depth, size: 8 + depth * 10, phase: Math.random() * Math.PI * 2,
      turn: Math.random() * Math.PI * 2, speed: 15 + depth * 23, sprite: Math.floor(Math.random() * 3), age: 0, lifetime: 0 };
  };
  const allowed = () => !quiet && root.dataset.visualTheme !== 'poetize' && enabled && !motion.matches;
  const narrowReading = () => !!article && articleTop < height && articleBottom > 80 && width - safeRight < 138;
  // Hiding the controls to protect text must also stop the motion they control.
  const visibleArea = () => !narrowReading() && (!small || heroBottom > 80 || (!article && scrollY < 180));
  const active = () => allowed() && !departed && !document.hidden && visibleArea();
  const measure = () => {
    heroBottom = hero?.getBoundingClientRect().bottom ?? 0;
    const box = article?.getBoundingClientRect();
    articleTop = box ? box.top - 24 : Infinity; articleBottom = box ? box.bottom + 24 : -Infinity;
    // All central reading / interaction surfaces stay clear, including open TOC panels.
    safeLeft = box ? Math.max(0, box.left - 275) : width * .15;
    safeRight = box ? Math.min(width, box.right + 28) : width * .85;
  };
  const resize = () => {
    const oldWidth = width, oldHeight = height;
    width = innerWidth; height = innerHeight;
    small = width < 768 || coarse.matches;
    // Also cap total backing pixels on ultrawide / 4K displays (about 12MB).
    const dpr = Math.min(devicePixelRatio || 1, small ? 1.25 : 1.5, Math.sqrt(3_000_000 / (width * height)));
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const count = connection?.saveData ? 4 : small ? 6 : 14;
    petals = Array.from({ length: count }, () => makePetal());
    temporary = temporary.slice(0, connection?.saveData ? 4 : small ? 6 : 12);
    if (oldWidth && oldHeight) for (const p of temporary) { p.x *= width / oldWidth; p.y *= height / oldHeight; }
    measure();
  };
  const paint = (step: number, lifetimeStep: number) => {
    ctx.clearRect(0, 0, width, height);
    // A small shared bend makes the onset read as one gust, before independent flutter resumes.
    const windResponse = releaseAge < 0 ? 0 : releaseAge < .22 ? smooth(releaseAge / .22) : 1 - smooth((releaseAge - .28) / 1.1);
    const windShift = windResponse * 24, windLift = windResponse * 6, windTilt = windResponse * .18;
    const arrivalWind = releaseAge >= 0 && releaseAge < 1.5 ? Math.sin(Math.PI * releaseAge / 1.5) ** 2 * .6 : 0;
    const wind = 12 + Math.sin(elapsed * .36) * 15 + Math.sin(elapsed * .81) * 8 + gust * 170 + arrivalWind * 85 + pointerWind;
    let visibleBase = 0, visibleExtra = 0;
    for (let index = 0; index < petals.length + temporary.length; index++) {
      const p = index < petals.length ? petals[index] : temporary[index - petals.length];
      const extra = p.lifetime > 0;
      if (extra) { p.age += lifetimeStep; if (p.age < 0 || p.age >= p.lifetime) continue; }
      p.phase += step * (1 + p.depth); p.turn += step * (.45 + p.depth + gust * 1.2);
      p.x += step * (wind * (.35 + p.depth) + Math.sin(p.phase) * 19);
      p.y += step * (p.speed + Math.cos(p.phase * .8) * 9 - gust * (12 + p.depth * 34));
      if (!extra) {
        if (p.y > height + 35) { p.y = -30; p.x = Math.random() * width; }
        if (p.y < -60) p.y = height + 28;
        if (p.x > width + 35) p.x = -30;
        if (p.x < -35) p.x = width + 30;
      }
      const responseDepth = .9 + p.depth * .2;
      const x = p.x + windShift * responseDepth, y = p.y - windLift * responseDepth;
      // Fade smoothly at the text boundary; never paint over article text or mobile body.
      const inArticle = y > articleTop && y < articleBottom;
      const inHero = y < heroBottom;
      const left = inArticle ? safeLeft : width * (inHero ? .24 : .15);
      const right = inArticle ? safeRight : width * (inHero ? .76 : .85);
      const edge = Math.max(0, Math.min(1, Math.max(left - x, x - right) / 55));
      const lifespan = extra ? smooth(p.age / .25) * (1 - smooth((p.age - p.lifetime * .45) / (p.lifetime * .55))) : 1;
      let alpha = (inArticle ? edge : extra ? .62 + edge * .38 : inHero ? .28 + edge * .72 : edge * .7) * lifespan;
      // Temporary petals may drift past a page heading, but soften before protected reading space.
      if (extra && article && y < articleTop) alpha *= edge + (1 - edge) * smooth((articleTop - y - p.size) / 60);
      if (extra && small) alpha *= smooth((Math.max(heroBottom, article ? 0 : 160) - y - p.size) / 60);
      if (alpha < .01 || x + p.size < 0 || x - p.size > width || y + p.size < 0 || y - p.size > height || (small && y > Math.max(heroBottom, article ? 0 : 160))) continue;
      if (extra) visibleExtra++; else visibleBase++;
      ctx.save(); ctx.translate(x, y); ctx.rotate(p.turn + Math.sin(p.phase) * .45 + windTilt);
      ctx.scale(1, .55 + Math.abs(Math.cos(p.phase * .7)) * .45);
      ctx.globalAlpha = alpha * (.4 + p.depth * .45) * (dark ? .86 : 1);
      ctx.drawImage(sprites[p.sprite], -p.size / 2, -p.size / 2, p.size, p.size); ctx.restore();
    }
    for (let i = temporary.length - 1; i >= 0; i--) if (temporary[i].age >= temporary[i].lifetime) temporary.splice(i, 1);
    canvas.dataset.sakuraWindResponse = windResponse.toFixed(3);
    canvas.dataset.sakuraWindShift = windShift.toFixed(2);
    canvas.dataset.sakuraEpisode = episode;
    canvas.dataset.sakuraReleaseAge = releaseAge.toFixed(3);
    canvas.dataset.sakuraBasePool = String(petals.length);
    canvas.dataset.sakuraBaseCount = String(visibleBase);
    canvas.dataset.sakuraBurstCount = String(visibleExtra);
    canvas.dataset.sakuraBurstState = releaseAge < 0 ? 'idle' : releaseAge < 1.5 ? 'wind' : 'fading';
    if (releaseAge >= 0 && !temporary.length) {
      releaseAge = -1; canvas.dataset.sakuraBurstState = 'idle';
      window.dispatchEvent(new Event('sakura-arrival-end'));
    }
    // A few fine arcs trace the wind, confined to the edge of the scene.
    if (gust > .12 && heroBottom > 120) {
      ctx.save(); ctx.lineWidth = .8; ctx.strokeStyle = dark ? '#f7c5df' : '#d986b0';
      ctx.beginPath(); ctx.rect(0, 0, width * .23, Math.min(heroBottom, articleTop, height)); ctx.clip();
      ctx.globalAlpha = Math.min(.23, gust * .09);
      for (let i = 0; i < 3; i++) {
        const y = height * (.2 + i * .24) + Math.sin(elapsed + i) * 35;
        ctx.beginPath(); ctx.moveTo(-30, y + 70); ctx.bezierCurveTo(width * .06, y - 60, width * .17, y + 95, width * .23, y - 20); ctx.stroke();
      }
      ctx.restore();
    }
  };
  const draw = (time: number) => {
    raf = 0;
    if (!active()) return;
    // Mobile / data-saver draw at 30fps, desktop at most 60fps, independent of refresh rate.
    const delta = time - previous;
    if (delta >= (small || connection?.saveData ? 32 : 16)) {
      const step = Math.min(delta / 1000, .05); previous = time; elapsed += step;
      if (releaseAge >= 0) releaseAge += delta / 1000;
      gust *= Math.exp(-step * 1.6); pointerWind *= Math.exp(-step * 2.5);
      // Slow, periodic breezes give the scene life even without pointer input.
      if (Math.sin(elapsed * .24) > .98) gust = Math.max(gust, .28);
      paint(step, delta / 1000);
    }
    raf = requestAnimationFrame(draw);
  };
  const sync = () => {
    dark = root.classList.contains('dark');
    const running = active();
    root.dataset.sakuraMotion = running ? 'on' : 'off';
    tools.hidden = quiet || root.dataset.visualTheme === 'poetize' || (small && !visibleArea()) || narrowReading();
    if (tools.hidden && !running) {
      // History restoration into a quiet reading area must also cancel the brief petal sweep.
      delete root.dataset.sakuraArrival; delete root.dataset.sakuraDirection;
    }
    toggle.disabled = motion.matches;
    toggle.setAttribute('aria-pressed', String(enabled && !motion.matches));
    const label = motion.matches ? '已遵循系统减少动态效果设置' : enabled ? '暂停樱花动效' : '开启樱花动效';
    toggle.setAttribute('aria-label', label); toggle.title = label;
    gustButton.disabled = !allowed();
    canvas.hidden = !running;
    if (running && !raf) { previous = performance.now(); raf = requestAnimationFrame(draw); }
    if (!running) { cancelAnimationFrame(raf); raf = 0; gust = 0; releaseAge = -1; temporary = []; ctx.clearRect(0, 0, width, height); canvas.dataset.sakuraBaseCount = canvas.dataset.sakuraBurstCount = '0'; canvas.dataset.sakuraBurstState = 'idle'; }
  };
  const breeze = () => {
    if (!active() || performance.now() - lastGust < 650) return;
    lastGust = performance.now(); gust = small ? 1.6 : 2.2;
    // Reuse the same pool: rapid clicks cannot accumulate particles or timers.
    petals.forEach((p, i) => { if (i % 3 === 0) { p.x = Math.random() * width * .2; p.y = Math.random() * height; } });
  };
  const arrivalBreeze = () => {
    if (!active()) return;
    // One bounded episode in the same field: add small petals, then retire each one.
    gust = 0; releaseAge = 0;
    episode = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    canvas.dataset.sakuraSceneSource = 'fresh';
    const count = connection?.saveData ? 4 : small ? 6 : 12;
    temporary = Array.from({ length: count }, (_, i) => {
      const p = makePetal();
      return { ...p, x: width * (.08 + ((i + .5) / count) * .84), y: height * (.08 + Math.random() * .26),
        size: 10 + p.depth * 8, speed: 24 + p.depth * 14,
        age: -(i * .045 + Math.random() * .08), lifetime: 2.8 + p.depth * .8 };
    });
  };
  toggle.addEventListener('click', () => {
    enabled = !enabled;
    try { localStorage.setItem('sakura-effects', enabled ? 'on' : 'off'); } catch {}
    // Pass the in-memory preference too, for browsers which block storage.
    window.dispatchEvent(new CustomEvent('sakura-preference', { detail: enabled }));
    sync(); if (enabled) breeze();
  });
  gustButton.addEventListener('click', breeze);
  document.addEventListener('pointermove', event => {
    if (event.pointerType !== 'mouse' || small || !active() || performance.now() - lastPointer < 70) return;
    const movement = Math.max(-25, Math.min(25, (event.clientX - previousX) * .12));
    previousX = event.clientX; lastPointer = performance.now();
    pointerWind = movement;
  }, { passive: true });
  const onScroll = () => {
    if (scrollFrame) return;
    scrollFrame = requestAnimationFrame(() => { scrollFrame = 0; measure(); sync(); });
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', () => { resize(); sync(); }, { passive: true });
  motion.addEventListener('change', sync);
  coarse.addEventListener('change', () => { resize(); sync(); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && pendingTarget) { saveScene(pendingTarget); capturedOnHide = true; }
    if (!document.hidden) capturedOnHide = false;
    sync();
  });
  const observer = new MutationObserver(() => { measure(); sync(); });
  const observe = () => observer.observe(root, { attributes: true, attributeFilter: ['data-visual-theme', 'class'] });
  const sizing = new ResizeObserver(() => { measure(); sync(); });
  const observeSize = () => { if (hero) sizing.observe(hero); if (article) sizing.observe(article); };
  window.addEventListener('storage', event => { if (event.key === 'sakura-effects' || event.key === null) { readPreference(); sync(); } });
  window.addEventListener('pagehide', () => {
    if (pendingTarget && !capturedOnHide) saveScene(pendingTarget);
    departed = true; cancelAnimationFrame(raf); raf = 0; cancelAnimationFrame(scrollFrame); scrollFrame = 0;
    observer.disconnect(); sizing.disconnect();
  });
  window.addEventListener('pageshow', event => {
    if (!event.persisted) return;
    departed = false; pendingTarget = ''; capturedOnHide = false; readPreference();
    // Keep the same field on history restore instead of scattering it a second time.
    if (width !== innerWidth || height !== innerHeight) resize(); else measure();
    observe(); observeSize(); sync(); arrivalBreeze();
  });
  const saveScene = (target: string) => {
    if (!allowed()) return false;
    try {
      sessionStorage.setItem(handoffKey, JSON.stringify({ target, at: Date.now(), width, height, elapsed, gust, pointerWind, releaseAge, episode, petals, temporary }));
      return true;
    } catch { try { sessionStorage.removeItem(handoffKey); } catch {} return false; }
  };
  window.addEventListener('sakura-navigation-start', event => {
    const request = (event as CustomEvent<{ href: string; accepted: boolean }>).detail;
    if (!active()) return;
    if (!pendingTarget) arrivalBreeze();
    pendingTarget = request.href; capturedOnHide = false;
    canvas.dataset.sakuraSceneSource = 'departure';
    request.accepted = saveScene(pendingTarget);
  });
  window.addEventListener('sakura-navigation-handoff', event => {
    pendingTarget = (event as CustomEvent<string>).detail;
    saveScene(pendingTarget);
  });
  window.addEventListener('sakura-navigation-abandon', event => {
    if (pendingTarget !== (event as CustomEvent<string>).detail) return;
    saveScene(pendingTarget); pendingTarget = ''; capturedOnHide = false;
  });
  window.addEventListener('sakura-navigation-cancel', () => {
    pendingTarget = ''; capturedOnHide = false; temporary = []; releaseAge = -1; gust = 0;
    try { sessionStorage.removeItem(handoffKey); } catch {}
    sync(); if (active()) paint(0, 0);
  });
  const restoreScene = () => {
    try {
      const raw = sessionStorage.getItem(handoffKey); sessionStorage.removeItem(handoffKey);
      if (!raw || raw.length > 30000 || !allowed()) return false;
      const saved = JSON.parse(raw), target = new URL(saved.target);
      target.searchParams.delete('visual-theme');
      const current = new URL(location.href); current.searchParams.delete('visual-theme');
      const gap = (Date.now() - saved.at) / 1000;
      const validPetal = (p: Petal) => ['x', 'y', 'depth', 'size', 'phase', 'turn', 'speed', 'sprite', 'age', 'lifetime'].every(key => Number.isFinite(p[key as keyof Petal])) && p.depth >= 0 && p.depth <= 1 && p.size >= 1 && p.size <= 20 && Number.isInteger(p.sprite) && p.sprite >= 0 && p.sprite < 3 && p.lifetime >= 0 && p.lifetime <= 4 && p.age >= -1 && p.age <= 5 && p.speed >= 0 && p.speed <= 100;
      if (target.origin !== current.origin || target.pathname.replace(/\/$/, '') !== current.pathname.replace(/\/$/, '') || target.search !== current.search || gap < 0 || gap > 10 || !Number.isFinite(saved.at) || !Number.isFinite(saved.width) || !Number.isFinite(saved.height) || saved.width <= 0 || saved.height <= 0 || ![saved.elapsed, saved.gust, saved.pointerWind, saved.releaseAge].every(Number.isFinite) || saved.releaseAge < -1 || saved.releaseAge > 5 || typeof saved.episode !== 'string' || saved.episode.length > 80 || !Array.isArray(saved.petals) || saved.petals.length > 14 || !saved.petals.every(validPetal) || !Array.isArray(saved.temporary) || saved.temporary.length > 12 || !saved.temporary.every(validPetal)) return false;
      const scale = (p: Petal): Petal => ({ ...p, x: width === saved.width ? p.x : p.x * width / saved.width, y: height === saved.height ? p.y : p.y * height / saved.height });
      const count = petals.length;
      petals = saved.petals.slice(0, count).map(scale);
      while (petals.length < count) petals.push(makePetal());
      temporary = saved.temporary.slice(0, connection?.saveData ? 4 : small ? 6 : 12).map((p: Petal) => ({ ...scale(p), age: p.age + gap })).filter((p: Petal) => p.lifetime > 0 && p.age < p.lifetime);
      elapsed = saved.elapsed + gap; gust = saved.gust * Math.exp(-gap * 1.6); pointerWind = saved.pointerWind * Math.exp(-gap * 2.5);
      releaseAge = saved.releaseAge < 0 ? -1 : saved.releaseAge + gap; episode = saved.episode;
      canvas.dataset.sakuraSceneSource = 'continued';
      root.dataset.sakuraContinuing = 'true';
      return true;
    } catch { return false; }
  };
  resize();
  const restored = restoreScene();
  observe(); observeSize(); sync();
  root.dataset.sakuraReady = 'true';
  if (restored) { if (active()) paint(0, 0); }
  else arrivalBreeze();
}
