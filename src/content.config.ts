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

export const collections = { blog, books };
