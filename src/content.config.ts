import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const blog = defineCollection({
  loader: glob({
    pattern: '**/[^_]*.{md,mdx}',
    base: './src/content/blog',
  }),
  // image() 让封面图走 Astro 资源管线，产出带内容哈希的文件名，
  // 图片内容变化时 URL 随之改变，不会命中浏览器的陈旧缓存。
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      description: z.string(),
      pubDate: z.coerce.date(),
      updatedDate: z.coerce.date().optional(),
      heroImage: image().optional(),
      tags: z.array(z.string()).default([]),
      category: z.string().optional(),
      series: z.string().optional(),
      seriesOrder: z.number().int().positive().optional(),
      draft: z.boolean().default(false),
    }),
});

const books = defineCollection({
  loader: glob({
    pattern: '**/[^_]*.md',
    base: './src/content/books',
  }),
  schema: z.object({
    title: z.string(),
    author: z.string(),
    cover: z.string(),
    rating: z.number().int().min(1).max(5),
    finishDate: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
    tags: z.array(z.string()).default([]),
    summary: z.string(),
    keyPoints: z.array(z.string()).default([]),
  }),
});

const projects = defineCollection({
  loader: glob({
    pattern: '**/[^_]*.md',
    base: './src/content/projects',
  }),
  schema: z.object({
    name: z.string(),
    description: z.string(),
    icon: z.string().default('📦'),
    tags: z.array(z.string()).default([]),
    status: z.enum(['active', 'wip', 'archived']).default('active'),
    github: z.string().optional(),
    link: z.string().optional(),
    order: z.number().int().nonnegative().default(99),
    /** 是否有可浏览的 docs 文档站 */
    hasDocs: z.boolean().default(false),
  }),
});

/** 对应 GitHub 仓库 docs/ 目录，按 {projectSlug}/{docPath}.md 组织 */
const projectDocs = defineCollection({
  loader: glob({
    pattern: '**/[^_]*.md',
    base: './src/content/project-docs',
  }),
  schema: z.object({
    title: z.string(),
    description: z.string().optional(),
    order: z.number().int().nonnegative().default(99),
    /** 侧栏分组标题，同组文档显示在同一区块 */
    section: z.string().optional(),
  }),
});

export const collections = { blog, books, projects, projectDocs };
