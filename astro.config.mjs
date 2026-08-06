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
  integrations: [mdx(), sitemap()],
});