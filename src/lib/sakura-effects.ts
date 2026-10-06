/** Layered, continuous Sakura motion; native document navigation still owns history. */
export function initSakura() {
  const canvas = document.querySelector<HTMLCanvasElement>('#sakura-petals');
  const passageCanvas = document.querySelector<HTMLCanvasElement>('#sakura-passage');
  const passageCtx = passageCanvas?.getContext('2d');
  const tools = document.querySelector<HTMLElement>('#sakura-tools');
  const toggle = document.querySelector<HTMLButtonElement>('#sakura-effects-toggle');
  const gustButton = document.querySelector<HTMLButtonElement>('#sakura-gust');
  const ctx = canvas?.getContext('2d');
  if (!canvas || !ctx || !passageCanvas || !passageCtx || !tools || !toggle || !gustButton) return;
  const root = document.documentElement;
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const coarse = matchMedia('(pointer: coarse)');
  const quiet = !!document.querySelector('#notes-app, .docs-shell, .editor-demo');
  const hero = document.querySelector<HTMLElement>('.hero-wrap, .page-hero, .post-header, .blog-head, .projects-hero');
  const heroBody = document.querySelector<HTMLElement>('.hero-body');
  const article = document.querySelector<HTMLElement>('.article-main');
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  let enabled = true;
  const readPreference = () => { try { enabled = localStorage.getItem('sakura-effects') !== 'off'; } catch {} };
  readPreference();
  let width = 0, height = 0, small = false, dark = false, departed = false;
  let raf = 0, scrollFrame = 0, previous = 0, elapsed = 0, sceneAge = 0, gustAge = -1, passageAge = -1;
  let pointerWind = 0, pointerTarget = 0, lastPointer = 0, previousX: number | undefined;
  let wasRunning = false, restored = false, pendingTarget = '';
  let heroBottom = 0, articleTop = Infinity, articleBottom = -Infinity;
  let heroCopy: DOMRect | undefined;
  let safeLeft = 0, safeRight = 0;
  type Petal = { x: number; y: number; depth: number; size: number; phase: number; turn: number; speed: number; sprite: number; delay: number };
  let petals: Petal[] = [];
  type Release = { x: number; y: number; depth: number; phase: number; delay: number; drift: number; size: number; sprite: number };
  let releases: Release[] = [];
  const passageDuration = 1.25;
  // Cache three shaded, notched petals. No gradients / paths / DOM allocations per frame.
  const sprites = ['#f8b7cf', '#e991b7', '#ffe0ed'].map(color => {
    const tile = document.createElement('canvas'); tile.width = tile.height = 64;
    const c = tile.getContext('2d')!;
    const fill = c.createLinearGradient(12, 10, 48, 54);
    fill.addColorStop(0, '#fff5f9'); fill.addColorStop(.48, color); fill.addColorStop(1, '#d8669e');
    c.fillStyle = fill;
    c.beginPath(); c.moveTo(32, 58); c.bezierCurveTo(4, 40, 6, 3, 27, 8);
    c.lineTo(32, 15); c.lineTo(37, 8); c.bezierCurveTo(59, 4, 59, 39, 32, 58); c.fill();
    c.strokeStyle = '#ce729a99'; c.lineWidth = 1; c.stroke();
    c.strokeStyle = '#fff4f9aa'; c.lineWidth = 1.3;
    c.beginPath(); c.moveTo(32, 53); c.quadraticCurveTo(25, 34, 31, 21); c.stroke();
    return tile;
  });
  const edgeX = (index: number) => width * (index % 2 ? .82 + Math.random() * .14 : .04 + Math.random() * .14);
  const makePetal = (index: number, count: number): Petal => {
    const depth = Math.random();
    return { x: edgeX(index), y: height * ((index + .3) / count),
      depth, size: (small ? 20 : 23) + depth * (small ? 12 : 17), phase: Math.random() * Math.PI * 2,
      turn: Math.random() * Math.PI * 2, speed: 19 + depth * 20, sprite: index % 3, delay: index * .045 };
  };
  const smooth = (value: number) => { const t = Math.max(0, Math.min(1, value)); return t * t * (3 - 2 * t); };
  const allowed = () => !quiet && root.dataset.visualTheme !== 'poetize' && enabled && !motion.matches;
  const narrowReading = () => !!article && articleTop < height && articleBottom > 80 && width - safeRight < 138;
  // Hiding the controls to protect text must also stop the motion they control.
  const visibleArea = () => !narrowReading() && (!small || heroBottom > 80 || (!article && scrollY < 180));
  const active = () => allowed() && !departed && !document.hidden && visibleArea();
  // A short deliberate page passage is separate from ambient reading protection.
  const passageActive = () => allowed() && !departed && !document.hidden && passageAge >= 0;
  const needsFrame = () => active() || passageActive();
  const measure = () => {
    heroBottom = hero?.getBoundingClientRect().bottom ?? 0;
    heroCopy = heroBody?.getBoundingClientRect();
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
    passageCanvas.width = canvas.width; passageCanvas.height = canvas.height;
    passageCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (oldWidth && oldHeight) for (const p of releases) { p.x *= width / oldWidth; p.y *= height / oldHeight; }
    const count = connection?.saveData ? 4 : small ? 9 : Math.min(24, Math.max(16, Math.round(width / 64)));
    petals = Array.from({ length: count }, (_, i) => {
      const p = petals[i];
      return p && oldWidth && oldHeight ? { ...p, x: p.x * width / oldWidth, y: p.y * height / oldHeight, size: (small ? 20 : 23) + p.depth * (small ? 12 : 17) } : makePetal(i, count);
    });
    measure();
  };
  const paint = (step: number) => {
    ctx.clearRect(0, 0, width, height);
    // Different rhythms produce curved trajectories rather than a uniform particle sheet.
    const gust = gustAge < 0 ? 0 : Math.sin(Math.PI * Math.min(1, gustAge / 5.8)) ** 2;
    const ambient = Math.sin(elapsed * .32) * 9 + Math.sin(elapsed * .71) * 5;
    const wind = 12 + ambient + gust * 75 + pointerWind;
    for (const [index, p] of petals.entries()) {
      p.phase += step * (.8 + p.depth * .35); p.turn += step * (.2 + p.depth * .24 + gust * .35);
      p.x += step * (wind * (.4 + p.depth * .7) + Math.sin(p.phase) * (18 + p.depth * 20));
      p.y += step * (p.speed + Math.cos(p.phase * .8) * (9 + p.depth * 9) - gust * (24 + p.depth * 10));
      if (p.y > height + 35) { p.y = -30; p.x = edgeX(index); }
      if (p.x > width + 35) p.x = -30;
      if (p.x < -35) p.x = width + 30;
      // Fade smoothly at the text boundary; never paint over article text or mobile body.
      const inArticle = p.y > articleTop && p.y < articleBottom;
      const inHero = p.y < heroBottom;
      const left = inArticle ? safeLeft : width * (inHero ? .24 : .15);
      const right = inArticle ? safeRight : width * (inHero ? .76 : .85);
      const edge = smooth(Math.max(left - p.x, p.x - right) / 55);
      const entry = smooth((sceneAge - p.delay) / .85);
      const boundary = smooth(Math.min(p.x + 20, width + 20 - p.x, p.y + 20, height + 20 - p.y) / 45);
      const copy = heroCopy ? smooth(Math.max(heroCopy.left - 24 - p.x, p.x - heroCopy.right - 24, heroCopy.top - 24 - p.y, p.y - heroCopy.bottom - 24) / 35) : 1;
      const alpha = edge * entry * boundary * copy * (inHero ? 1 : .72);
      if (alpha < .01 || (small && p.y > Math.max(heroBottom, article ? 0 : 160))) continue;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.turn + Math.sin(p.phase) * .42);
      // Partial flips preserve a recognizable petal while bringing the shaded reverse into view.
      ctx.scale(.62 + Math.abs(Math.cos(p.phase * .62)) * .38, 1);
      ctx.globalAlpha = alpha * (.48 + p.depth * .32) * (dark ? .84 : 1);
      ctx.drawImage(sprites[p.sprite], -p.size / 2, -p.size / 2, p.size, p.size); ctx.restore();
    }
  };
  const paintPassage = () => {
    passageCtx.clearRect(0, 0, width, height);
    if (!passageActive()) return;
    for (const p of releases) {
      // First a small branch-like shiver, then staggered gravity-driven release.
      const fall = Math.max(0, passageAge - p.delay);
      const shake = Math.sin(passageAge * 64 + p.phase) * 3 * (1 - smooth(fall / .12));
      const x = p.x + shake + p.drift * fall + Math.sin(p.phase + fall * 5) * 24 * fall;
      const y = p.y + 65 * fall + (.5 * (760 + p.depth * 380)) * fall * fall;
      const alpha = smooth(passageAge / .09) * (1 - smooth((passageAge - .82) / .43));
      passageCtx.save(); passageCtx.translate(x, y);
      passageCtx.rotate(p.phase + fall * (1.5 + p.depth * 2.3));
      passageCtx.scale(.58 + Math.abs(Math.cos(p.phase + fall * 4)) * .42, 1);
      passageCtx.globalAlpha = alpha * (.58 + p.depth * .25) * (dark ? .88 : 1);
      passageCtx.drawImage(sprites[p.sprite], -p.size / 2, -p.size / 2, p.size, p.size);
      passageCtx.restore();
    }
  };
  const beginPassage = () => {
    if (!allowed() || document.hidden) return;
    if (passageAge < 0) {
      passageAge = 0;
      const count = connection?.saveData ? 5 : small ? 7 : 12;
      releases = Array.from({ length: count }, (_, i) => {
        const depth = Math.random();
        return { x: width * (.12 + (i % 3) * .34 + (Math.random() - .5) * .13),
          y: 48 + height * (.025 + Math.random() * .105), depth,
          phase: Math.random() * Math.PI * 2, delay: .06 + (i % 4) * .05 + Math.random() * .025,
          drift: (Math.random() - .5) * 95, size: (small ? 27 : 32) + depth * (small ? 13 : 22), sprite: i % 3 };
      });
    }
    sync();
  };
  const draw = (time: number) => {
    raf = 0;
    if (!needsFrame()) return;
    // Slow motion only needs 30fps; mobile / data-saver is capped at 24fps.
    const delta = time - previous;
    if (delta >= (small || connection?.saveData ? 41 : 33)) {
      const step = Math.min(delta / 1000, .05); previous = time; elapsed += step; sceneAge += step;
      pointerTarget *= Math.exp(-step * 1.5);
      pointerWind += (pointerTarget - pointerWind) * (1 - Math.exp(-step * 1.8));
      if (gustAge >= 0) {
        gustAge += step;
        if (gustAge >= 5.8) { gustAge = -1; gustButton.disabled = false; gustButton.title = '让花瓣随微风缓缓飘动'; }
      }
      if (passageAge >= 0) {
        passageAge += step;
        if (passageAge >= passageDuration) { passageAge = -1; releases = []; passageCanvas.hidden = true; }
      }
      if (active()) paint(step);
      paintPassage();
    }
    if (needsFrame()) raf = requestAnimationFrame(draw);
  };
  const sync = () => {
    dark = root.classList.contains('dark');
    const running = active();
    root.dataset.sakuraMotion = running ? 'on' : 'off';
    tools.hidden = quiet || root.dataset.visualTheme === 'poetize' || (small && !visibleArea()) || narrowReading();
    toggle.disabled = motion.matches;
    toggle.setAttribute('aria-pressed', String(enabled && !motion.matches));
    const label = motion.matches ? '已遵循系统减少动态效果设置' : enabled ? '暂停樱花动效' : '开启樱花动效';
    toggle.setAttribute('aria-label', label); toggle.title = label;
    gustButton.disabled = !running || gustAge >= 0;
    gustButton.title = running && gustAge >= 0 ? '微风正缓缓经过' : '让花瓣随微风缓缓飘动';
    canvas.hidden = !running;
    if (running && !wasRunning) { if (!restored) sceneAge = 0; restored = false; }
    if (!allowed() || document.hidden || departed) { passageAge = -1; releases = []; }
    passageCanvas.hidden = !passageActive();
    if (needsFrame() && !raf) { previous = performance.now(); raf = requestAnimationFrame(draw); }
    if (!running) { gustAge = -1; pointerWind = pointerTarget = 0; previousX = undefined; ctx.clearRect(0, 0, width, height); }
    if (!passageActive()) passageCtx.clearRect(0, 0, width, height);
    if (!needsFrame()) { cancelAnimationFrame(raf); raf = 0; }
    wasRunning = running;
  };
  const breeze = () => {
    if (!active() || gustAge >= 0) return;
    gustAge = 0; gustButton.disabled = true; gustButton.title = '微风正缓缓经过';
    // Reuse positions and the same sparse pool. No emission, teleporting or initial burst.
  };
  toggle.addEventListener('click', () => {
    enabled = !enabled;
    try { localStorage.setItem('sakura-effects', enabled ? 'on' : 'off'); } catch {}
    // Pass the in-memory preference too, for browsers which block storage.
    window.dispatchEvent(new CustomEvent('sakura-preference', { detail: enabled }));
    sync();
  });
  gustButton.addEventListener('click', breeze);
  document.addEventListener('pointermove', event => {
    if (event.pointerType !== 'mouse' || small || !active() || performance.now() - lastPointer < 70) return;
    const movement = previousX === undefined ? 0 : Math.max(-12, Math.min(12, (event.clientX - previousX) * .07));
    previousX = event.clientX; lastPointer = performance.now();
    pointerTarget = movement;
  }, { passive: true });
  const onScroll = () => {
    if (scrollFrame) return;
    scrollFrame = requestAnimationFrame(() => { scrollFrame = 0; measure(); sync(); });
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', () => { resize(); sync(); }, { passive: true });
  motion.addEventListener('change', sync);
  coarse.addEventListener('change', () => { resize(); sync(); });
  document.addEventListener('visibilitychange', sync);
  const observer = new MutationObserver(() => { measure(); sync(); });
  const observe = () => observer.observe(root, { attributes: true, attributeFilter: ['data-visual-theme', 'class'] });
  const sizing = new ResizeObserver(() => { measure(); sync(); });
  const observeSize = () => { if (hero) sizing.observe(hero); if (article) sizing.observe(article); };
  window.addEventListener('storage', event => { if (event.key === 'sakura-effects' || event.key === null) { readPreference(); sync(); } });
  window.addEventListener('pagehide', () => {
    // A slow document request must not restore the stale frame from the initial click.
    if (pendingTarget) saveScene(pendingTarget);
    departed = true; sync(); cancelAnimationFrame(scrollFrame); scrollFrame = 0;
    observer.disconnect(); sizing.disconnect();
  });
  window.addEventListener('pageshow', event => {
    if (!event.persisted) return;
    departed = false; readPreference(); resize(); observe(); observeSize(); sync();
  });
  // A bounded same-tab handoff preserves the moving field across native documents.
  // Coordinates are normalized only when the viewport size changes; history is untouched.
  const handoffKey = 'sakura-scene-v3';
  window.addEventListener('sakura-departure', () => { pendingTarget = ''; beginPassage(); });
  window.addEventListener('sakura-cancel', () => { pendingTarget = ''; passageAge = -1; releases = []; sync(); try { sessionStorage.removeItem(handoffKey); } catch {} });
  const saveScene = (target: string) => {
    if (!allowed()) return;
    try { sessionStorage.setItem(handoffKey, JSON.stringify({ target, at: Date.now(), width, height, elapsed, sceneAge, gustAge, passageAge, petals, releases })); } catch {}
  };
  window.addEventListener('sakura-handoff', event => {
    pendingTarget = (event as CustomEvent<string>).detail;
    saveScene(pendingTarget);
  });
  resize();
  try {
    const raw = sessionStorage.getItem(handoffKey); sessionStorage.removeItem(handoffKey);
    const saved = raw ? JSON.parse(raw) : null;
    const target = saved && new URL(saved.target);
    const validPetal = (p: Petal) => ['x', 'y', 'depth', 'size', 'phase', 'turn', 'speed', 'sprite', 'delay'].every(key => Number.isFinite(p[key as keyof Petal])) && p.depth >= 0 && p.depth <= 1 && Number.isInteger(p.sprite) && p.sprite >= 0 && p.sprite < 3;
    if (saved && target.origin === location.origin && target.pathname.replace(/\/$/, '') === location.pathname.replace(/\/$/, '') && target.search === location.search && Date.now() - saved.at < 2500 && Date.now() >= saved.at && saved.width > 0 && saved.height > 0 && Array.isArray(saved.petals) && saved.petals.length === petals.length && saved.petals.every(validPetal) && [saved.elapsed, saved.sceneAge, saved.gustAge, saved.passageAge].every(Number.isFinite)) {
      petals = saved.petals.map((p: Petal) => ({ ...p, x: p.x * width / saved.width, y: p.y * height / saved.height }));
      elapsed = saved.elapsed; sceneAge = saved.sceneAge; gustAge = saved.gustAge; restored = true;
      if (saved.passageAge >= 0 && saved.passageAge < passageDuration && Array.isArray(saved.releases) && saved.releases.length <= 12 && saved.releases.every((p: Release) => ['x', 'y', 'depth', 'phase', 'delay', 'drift', 'size', 'sprite'].every(key => Number.isFinite(p[key as keyof Release])) && p.sprite >= 0 && p.sprite < 3 && Number.isInteger(p.sprite))) {
        passageAge = saved.passageAge;
        releases = saved.releases.map((p: Release) => ({ ...p, x: p.x * width / saved.width, y: p.y * height / saved.height }));
      }
    }
  } catch {}
  observe(); observeSize(); sync();
}
