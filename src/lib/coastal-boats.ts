import { coverRect, parseObjectPosition, type Zone } from './coastal-sea';

// Boats are part of the original painting. Move a small painted sea patch around
// each hull, retaining the boat/reflection at its original scale. Feather only
// the surrounding water; the coastline and the rest of the image stay untouched.
type Boat = { water: Zone; hull: Zone; travel: number; period: number };
const WIDE: Boat[] = [
  { water: [.16, .43, .25, .66], hull: [.19, .475, .215, .60], travel: .012, period: 28 },
  { water: [.52, .345, .578, .45], hull: [.54, .372, .556, .425], travel: .008, period: 37 },
  { water: [.666, .335, .72, .432], hull: [.684, .363, .701, .412], travel: .006, period: 43 },
];
const PORTRAIT: Boat[] = [
  { water: [.045, .431, .217, .542], hull: [.102, .444, .167, .518], travel: .012, period: 28 },
  { water: [.177, .38, .278, .463], hull: [.208, .402, .245, .445], travel: .008, period: 37 },
  { water: [.345, .395, .439, .471], hull: [.378, .418, .402, .448], travel: .006, period: 43 },
];

export function initCoastalBoats(canvas: HTMLCanvasElement) {
  const scene = canvas.closest<HTMLElement>('.coastal-scene');
  const image = scene?.querySelector('img');
  const ctx = canvas.getContext('2d');
  if (!scene || !image || !ctx) return null;
  const patch = document.createElement('canvas'), water = patch.getContext('2d');
  if (!water) return null;
  // srcset density-corrects image.naturalWidth, but drawImage source rectangles
  // address the decoded asset pixels. Decode the selected URL without srcset.
  let source: HTMLImageElement | null = null, sourceUrl = '';
  const selectSource = () => {
    const url = image.currentSrc || image.src;
    if (!url || url === sourceUrl) return;
    sourceUrl = url;
    const next = new Image();
    source = next;
    next.addEventListener('load', () => { if (source === next) paint(); }, {once: true});
    next.src = url;
  };
  let active = false, visible = true, raf = 0, last = 0, clock = 0;
  let width = 0, height = 0, ratio = 1, position: [number, number] = [.5, .5];

  const paint = () => {
    ctx.clearRect(0, 0, width, height);
    const nw = source?.naturalWidth ?? 0, nh = source?.naturalHeight ?? 0;
    if (!source || !nw || !nh || !width || !height) return;
    const painted = coverRect({left: 0, top: 0, width, height}, nw, nh, position);
    const scale = painted.width / nw;
    for (const boat of /portrait/.test(image.currentSrc) ? PORTRAIT : WIDE) {
      const [x0, y0, x3, y3] = boat.water;
      const [x1, y1, x2, y2] = boat.hull;
      const sx = [x0, x1, x2, x3].map(x => x * nw), sy = [y0, y1, y2, y3].map(y => y * nh);
      const w = sx[3] - sx[0], h = sy[3] - sy[0];
      const dx = Math.sin(clock * Math.PI * 2 / boat.period) * boat.travel * nw;
      const dy = Math.sin(clock * Math.PI * 2 / 4.8) * Math.min(2, nh * .002);
      const tx = [0, sx[1] - sx[0] + dx, sx[2] - sx[0] + dx, w];
      const ty = [0, sy[1] - sy[0] + dy, sy[2] - sy[0] + dy, h];
      patch.width = Math.ceil(w); patch.height = Math.ceil(h);
      // The middle slice translates without stretching the boat or its reflection.
      for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) {
        water.drawImage(source, sx[col], sy[row], sx[col + 1] - sx[col], sy[row + 1] - sy[row],
          tx[col], ty[row], tx[col + 1] - tx[col], ty[row + 1] - ty[row]);
      }
      water.globalCompositeOperation = 'destination-in';
      for (const horizontal of [true, false]) {
        const mask = water.createLinearGradient(0, 0, horizontal ? w : 0, horizontal ? 0 : h);
        mask.addColorStop(0, 'transparent'); mask.addColorStop(.16, '#000');
        mask.addColorStop(.84, '#000'); mask.addColorStop(1, 'transparent');
        water.fillStyle = mask; water.fillRect(0, 0, w, h);
      }
      water.globalCompositeOperation = 'source-over';
      ctx.drawImage(patch, 0, 0, w, h, painted.left + sx[0] * scale, painted.top + sy[0] * scale, w * scale, h * scale);
    }
  };
  const frame = (now: number) => {
    raf = 0;
    if (!active || !visible) return;
    if (now - last >= 1000 / 30) {
      clock += Math.min(.05, (now - last) / 1000); last = now;
      paint();
    }
    raf = requestAnimationFrame(frame);
  };
  const schedule = () => {
    if (active && visible && !raf) { last = performance.now(); raf = requestAnimationFrame(frame); }
  };
  const resize = () => {
    // Layout dimensions exclude the shared slow camera transform of image/canvas.
    width = scene.clientWidth; height = scene.clientHeight;
    ratio = Math.min(devicePixelRatio || 1, 1.5);
    canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    position = parseObjectPosition(getComputedStyle(image).objectPosition);
    selectSource();
    if (clock || active) paint();
  };
  const observer = new IntersectionObserver(entries => {
    visible = entries[0]?.isIntersecting ?? false;
    if (!visible) { cancelAnimationFrame(raf); raf = 0; } else schedule();
  });
  observer.observe(scene);
  image.addEventListener('load', resize);
  resize();
  return {
    resize,
    setActive(next: boolean) {
      const entering = next && !active;
      active = next;
      if (entering) resize();
      if (active) schedule(); else { cancelAnimationFrame(raf); raf = 0; }
    },
    destroy() { active = false; cancelAnimationFrame(raf); observer.disconnect(); image.removeEventListener('load', resize); },
  };
}
