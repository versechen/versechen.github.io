import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, relative, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assignBlogCover, parseCoverRegistry, readCoverFilename, unusedCovers } from '../src/lib/blog-covers.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const blog = join(root, 'src/content/blog');
const registryPath = join(root, 'src/config/blog-covers.json');
const check = process.argv.includes('--check');

function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    if (entry.name.startsWith('_') || entry.name.startsWith('.')) return [];
    const path = join(dir, entry.name);
    return entry.isDirectory() ? files(path) : /\.mdx?$/.test(entry.name) ? [path] : [];
  });
}

try {
  const original = readFileSync(registryPath, 'utf8');
  let registry = parseCoverRegistry(JSON.parse(original));
  for (const cover of registry.presets) {
    if (!existsSync(resolve(root, 'src/assets/images', cover))) throw new Error(`预设封面不存在：${cover}`);
  }
  const pending = [];
  const posts = files(blog).sort().map(path => ({ path, markdown: readFileSync(path, 'utf8') }));
  // 显式指定的封面先登记，避免给其他新文章随机选走。
  posts.sort((a, b) => Number(Boolean(readCoverFilename(b.markdown))) - Number(Boolean(readCoverFilename(a.markdown))));
  for (const { path, markdown } of posts) {
    const slug = relative(blog, path).replaceAll('\\', '/').replace(/\.mdx?$/, '');
    if (check && (!Object.hasOwn(registry.assigned, slug) || !readCoverFilename(markdown))) {
      throw new Error(`${slug} 尚未分配封面，请先运行 npm run covers:assign，并把文章与封面清单一起提交`);
    }
    const result = assignBlogCover(markdown, slug, registry);
    registry = result.registry;
    if (result.markdown !== markdown) {
      if (check) throw new Error(`${slug} 的封面路径需要修正，请运行 npm run covers:assign`);
      pending.push({ path, markdown: result.markdown });
    }
  }
  if (!check) {
    // 分配全部成功后才写文件；耗尽封面时不留下半次分配。
    for (const post of pending) writeFileSync(post.path, post.markdown);
    const serialized = `${JSON.stringify(registry, null, 2)}\n`;
    if (serialized !== original) writeFileSync(registryPath, serialized);
  }
  console.log(`封面${check ? '检查通过' : '分配完成'}；预设 ${registry.presets.length} 张，未使用 ${unusedCovers(registry).length} 张。`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
