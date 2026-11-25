import collectionOrder from '../../../data/collections.json';

interface ShaderManifest {
  id: string;
  title: string;
  category: string;
  collection: string;
  description?: string;
}

const manifests = import.meta.glob<ShaderManifest>('../../../data/shaders/*/manifest.json', {
  eager: true,
  import: 'default',
});

export const featuredShaders = [
  'aurora-veil',
  'contour-dunes',
  'tidal-caustics',
  'silk-ribbons',
  'star-drift',
  'plasma',
];

export const shaders = Object.values(manifests)
  .map((manifest) => {
    const quiet = manifest.category === 'Reactive';
    return {
      ...manifest,
      description: quiet ? 'This visual runs in its quiet state in scrnsvr 1.x.' : manifest.description,
      image: `/media/shaders/${manifest.id}.webp`,
      video: featuredShaders.includes(manifest.id) ? `/media/shaders/${manifest.id}.mp4` : undefined,
    };
  })
  .sort((a, b) => a.title.localeCompare(b.title, 'en'));

/** Library collections in the same order as the settings window (`data/collections.json`). */
export const shaderCollections = (collectionOrder as string[]).filter((name) => shaders.some(({ collection }) => collection === name));
