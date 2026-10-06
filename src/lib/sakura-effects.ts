/** Home-only SVG scene: a quiet tree and at most three petals per deliberate breeze. */
export function initSakura() {
  const tree = document.querySelector<HTMLElement>('#sakura-tree');
  const tools = document.querySelector<HTMLElement>('#sakura-tools');
  const toggle = document.querySelector<HTMLButtonElement>('#sakura-effects-toggle');
  const gustButton = document.querySelector<HTMLButtonElement>('#sakura-gust');
  const crown = document.querySelector<SVGGElement>('#sakura-tree-wind');
  const petals = [...document.querySelectorAll<SVGGElement>('.sakura-loose-petal')];
  if (!tree || !tools || !toggle || !gustButton || !crown) return;
  const root = document.documentElement;
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const coarse = matchMedia('(pointer: coarse)');
  let enabled = true, departed = false, visible = true, busy = false, generation = 0;
  let animations: Animation[] = [];
  const readPreference = () => { try { enabled = localStorage.getItem('sakura-effects') !== 'off'; } catch {} };
  readPreference();
  const active = () => enabled && !motion.matches && !document.hidden && !departed && visible && root.dataset.visualTheme !== 'poetize';
  const stopWind = () => {
    generation++; animations.forEach(animation => animation.cancel()); animations = []; busy = false;
    tree.removeAttribute('data-breeze');
  };
  const sync = () => {
    const running = active();
    root.dataset.sakuraMotion = running ? 'on' : 'off';
    tools.hidden = root.dataset.visualTheme === 'poetize';
    if (!running) stopWind();
    toggle.disabled = motion.matches;
    toggle.setAttribute('aria-pressed', String(enabled && !motion.matches));
    const label = motion.matches ? '已遵循系统减少动态效果设置' : enabled ? '暂停树枝与花瓣动效' : '开启树枝与花瓣动效';
    toggle.setAttribute('aria-label', label); toggle.title = label;
    gustButton.disabled = !running || busy;
    gustButton.title = busy ? '风正轻轻经过枝头' : '让两三片花瓣随风缓缓飘落';
  };
  const breeze = () => {
    if (!active() || busy) return;
    busy = true; tree.dataset.breeze = 'true';
    const current = ++generation;
    const count = coarse.matches || innerWidth < 768 ? 2 : 3;
    // Exact blossom tips in the SVG's coordinate space. No random dots, pooling growth or rAF loop.
    const origins = count === 2 ? [[310,283],[471,358]] : [[624,200],[536,420],[310,283]];
    animations = [crown.animate([
      { transform: 'rotate(0deg)' }, { transform: 'rotate(.8deg)', offset: .36 },
      { transform: 'rotate(-.12deg)', offset: .76 }, { transform: 'rotate(0deg)' },
    ], { duration: 9000, easing: 'cubic-bezier(.45,0,.25,1)' })];
    petals.slice(0,count).forEach((petal,i) => {
      const [x,y] = origins[i];
      animations.push(petal.animate([
        { transform: `translate(${x}px, ${y}px) rotate(-12deg)`, opacity: 0 },
        { transform: `translate(${x+12}px, ${y+10}px) rotate(8deg)`, opacity: .9, offset: .18 },
        { transform: `translate(${x+43}px, ${y+58}px) rotate(29deg)`, opacity: .75, offset: .55 },
        { transform: `translate(${x+78}px, ${y+138}px) rotate(47deg)`, opacity: 0 },
      ], { duration: 7200 + i * 450, delay: 450 + i * 650, easing: 'cubic-bezier(.35,0,.45,1)', fill: 'both' }));
    });
    sync();
    // Cancellation from pause, a hidden tab or BFCache is expected and cannot revive an old breeze.
    Promise.allSettled(animations.map(animation => animation.finished)).then(() => {
      if (current !== generation) return;
      stopWind(); sync();
    });
  };
  toggle.addEventListener('click', () => {
    enabled = !enabled;
    try { localStorage.setItem('sakura-effects', enabled ? 'on' : 'off'); } catch {}
    window.dispatchEvent(new CustomEvent('sakura-preference', { detail: enabled }));
    sync();
  });
  gustButton.addEventListener('click', breeze);
  motion.addEventListener('change', sync);
  document.addEventListener('visibilitychange', sync);
  const themeObserver = new MutationObserver(sync);
  const observeTheme = () => themeObserver.observe(root, {attributes:true,attributeFilter:['data-visual-theme']});
  const view = new IntersectionObserver(entries => { visible = entries[0].isIntersecting; sync(); }, { threshold: .08 });
  const observe = () => { observeTheme(); view.observe(tree); };
  window.addEventListener('storage', event => { if (event.key === 'sakura-effects' || event.key === null) { readPreference(); sync(); } });
  window.addEventListener('pagehide', () => { departed = true; stopWind(); sync(); themeObserver.disconnect(); view.disconnect(); });
  window.addEventListener('pageshow', event => {
    if (!event.persisted) return;
    departed = false; readPreference(); visible = tree.getBoundingClientRect().bottom > 0; observe(); sync();
  });
  observe(); sync();
}
