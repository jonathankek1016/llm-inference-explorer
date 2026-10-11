import type { SceneId } from './content.ts';
import type { AtlasScene } from './scene.ts';
import type { ExplorationCallout } from './callouts.ts';
import { categoryPath, conceptRegistry } from './concept-registry.ts';
import type { CategoryId } from './concept-registry.ts';

/** Visual bookmarks only. Journey, global admission and requests have other owners.
 * Demo retains its existing coordinator/AtlasScene; Explore owns this independent store. */
export interface ExplorePresentation {
  scene: SceneId;
  selected: string | null;
  labels: boolean;
  pins: ExplorationCallout[];
  views: Map<SceneId, ReturnType<AtlasScene['captureView']>>;
}
export const createExplorePresentation = (): ExplorePresentation => ({
  scene: 'world',
  selected: null,
  labels: true,
  pins: [],
  views: new Map(),
});

export const exploreRooms: readonly { scene: SceneId; category: CategoryId; title: string }[] = [
  { scene: 'world', category: 'request', title: 'Overview' },
  { scene: 'compute', category: 'serving', title: 'Hardware' },
  { scene: 'model', category: 'model', title: 'Model' },
  { scene: 'block', category: 'blocks', title: 'Block' },
  { scene: 'tools', category: 'tools', title: 'Tools' },
  { scene: 'vision', category: 'vision', title: 'Vision' },
  { scene: 'diffusion', category: 'image-generation', title: 'Image generation' },
];
export function exploreCategoryScene(category: CategoryId): SceneId | undefined {
  if (category === 'all' || category === 'network') return 'world';
  return [...categoryPath(category)]
    .reverse()
    .map((item) => exploreRooms.find((room) => room.category === item.id)?.scene)
    .find((scene) => scene !== undefined);
}
// These anchors are candidates from shared content, not promises of geometry.
// ExploreAtlas verifies the actual nodes before focusing or opening a pin.
export const exploreConceptScene = (id: string): SceneId | undefined => conceptRegistry[id]?.anchor.scene;
