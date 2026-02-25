import { defineCollection, z } from 'astro:content';

const blog = defineCollection({
  schema: z.object({
    title: z.string(),
    description: z.string(),
    pubDate: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),
    heroImage: z.string().optional(),
    tags: z.array(z.string()).optional(),
    category: z.string().optional(),
    series: z.string().optional(),
    seriesOrder: z.number().optional(),
  }),
});

const books = defineCollection({
  schema: z.object({
    title: z.string(),
    author: z.string(),
    cover: z.string(),                        // emoji
    rating: z.number().min(1).max(5),
    finishDate: z.string(),                   // YYYY-MM
    tags: z.array(z.string()).default([]),
    summary: z.string(),
    keyPoints: z.array(z.string()).default([]),
  }),
});

export const collections = { blog, books };
