import { readdirSync, readFileSync } from 'node:fs';
import { defineConfig } from 'astro/config';
import { unified } from '@astrojs/markdown-remark';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import rehypeAutolinkHeadings from 'rehype-autolink-headings';
import rehypeExternalLinks from 'rehype-external-links';
import rehypeKatex from 'rehype-katex';
import rehypeSlug from 'rehype-slug';
import remarkGithubBlockquoteAlert from 'remark-github-blockquote-alert';
import remarkMath from 'remark-math';
import { notesDevPlugin } from './scripts/notes-dev-plugin.mjs';
import { remarkDiagrams } from './src/lib/diagrams';

// 归档文章页面带 noindex，站点地图里也不应再提交给搜索引擎。
function archivedBlogPaths() {
  const dir = new URL('./src/content/blog/', import.meta.url);
  const paths = new Set();
  for (const name of readdirSync(dir, { recursive: true })) {
    const file = String(name).replace(/\\/g, '/');
    if (!/\.mdx?$/.test(file) || file.split('/').some((part) => part.startsWith('_'))) continue;
    const front = readFileSync(new URL(file, dir), 'utf8').match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? '';
    if (/^archived:\s*['"]?(true|yes)['"]?\s*$/im.test(front)) paths.add(`/blog/${file.replace(/\.mdx?$/, '')}/`);
  }
  return paths;
}

const archivedPaths = archivedBlogPaths();

// https://astro.build/config
export default defineConfig({
  site: 'https://versechen.github.io',
  compressHTML: true,
  markdown: {
    // Astro 7 默认使用 Sätteri；显式启用 unified 以兼容成熟的 remark/rehype 插件。
    processor: unified({
      smartypants: false,
      remarkPlugins: [
        remarkMath,
        remarkGithubBlockquoteAlert,
        remarkDiagrams,
      ],
      rehypePlugins: [
        rehypeSlug,
        [
          rehypeAutolinkHeadings,
          {
            behavior: 'append',
            properties: {
              className: ['heading-anchor'],
              ariaLabel: '链接到此标题',
            },
            // 锚点符号由 CSS 生成，避免污染 Astro 收集的 headings 文本。
            content: [],
          },
        ],
        [
          rehypeExternalLinks,
          {
            target: '_blank',
            rel: ['noopener', 'noreferrer'],
          },
        ],
        rehypeKatex,
      ],
    }),
    syntaxHighlight: 'shiki',
    shikiConfig: {
      themes: {
        light: 'github-light',
        dark: 'github-dark',
      },
      // 关闭默认主题内联着色，两套主题统一走 --shiki-light / --shiki-dark 变量。
      defaultColor: false,
      wrap: true,
    },
  },
  integrations: [
    mdx(),
    sitemap({
      filter: (page) => !page.includes('/notes') && !archivedPaths.has(new URL(page).pathname.replace(/\/?$/, '/')),
    }),
  ],
  vite: {
    plugins: [notesDevPlugin()],
  },
});