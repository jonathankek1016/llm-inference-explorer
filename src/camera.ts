import type { SceneId } from './content.ts';
import { resolveFramingProfile } from './framing.ts';
import type { ResolvedFraming } from './framing.ts';

export type Point3 = readonly [number, number, number];
export interface FocusFraming {
  target: Point3;
  zoom: number;
}

export function resolveGuidedFraming(
  scene: SceneId,
  subject: string,
  position?: Point3,
  profile: ResolvedFraming = resolveFramingProfile(scene, subject),
): FocusFraming | undefined {
  if (!position) return undefined;
  const { anchorOffset: offset, guidedZoom: zoom } = profile;
  return { target: [position[0] + offset[0], position[1] + offset[1], position[2] + offset[2]], zoom };
}

export function focusEase(seconds: number, reducedMotion = false): number {
  return reducedMotion ? 1 : 1 - Math.exp(-Math.max(0, seconds) * 7);
}
