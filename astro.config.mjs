import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';

import preact from "@astrojs/preact";

// https://astro.build/config
export default defineConfig({
  site: 'https://versechen.github.io',
  integrations: [mdx(), sitemap(), react({
    include: ['**/react/*'],
    experimentalReactChildren: true
  }), preact()]
});