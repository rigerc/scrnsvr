import { defineCollection } from 'astro:content';
import { docsLoader } from '@astrojs/starlight/loaders';
import { docsSchema } from '@astrojs/starlight/schema';

/**
 * The only content collection: Starlight's docs, read from
 * `src/content/docs/`. The homepage is driven by `src/config/project.config.ts`
 * rather than a collection, because it is one page with a fixed shape.
 */
export const collections = {
  docs: defineCollection({ loader: docsLoader(), schema: docsSchema() }),
};
