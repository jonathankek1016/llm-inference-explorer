import { concepts } from './content.ts';
import type { SceneId } from './content.ts';
import type { JourneyControl, TraceEvent } from './core.ts';

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
    cards.unshift({
      id: 'guided',
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

// Conservative two-sided placement, not a collision solver or authored framing.
export function placeCallout(
  anchor: ScreenPoint | undefined,
  width: number,
  height: number,
  bounds: CalloutBounds,
  below = false,
) {
  const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(n, Math.max(min, max)));
  const right = anchor && anchor.x + 28 + width <= bounds.right;
  return {
    x: clamp(
      anchor ? (right ? anchor.x + 28 : anchor.x - width - 28) : bounds.right - width,
      bounds.left,
      bounds.right - width,
    ),
    y: clamp(
      anchor ? (below ? anchor.y + 24 : anchor.y - height - 24) : bounds.top,
      bounds.top,
      bounds.bottom - height,
    ),
  };
}
