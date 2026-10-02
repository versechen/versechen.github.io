/** The TOC and all its entry points share the visible article's vertical bounds. */
export function tocBounds(
  article: { top: number; bottom: number },
  viewportHeight: number,
  navHeight: number,
) {
  const top = Math.max(navHeight + 16, article.top);
  const bottom = Math.min(viewportHeight - 16, article.bottom);
  const height = Math.max(0, bottom - top);
  // Leave room for the controls and at least one link. Smaller slivers stay inert.
  return { top, bottom, height, available: height >= 128 };
}
