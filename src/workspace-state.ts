import type { AtlasScene } from './scene.ts';
import type { ExplorationCallout } from './callouts.ts';

/** Visual bookmarks only. Journey, global admission and requests have other owners.
 * Demo retains its existing coordinator/AtlasScene; Explore owns this independent store. */
export interface ExplorePresentation {
  gallery: string;
  selected: string | null;
  labels: boolean;
  pins: ExplorationCallout<string>[];
  views: Map<string, ReturnType<AtlasScene['captureView']>>;
}
export const createExplorePresentation = (): ExplorePresentation => ({
  gallery: 'catalogue:all',
  selected: null,
  labels: true,
  pins: [],
  views: new Map(),
});
