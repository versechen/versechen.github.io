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
  const siteHeader = document.querySelector<HTMLElement>('#site-header');
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  let enabled = true;
  const readPreference = () => { try { enabled = localStorage.getItem('sakura-effects') !== 'off'; } catch {} };
  readPreference();
  let width = 0, height = 0, small = false, dark = false, departed = false;
  let raf = 0, scrollFrame = 0, previous = 0, elapsed = 0, gust = 0, lastGust = -5000;
  let pointerWind = 0, lastPointer = 0, previousX = 0;
  let heroBottom = 0, headerBottom = 0, articleTop = Infinity, articleBottom = -Infinity, releaseAge = -1;
  let safeLeft = 0, safeRight = 0;
  type Petal = { x: number; y: number; vx: number; vy: number; sway: number; curl: number; depth: number; size: number; phase: number; turn: number; speed: number; sprite: number; age: number; lifetime: number };
  type Style = 'gust' | 'fall';
  let petals: Petal[] = [];
  let temporary: Petal[] = [];
  let pendingTarget = '', capturedOnHide = false, episode = '';
  let style: Style = 'gust', windDir = 1;
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
    return { x: Math.random() * width, y: scatter ? Math.random() * height : -28, vx: 0, vy: 0, sway: 1, curl: 0,
      depth, size: 8 + depth * 10, phase: Math.random() * Math.PI * 2,
      turn: Math.random() * Math.PI * 2, speed: 15 + depth * 23, sprite: Math.floor(Math.random() * 3), age: 0, lifetime: 0 };
  };
  const burstCap = () => connection?.saveData ? 6 : small ? 12 : 28;
  // Small screens only draw temporary petals inside the page heading, so episodes start there.
  const band = () => small ? Math.min(height, Math.max(heroBottom, article ? 0 : 160)) : height;
  // The fixed site header paints above the canvas, so episodes begin just below it.
  const lid = () => Math.min(headerBottom, band() * .5);
  const pathOf = (href: string) => { try { return new URL(href, location.href).pathname; } catch { return '/'; } };
  const sectionOf = (path: string) => path.split('/').filter(Boolean)[0] ?? '';
  const sectionIndex = (path: string) => [...document.querySelectorAll<HTMLAnchorElement>('.nav-link[href]')]
    .findIndex(link => sectionOf(pathOf(link.href)) === sectionOf(path));
  const isArticle = (path: string) => /^\/blog\/(?!series(?:\/|$))[^/]+\/?$/.test(path);
  const allowed = () => !quiet && root.dataset.visualTheme !== 'poetize' && enabled && !motion.matches;
  const narrowReading = () => !!article && articleTop < height && articleBottom > 80 && width - safeRight < 138;
  // Hiding the controls to protect text must also stop the motion they control.
  const visibleArea = () => !narrowReading() && (!small || heroBottom > 80 || (!article && scrollY < 180));
  const active = () => allowed() && !departed && !document.hidden && visibleArea();
  const measure = () => {
    heroBottom = hero?.getBoundingClientRect().bottom ?? 0;
    headerBottom = Math.max(0, siteHeader?.getBoundingClientRect().bottom ?? 0);
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
    temporary = temporary.slice(0, burstCap());
    if (oldWidth && oldHeight) for (const p of temporary) { p.x *= width / oldWidth; p.y *= height / oldHeight; }
    measure();
  };
  const paint = (step: number, lifetimeStep: number) => {
    ctx.clearRect(0, 0, width, height);
    // A small shared bend makes the onset read as one gust, before independent flutter resumes.
    const windResponse = releaseAge < 0 ? 0 : releaseAge < .22 ? smooth(releaseAge / .22) : 1 - smooth((releaseAge - .28) / 1.1);
    // Falling petals only stir the field slightly; a section gust leans it toward the wind.
    const lean = windDir * (style === 'fall' ? .35 : 1);
    const windShift = windResponse * 24 * lean, windLift = windResponse * 6 * Math.abs(lean), windTilt = windResponse * .18 * lean;
    const arrivalWind = releaseAge >= 0 && releaseAge < 1.5 ? Math.sin(Math.PI * releaseAge / 1.5) ** 2 * .6 : 0;
    // A falling shower stays fully visible longer before it fades, so it reads as falling, not flickering.
    const hold = style === 'fall' ? .5 : .35;
    // The article shower crosses the title briefly, so it may stay clearer there than the side gust.
    const lead = style === 'fall' ? .88 : .62;
    const wind = 12 + Math.sin(elapsed * .36) * 15 + Math.sin(elapsed * .81) * 8 + gust * 170 + arrivalWind * 85 * lean + pointerWind;
    let visibleBase = 0, visibleExtra = 0;
    for (let index = 0; index < petals.length + temporary.length; index++) {
      const p = index < petals.length ? petals[index] : temporary[index - petals.length];
      const extra = p.lifetime > 0;
      if (extra) { p.age += lifetimeStep; if (p.age < 0 || p.age >= p.lifetime) continue; }
      // The gust swells and settles rather than throwing petals, so every start and stop stays soft.
      const lift = extra ? smooth(p.age / .4) * (1 - smooth((p.age - .6) / 1.6)) : 0;
      const blown = Math.min(1.1, Math.abs(p.vx) * lift / 650);
      p.phase += step * (1 + p.depth); p.turn += step * (.45 + p.depth + gust * 1.2 + blown);
      p.x += step * (wind * (.35 + p.depth) + Math.sin(p.phase) * 19 * p.sway);
      p.y += step * (p.speed + Math.cos(p.phase * .8) * 9 - gust * (12 + p.depth * 34));
      if (extra) {
        p.x += step * p.vx * lift;
        p.y += step * (p.vy + Math.sin(p.age * 2.4 + p.depth * 6.3) * p.curl) * lift;
      }
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
      const fade = extra ? smooth((p.age - p.lifetime * hold) / (p.lifetime * (1 - hold))) : 0;
      const lifespan = extra ? smooth(p.age / .45) * (1 - fade) : 1;
      // Retiring petals shrink a little as well, as if drifting away rather than switching off.
      const size = p.size * (1 - fade * .18);
      let alpha = (inArticle ? edge : extra ? lead + edge * (1 - lead) : inHero ? .28 + edge * .72 : edge * .7) * lifespan;
      // Temporary petals may drift past a page heading, but soften before protected reading space.
      if (extra && article && y < articleTop) alpha *= edge + (1 - edge) * smooth((articleTop - y - size) / 60);
      if (extra && small) alpha *= smooth((Math.max(heroBottom, article ? 0 : 160) - y - size) / 60);
      if (alpha < .01 || x + size < 0 || x - size > width || y + size < 0 || y - size > height || (small && y > Math.max(heroBottom, article ? 0 : 160))) continue;
      if (extra) visibleExtra++; else visibleBase++;
      ctx.save(); ctx.translate(x, y); ctx.rotate(p.turn + Math.sin(p.phase) * .45 + windTilt);
      ctx.scale(1, .55 + Math.abs(Math.cos(p.phase * .7)) * .45);
      ctx.globalAlpha = alpha * (.4 + p.depth * .45) * (dark ? .86 : 1);
      ctx.drawImage(sprites[p.sprite], -size / 2, -size / 2, size, size); ctx.restore();
    }
    for (let i = temporary.length - 1; i >= 0; i--) if (temporary[i].age >= temporary[i].lifetime) temporary.splice(i, 1);
    canvas.dataset.sakuraBurstPool = String(temporary.length);
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
  // Switching sections: a gust strips clusters off an unseen tree at the upwind edge.
  const gustPetals = (): Petal[] => {
    const cap = burstCap(), count = cap - Math.floor(Math.random() * (cap > 12 ? 7 : cap > 6 ? 4 : 2));
    const top = lid(), room = band() - top, strength = .85 + Math.random() * .3, curl = 16 + Math.random() * 28;
    const crown = top + room * (small ? .2 + Math.random() * .35 : .12 + Math.random() * .2);
    const list: Petal[] = [];
    for (let cluster = 0, release = 0; list.length < count; cluster++, release += .04 + Math.random() * .05) {
      const cx = (windDir > 0 ? 0 : width) + windDir * width * (.01 + Math.random() * .11);
      const cy = crown + (Math.random() - .5) * room * .22;
      const cvx = windDir * width * (.42 + Math.random() * .24) * strength, cvy = (Math.random() - .45) * 70;
      // Each cluster has 3–5 petals; uneven speeds pull it apart as it travels.
      for (let j = 0, n = Math.min(count - list.length, 3 + Math.floor(Math.random() * 3)); j < n; j++) {
        const p = makePetal();
        list.push({ ...p, x: cx + (Math.random() - .5) * 28, y: cy + (Math.random() - .5) * 24,
          vx: cvx * (.8 + Math.random() * .4), vy: cvy + (Math.random() - .5) * 90, curl: curl * (.6 + Math.random() * .8),
          size: 8 + p.depth * 10, speed: 26 + p.depth * 20,
          age: -(Math.min(release, .54) + j * .02), lifetime: 3.1 + p.depth * .9 });
      }
    }
    return list;
  };
  // Entering an article: no sweeping wind; a loose curtain drops from the top edge together,
  // then uneven speeds pull it apart as it falls through the first screen.
  const fallingPetals = (): Petal[] => {
    const top = lid(), room = band() - top, cap = burstCap(), count = Math.round(cap * (.85 + Math.random() * .15));
    const drift = windDir * (10 + Math.random() * 22), rate = Math.min(190, Math.max(45, room * (.17 + Math.random() * .04)));
    const tilt = (Math.random() - .5) * .08, stragglers = Math.floor(count * .25);
    return Array.from({ length: count }, (_, i) => {
      const p = makePetal(), depth = .35 + p.depth * .65, x = width * (.02 + Math.random() * .96), late = i >= count - stragglers;
      return { ...p, depth, x,
        y: late ? top - 20 - Math.random() * room * .06 : top + room * (Math.random() * .12 + tilt * (x / width - .5)),
        vx: drift * (.6 + Math.random() * .8), vy: 0, sway: 1.2 + Math.random() * .8,
        size: 9 + depth * 11, speed: rate * (.82 + depth * .3 + (Math.random() - .5) * .16),
        age: late ? -(.3 + Math.random() * .6) : Math.random() * .12,
        lifetime: 3.9 + depth * .6 };
    });
  };
  const arrivalBreeze = (target = location.href) => {
    if (!active()) return;
    // One bounded episode in the same field, then each petal retires on its own.
    gust = 0; releaseAge = 0;
    episode = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    canvas.dataset.sakuraSceneSource = 'fresh';
    const path = pathOf(target), from = sectionIndex(location.pathname), to = sectionIndex(path);
    style = isArticle(path) ? 'fall' : 'gust';
    // Moving right along the navigation blows from the left, and back again from the right.
    windDir = style === 'gust' && from >= 0 && to >= 0 && from !== to ? Math.sign(to - from) : Math.random() < .5 ? -1 : 1;
    temporary = style === 'fall' ? fallingPetals() : gustPetals();
    canvas.dataset.sakuraStyle = style; canvas.dataset.sakuraWindFrom = windDir > 0 ? 'left' : 'right';
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
      sessionStorage.setItem(handoffKey, JSON.stringify({ target, at: Date.now(), width, height, elapsed, gust, pointerWind, releaseAge, episode, style, windDir, petals, temporary }));
      return true;
    } catch { try { sessionStorage.removeItem(handoffKey); } catch {} return false; }
  };
  window.addEventListener('sakura-navigation-start', event => {
    const request = (event as CustomEvent<{ href: string; accepted: boolean }>).detail;
    if (!active()) return;
    if (!pendingTarget) arrivalBreeze(request.href);
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
      const validPetal = (p: Petal) => ['x', 'y', 'vx', 'vy', 'sway', 'curl', 'depth', 'size', 'phase', 'turn', 'speed', 'sprite', 'age', 'lifetime'].every(key => Number.isFinite(p[key as keyof Petal])) && Math.abs(p.vx) <= 5000 && Math.abs(p.vy) <= 1000 && p.sway >= 0 && p.sway <= 3 && p.curl >= 0 && p.curl <= 200 && p.depth >= 0 && p.depth <= 1 && p.size >= 1 && p.size <= 20 && Number.isInteger(p.sprite) && p.sprite >= 0 && p.sprite < 3 && p.lifetime >= 0 && p.lifetime <= 4.5 && p.age >= -1.5 && p.age <= 6 && p.speed >= 0 && p.speed <= 240;
      if (target.origin !== current.origin || target.pathname.replace(/\/$/, '') !== current.pathname.replace(/\/$/, '') || target.search !== current.search || gap < 0 || gap > 10 || !Number.isFinite(saved.at) || !Number.isFinite(saved.width) || !Number.isFinite(saved.height) || saved.width <= 0 || saved.height <= 0 || ![saved.elapsed, saved.gust, saved.pointerWind, saved.releaseAge].every(Number.isFinite) || saved.releaseAge < -1 || saved.releaseAge > 6 || typeof saved.episode !== 'string' || saved.episode.length > 80 || (saved.style !== 'gust' && saved.style !== 'fall') || (saved.windDir !== 1 && saved.windDir !== -1) || !Array.isArray(saved.petals) || saved.petals.length > 14 || !saved.petals.every(validPetal) || !Array.isArray(saved.temporary) || saved.temporary.length > 28 || !saved.temporary.every(validPetal)) return false;
      const scale = (p: Petal): Petal => ({ ...p, x: width === saved.width ? p.x : p.x * width / saved.width, y: height === saved.height ? p.y : p.y * height / saved.height });
      const count = petals.length;
      petals = saved.petals.slice(0, count).map(scale);
      while (petals.length < count) petals.push(makePetal());
      temporary = saved.temporary.slice(0, burstCap()).map((p: Petal) => ({ ...scale(p), age: p.age + gap })).filter((p: Petal) => p.lifetime > 0 && p.age < p.lifetime);
      elapsed = saved.elapsed + gap; gust = saved.gust * Math.exp(-gap * 1.6); pointerWind = saved.pointerWind * Math.exp(-gap * 2.5);
      releaseAge = saved.releaseAge < 0 ? -1 : saved.releaseAge + gap; episode = saved.episode;
      style = saved.style; windDir = saved.windDir;
      canvas.dataset.sakuraStyle = style; canvas.dataset.sakuraWindFrom = windDir > 0 ? 'left' : 'right';
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
