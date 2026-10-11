import { categoryPath, conceptRegistry } from './concept-registry.ts';
import type { CategoryId } from './concept-registry.ts';
import type { ConceptAssetId } from './concept-assets.ts';

export interface ExploreExhibit {
  conceptId: string;
  asset: ConceptAssetId;
  position: [number, number, number];
  scale?: number;
  rotation?: number;
}
export interface ExploreCategoryView {
  id: string;
  categoryId: CategoryId;
  title: string;
  exhibits: readonly ExploreExhibit[];
  framing: {
    span: number;
    position: [number, number, number];
    target: [number, number, number];
    zoom: number;
  };
}
const exhibit = (conceptId: ConceptAssetId, x: number, z: number, scale = 1): ExploreExhibit => ({
  conceptId,
  asset: conceptId,
  position: [x, 0, z],
  scale,
});
const gallery = (
  categoryId: CategoryId,
  title: string,
  exhibits: ExploreExhibit[],
  span = 19,
): ExploreCategoryView => ({
  id: `catalogue:${categoryId}`,
  categoryId,
  title,
  exhibits,
  framing: { span, position: [11, 10.5, 15], target: [0, 0.8, 0.3], zoom: 1 },
});

/** Curated category space. Positions express co-location, never a route or teaching order.
 * Add a category gallery or an exhibit here; neither requires a Demo scene or scenario. */
export const exploreGalleries: readonly ExploreCategoryView[] = [
  gallery(
    'all',
    'The concept atlas',
    [
      exhibit('device', -7, 2),
      exhibit('internet', -5, -5),
      exhibit('rack', 1, -6),
      exhibit('block', 6, -3, 0.9),
      exhibit('mcp', 7, 4, 0.9),
      exhibit('image', 0, 6),
      exhibit('noise', -6, 7, 0.8),
    ],
    25,
  ),
  gallery(
    'request',
    'Request & application',
    [exhibit('device', -3, -1), exhibit('response', 3, 2, 1.6)],
    14,
  ),
  gallery('network', 'Network & transport', [exhibit('router', -3, 2, 1.2), exhibit('internet', 3, -2)], 15),
  gallery(
    'serving',
    'Serving infrastructure',
    [
      exhibit('datacenter', -4, -3, 0.8),
      exhibit('rack', 3.5, -3),
      exhibit('ingress', -4, 3.5, 1.2),
      exhibit('gpu', 4, 4),
    ],
    22,
  ),
  gallery(
    'model',
    'Model inference',
    [
      exhibit('weights', -4, -3),
      exhibit('block', 3, -3),
      exhibit('prefill', -4, 3, 1.5),
      exhibit('decode', 3, 4),
    ],
    20,
  ),
  gallery(
    'preparation',
    'Context, tokenisation & embeddings',
    [exhibit('context', -4, 1), exhibit('embedding', 1, -3), exhibit('tokenizer', 4, 3)],
    17,
  ),
  gallery(
    'blocks',
    'Transformer concepts',
    [
      exhibit('block', -4, -4, 0.8),
      exhibit('attention', 2, -4),
      exhibit('cache', 6, 0),
      exhibit('norm', -6, 2),
      exhibit('residual', -1, 4),
      exhibit('mlp', 4, 5),
    ],
    23,
  ),
  gallery('output', 'Output representations', [exhibit('sampling', -3, -2), exhibit('decode', 3, 2)], 16),
  gallery(
    'tools',
    'Tools & orchestration',
    [exhibit('intent', -4, -2), exhibit('mcp', 3, -3), exhibit('host', -4, 3), exhibit('tool-result', 3, 4)],
    19,
  ),
  gallery(
    'vision',
    'Vision & multimodal understanding',
    [exhibit('image', -4, 2), exhibit('patches', 0, -3), exhibit('fusion', 4, 3)],
    19,
  ),
  gallery(
    'image-generation',
    'Image generation',
    [
      exhibit('conditioning', -4, -3),
      exhibit('noise', 3, -3),
      exhibit('denoise', -4, 3),
      exhibit('image-output', 3, 4),
    ],
    21,
  ),
];
export function categoryGallery(id: CategoryId): ExploreCategoryView | undefined {
  return [...categoryPath(id)]
    .reverse()
    .filter((category) => category.id !== 'all' || id === 'all')
    .map((category) => exploreGalleries.find((view) => view.categoryId === category.id))
    .find(Boolean);
}
export function conceptGallery(id: string): ExploreCategoryView | undefined {
  const concept = conceptRegistry[id];
  if (!concept) return undefined;
  const category = categoryGallery(concept.categoryId);
  return category?.exhibits.some((exhibit) => exhibit.conceptId === id)
    ? category
    : exploreGalleries.find(
        (view) => view.categoryId !== 'all' && view.exhibits.some((exhibit) => exhibit.conceptId === id),
      );
}
