import { concepts } from './content.ts';
import type { SceneId } from './content.ts';
import type { JourneyControl, TraceEvent } from './core.ts';
import type { CalloutRegion } from './framing.ts';

export interface ExplorationCallout {
  conceptId: string;
  scene: SceneId;
}
export interface Callout extends ExplorationCallout {
  id: string;
  role: 'guided' | 'exploratory';
  title: string;
  summary: string;
  position?: string;
  detail?: string;
  detached?: boolean;
  preferredCalloutRegion?: CalloutRegion;
}

// One remembered reference per concept; reopening raises it and remembers its view.
export function openCallout(
  open: readonly ExplorationCallout[],
  conceptId: string,
  scene: SceneId,
): ExplorationCallout[] {
  if (!concepts[conceptId]) return [...open];
  return [...open.filter((item) => item.conceptId !== conceptId), { conceptId, scene }];
}

export function calloutPresentation(
  journey: JourneyControl,
  event: TraceEvent,
  index: number,
  total: number,
  exploration: readonly ExplorationCallout[],
): Callout[] {
  const cards: Callout[] = exploration.map((item) => ({
    ...item,
    id: `explore-${item.conceptId}`,
    role: 'exploratory',
    title: concepts[item.conceptId].title,
    summary: concepts[item.conceptId].short,
    detail: concepts[item.conceptId].description.split(/(?<=[.!?])\s+/)[0],
  }));
  if (journey.active) {
    const concept = concepts[event.conceptId];
    // Presentation ownership changes, but the remembered exploratory pin does not.
    // Reuse its key so the same card can return to its original view after guidance.
    const pinned = cards.findIndex((card) => card.conceptId === concept.id);
    const id = pinned >= 0 ? cards.splice(pinned, 1)[0].id : 'guided';
    cards.unshift({
      id,
      role: 'guided',
      conceptId: concept.id,
      scene: concept.scene,
      title: concept.title,
      summary: concept.description
        .split(/(?<=[.!?])\s+/)
        .slice(0, 2)
        .join(' '),
      position: `${index + 1} / ${total}`,
      detail:
        event.kind === 'decode'
          ? `Pass ${event.payload.decode}`
          : event.kind === 'denoise'
            ? `Refinement ${event.payload.refinement}`
            : undefined,
      detached: journey.guidedFocus === 'DETACHED',
    });
  }
  return cards;
}

export interface ScreenPoint {
  x: number;
  y: number;
  visible: boolean;
}
export interface CalloutBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface CalloutRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Small local alternatives only. Preferred placement/side remains authoritative;
// an unsolvable cluster may overlap rather than sending cards across the scene.
export function relieveCalloutCrowding(
  base: CalloutRect,
  anchor: ScreenPoint | undefined,
  bounds: CalloutBounds,
  occupied: readonly CalloutRect[],
) {
  const offsets = [
    [0, 0],
    [0, -48],
    [0, 48],
    [-48, 0],
    [48, 0],
    [-48, -48],
    [48, -48],
    [-48, 48],
    [48, 48],
    [0, -96],
    [0, 96],
    [-96, 0],
    [96, 0],
  ];
  const score = (candidate: CalloutRect) =>
    occupied.reduce(
      (area, other) =>
        area +
        Math.max(
          0,
          Math.min(candidate.x + candidate.width, other.x + other.width + 8) -
            Math.max(candidate.x, other.x - 8),
        ) *
          Math.max(
            0,
            Math.min(candidate.y + candidate.height, other.y + other.height + 8) -
              Math.max(candidate.y, other.y - 8),
          ),
      0,
    ) +
    Math.hypot(candidate.x - base.x, candidate.y - base.y) * 12;
  let best = base;
  let bestScore = score(base);
  for (const [dx, dy] of offsets.slice(1)) {
    const candidate = {
      ...base,
      x: Math.max(bounds.left, Math.min(base.x + dx, bounds.right - base.width)),
      y: Math.max(bounds.top, Math.min(base.y + dy, bounds.bottom - base.height)),
    };
    // Do not cross the subject to evade another card. Clamping may already have
    // compromised one axis; retain every side that the baseline can respect.
    if (
      anchor &&
      ((base.x >= anchor.x + 28 && candidate.x < anchor.x + 28) ||
        (base.x + base.width <= anchor.x - 28 && candidate.x + base.width > anchor.x - 28) ||
        (base.y >= anchor.y + 24 && candidate.y < anchor.y + 24) ||
        (base.y + base.height <= anchor.y - 24 && candidate.y + base.height > anchor.y - 24))
    )
      continue;
    const candidateScore = score(candidate);
    if (candidateScore < bestScore) {
      best = candidate;
      bestScore = candidateScore;
    }
  }
  return best;
}

// Conservative two-sided placement, not a collision solver or authored framing.
export function placeCallout(
  anchor: ScreenPoint | undefined,
  width: number,
  height: number,
  bounds: CalloutBounds,
  below = false,
  region: CalloutRegion = 'auto',
) {
  const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(n, Math.max(min, max)));
  const right = anchor && anchor.x + 28 + width <= bounds.right;
  let x = anchor ? (right ? anchor.x + 28 : anchor.x - width - 28) : bounds.right - width;
  let y = anchor ? (below ? anchor.y + 24 : anchor.y - height - 24) : bounds.top;
  if (anchor && region !== 'auto') {
    if (region === 'above' || region === 'below') x = anchor.x - width / 2;
    else x = region.includes('left') ? anchor.x - width - 28 : anchor.x + 28;
    y =
      region === 'below'
        ? anchor.y + 24
        : region.startsWith('upper') || region === 'above'
          ? anchor.y - height - 24
          : anchor.y - height / 2;
  }
  return {
    x: clamp(x, bounds.left, bounds.right - width),
    y: clamp(y, bounds.top, bounds.bottom - height),
  };
}
