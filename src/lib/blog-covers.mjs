/** @typedef {{ version: number, presets: string[], assigned: Record<string, string> }} CoverRegistry */

/** @param {unknown} value @returns {CoverRegistry} */
export function parseCoverRegistry(value) {
  if (!value || typeof value !== 'object') throw new Error('封面清单格式错误');
  const data = /** @type {CoverRegistry} */ (value);
  const filename = /^[a-z0-9][a-z0-9._-]*\.(svg|png|jpe?g|webp|avif)$/i;
  if (data.version !== 1 || !Array.isArray(data.presets)
      || data.presets.some(name => typeof name !== 'string' || !filename.test(name))
      || new Set(data.presets).size !== data.presets.length
      || !data.assigned || typeof data.assigned !== 'object' || Array.isArray(data.assigned)
      || Object.values(data.assigned).some(name => typeof name !== 'string' || !filename.test(name))) {
    throw new Error('封面清单格式错误，请检查 src/config/blog-covers.json');
  }
  return { version: 1, presets: [...data.presets], assigned: { ...data.assigned } };
}

/** @param {string} markdown */
function frontmatter(markdown) {
  const match = markdown.replace(/\r\n/g, '\n').match(/^---\n([\s\S]*?)\n---(?=\n|$)/);
  if (!match) throw new Error('文章需要以 YAML frontmatter 开头');
  return match;
}

/** 只读取正文前的字段，代码示例里的 heroImage 不参与分配。 @param {string} markdown */
export function readCoverFilename(markdown) {
  const lines = frontmatter(markdown)[1].match(/^heroImage:[ \t]*(.*)$/gm) ?? [];
  if (lines.length > 1) throw new Error('heroImage 字段重复');
  if (!lines.length) return '';
  const scalar = lines[0].replace(/^heroImage:[ \t]*/, '').trim();
  const value = scalar.match(/^(?:'((?:[^']|'')*)'|"((?:[^"\\]|\\.)*)"|([^#\r\n]+))\s*(?:#.*)?$/);
  if (!value) throw new Error('heroImage 需要填写单行图片路径');
  const path = value[1] !== undefined ? value[1].replace(/''/g, "'")
    : value[2] !== undefined ? JSON.parse(`"${value[2]}"`) : value[3].trim();
  const filename = path.match(/(?:^|\/)assets\/images\/([a-z0-9][a-z0-9._-]*\.(?:svg|png|jpe?g|webp|avif))$/i)?.[1];
  if (!filename) throw new Error('封面请使用 src/assets/images/ 内的预设图片');
  return filename;
}

/** @param {CoverRegistry} registry */
export function unusedCovers(registry) {
  const used = new Set(Object.values(registry.assigned));
  return registry.presets.filter(filename => !used.has(filename));
}

/**
 * 新文章随机选未使用封面，已有文章保留结果；删除后保留 assigned 防止复用。
 * 返回副本，失败时不修改原清单。
 * @param {string} markdown
 * @param {string} slug
 * @param {CoverRegistry} input
 * @param {() => number} [random]
 */
export function assignBlogCover(markdown, slug, input, random = Math.random) {
  const registry = parseCoverRegistry(input);
  const requested = readCoverFilename(markdown);
  let cover = Object.hasOwn(registry.assigned, slug) ? registry.assigned[slug] : '';
  if (cover && requested && requested !== cover) {
    throw new Error('这篇文章已固定封面，请同时更新文章和封面清单后再发布');
  }
  if (!cover) {
    const available = unusedCovers(registry);
    if (requested) {
      if (!available.includes(requested)) throw new Error('这张封面已使用或未加入预设清单，请选择未使用的图片');
      cover = requested;
    } else {
      if (!available.length) throw new Error('预设封面已全部使用，请先补充新的封面图片，再发布');
      const value = random();
      if (!Number.isFinite(value) || value < 0 || value >= 1) throw new Error('随机数超出有效范围');
      cover = available[Math.floor(value * available.length)];
    }
    registry.assigned[slug] = cover;
  }
  const normalized = markdown.replace(/\r\n/g, '\n');
  const match = frontmatter(normalized);
  const field = `heroImage: '${'../'.repeat(slug.split('/').length + 1)}assets/images/${cover}'`;
  const block = /^heroImage:/m.test(match[1])
    ? match[1].replace(/^heroImage:.*$/m, field) : `${match[1]}\n${field}`;
  return { markdown: `---\n${block}\n---${normalized.slice(match[0].length)}`, registry, cover };
}
