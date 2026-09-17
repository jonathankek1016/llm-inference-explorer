import type { SceneId } from './content.ts';

export type Point3 = readonly [number, number, number];
export interface FocusFraming {
  target: Point3;
  zoom: number;
}

// Same established focus framing; the larger building and tall logical stack
// get conservative breathing room. Offsets belong here, not in UI handlers.
const defaultFraming = { offset: [0, 0.8, 0] as Point3, zoom: 1.65 };
const guidedFraming: Partial<Record<SceneId, Record<string, typeof defaultFraming>>> = {
  world: { datacenter: { offset: [0, 1.4, 0], zoom: 1.35 } },
  model: { block: { offset: [0, 2, 0], zoom: 1.35 } },
};

export function resolveGuidedFraming(
  scene: SceneId,
  subject: string,
  position?: Point3,
): FocusFraming | undefined {
  if (!position) return undefined;
  const { offset, zoom } = guidedFraming[scene]?.[subject] ?? defaultFraming;
  return { target: [position[0] + offset[0], position[1] + offset[1], position[2] + offset[2]], zoom };
}

export function focusEase(seconds: number, reducedMotion = false): number {
  return reducedMotion ? 1 : 1 - Math.exp(-Math.max(0, seconds) * 7);
}
