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
  let heroBottom = 0, articleTop = Infinity, articleBottom = -Infinity;
  let safeLeft = 0, safeRight = 0;
  type Petal = { x: number; y: number; depth: number; size: number; phase: number; turn: number; speed: number; sprite: number };
  let petals: Petal[] = [];
  // Cache three shaded, notched petals. No gradients / paths / DOM allocations per frame.
  const sprites = ['#f8b7cf', '#e991b7', '#ffe0ed'].map(color => {
    const tile = document.createElement('canvas'); tile.width = tile.height = 64;
    const c = tile.getContext('2d')!;
    const fill = c.createLinearGradient(12, 10, 48, 54);
    fill.addColorStop(0, '#fff5f9'); fill.addColorStop(.48, color); fill.addColorStop(1, '#d8669e');
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
      depth, size: 8 + depth * 19, phase: Math.random() * Math.PI * 2,
      turn: Math.random() * Math.PI * 2, speed: 15 + depth * 23, sprite: Math.floor(Math.random() * 3) };
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
    width = innerWidth; height = innerHeight;
    small = width < 768 || coarse.matches;
    // Also cap total backing pixels on ultrawide / 4K displays (about 12MB).
    const dpr = Math.min(devicePixelRatio || 1, small ? 1.25 : 1.5, Math.sqrt(3_000_000 / (width * height)));
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const count = connection?.saveData ? 14 : small ? 24 : Math.min(60, Math.round(width / 28));
    petals = Array.from({ length: count }, () => makePetal());
    measure();
  };
  const paint = (step: number) => {
    ctx.clearRect(0, 0, width, height);
    const wind = 12 + Math.sin(elapsed * .36) * 15 + Math.sin(elapsed * .81) * 8 + gust * 170 + pointerWind;
    for (const p of petals) {
      p.phase += step * (1 + p.depth); p.turn += step * (.45 + p.depth + gust * 1.2);
      p.x += step * (wind * (.35 + p.depth) + Math.sin(p.phase) * 19);
      p.y += step * (p.speed + Math.cos(p.phase * .8) * 9 - gust * (12 + p.depth * 34));
      if (p.y > height + 35) { p.y = -30; p.x = Math.random() * width; }
      if (p.y < -60) p.y = height + 28;
      if (p.x > width + 35) p.x = -30;
      if (p.x < -35) p.x = width + 30;
      // Fade smoothly at the text boundary; never paint over article text or mobile body.
      const inArticle = p.y > articleTop && p.y < articleBottom;
      const inHero = p.y < heroBottom;
      const left = inArticle ? safeLeft : width * (inHero ? .24 : .15);
      const right = inArticle ? safeRight : width * (inHero ? .76 : .85);
      const edge = Math.max(0, Math.min(1, Math.max(left - p.x, p.x - right) / 55));
      const alpha = inArticle ? edge : inHero ? .28 + edge * .72 : edge * .7;
      if (alpha < .01 || (small && p.y > Math.max(heroBottom, article ? 0 : 160))) continue;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.turn + Math.sin(p.phase) * .45);
      ctx.scale(1, .28 + Math.abs(Math.cos(p.phase * .7)) * .72);
      ctx.globalAlpha = alpha * (.4 + p.depth * .45) * (dark ? .86 : 1);
      ctx.drawImage(sprites[p.sprite], -p.size / 2, -p.size / 2, p.size, p.size); ctx.restore();
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
      gust *= Math.exp(-step * 1.6); pointerWind *= Math.exp(-step * 2.5);
      // Slow, periodic breezes give the scene life even without pointer input.
      if (Math.sin(elapsed * .24) > .98) gust = Math.max(gust, .28);
      paint(step);
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
    if (!running) { cancelAnimationFrame(raf); raf = 0; gust = 0; ctx.clearRect(0, 0, width, height); }
  };
  const breeze = () => {
    if (!active() || performance.now() - lastGust < 650) return;
    lastGust = performance.now(); gust = small ? 1.6 : 2.2;
    // Reuse the same pool: rapid clicks cannot accumulate particles or timers.
    petals.forEach((p, i) => { if (i % 3 === 0) { p.x = Math.random() * width * .2; p.y = Math.random() * height; } });
  };
  const arrivalBreeze = () => {
    // A quiet arrival uses the existing field; only an explicit wind click scatters it.
    if (active()) gust = small ? .2 : .28;
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
  document.addEventListener('visibilitychange', sync);
  const observer = new MutationObserver(() => { measure(); sync(); });
  const observe = () => observer.observe(root, { attributes: true, attributeFilter: ['data-visual-theme', 'class'] });
  const sizing = new ResizeObserver(() => { measure(); sync(); });
  const observeSize = () => { if (hero) sizing.observe(hero); if (article) sizing.observe(article); };
  window.addEventListener('storage', event => { if (event.key === 'sakura-effects' || event.key === null) { readPreference(); sync(); } });
  window.addEventListener('pagehide', () => {
    departed = true; cancelAnimationFrame(raf); raf = 0; cancelAnimationFrame(scrollFrame); scrollFrame = 0;
    observer.disconnect(); sizing.disconnect();
  });
  window.addEventListener('pageshow', event => {
    if (!event.persisted) return;
    departed = false; readPreference();
    // Keep the same field on history restore instead of scattering it a second time.
    if (width !== innerWidth || height !== innerHeight) resize(); else measure();
    observe(); observeSize(); sync(); arrivalBreeze();
  });
  resize(); observe(); observeSize(); sync(); arrivalBreeze();
}
