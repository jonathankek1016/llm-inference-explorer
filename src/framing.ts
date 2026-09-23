import type { SceneId } from './content.ts';
import { concepts } from './content.ts';
import type { TraceEvent } from './core.ts';

export type Point3 = readonly [number, number, number];
export type Point2 = readonly [number, number];
export type CalloutRegion = 'auto' | 'upper-left' | 'upper-right' | 'left' | 'right' | 'above' | 'below';
export interface FramingProfile {
  guidedZoom?: number;
  /** World units relative to the subject's existing group origin. */
  anchorOffset?: Point3;
  /** CSS pixels: positive X moves the subject right; positive Y moves it down. */
  compositionOffset?: Point2;
  preferredCalloutRegion?: CalloutRegion;
  /** Pedagogical time before the existing playback-speed multiplier, not inference latency. */
  teachingDurationMs?: number;
}
export interface SceneEntryProfile extends FramingProfile {
  /** Camera position minus tracking target; only used for official scene acquisition. */
  cameraOrientation?: Point3;
}
export interface FramingRegistry {
  defaults?: FramingProfile;
  scenes?: Partial<Record<SceneId, FramingProfile>>;
  subjects?: Partial<Record<SceneId, Record<string, FramingProfile>>>;
  stages?: Record<string, FramingProfile>;
  sceneEntries?: Partial<Record<SceneId, SceneEntryProfile>>;
}
export type ResolvedFraming = SceneEntryProfile & {
  guidedZoom: number;
  anchorOffset: Point3;
  preferredCalloutRegion: CalloutRegion;
};

export const canonicalOrientation: Point3 = [11, 9.7, 14.7];
/** Paste captured stages / sceneEntries here. Omitted fields inherit the layers below. */
export const framingRegistry: FramingRegistry = {
  // Six seconds for a short explanation; conceptual transformations get 8–10s.
  // These are teaching times, never estimates of network or inference latency.
  defaults: {
    guidedZoom: 1.65,
    anchorOffset: [0, 0.8, 0],
    preferredCalloutRegion: 'auto',
    teachingDurationMs: 6000,
  },
  subjects: {
    world: { datacenter: { anchorOffset: [0, 1.4, 0], guidedZoom: 1.35 } },
    compute: { gpu: { teachingDurationMs: 8000 } },
    model: {
      context: { teachingDurationMs: 8000 },
      tokenizer: { teachingDurationMs: 8000 },
      embedding: { teachingDurationMs: 8000 },
      prefill: { teachingDurationMs: 8000 },
      block: { anchorOffset: [0, 2, 0], guidedZoom: 1.35, teachingDurationMs: 10000 },
      cache: { teachingDurationMs: 10000 },
      sampling: { teachingDurationMs: 10000 },
      decode: { teachingDurationMs: 5000 },
    },
    tools: {
      intent: { teachingDurationMs: 8000 },
      host: { teachingDurationMs: 8000 },
      mcp: { teachingDurationMs: 10000 },
    },
    vision: { patches: { teachingDurationMs: 8000 }, fusion: { teachingDurationMs: 10000 } },
    diffusion: {
      conditioning: { teachingDurationMs: 8000 },
      noise: { teachingDurationMs: 8000 },
      denoise: { teachingDurationMs: 8000 },
    },
  },
};

// Route-qualified event identity also distinguishes repeated decode/refinement stages.
export function framingStageKey(event: TraceEvent, local: boolean): string {
  return `${event.scenarioId}:${local ? 'local' : 'cloud'}:${event.id}`;
}

export function resolveFramingProfile(
  scene: SceneId,
  subject: string,
  stage?: string,
  entry = false,
  drafts: FramingRegistry = {},
): ResolvedFraming {
  const profile = {
    ...framingRegistry.defaults,
    ...drafts.defaults,
    ...framingRegistry.scenes?.[scene],
    ...drafts.scenes?.[scene],
    ...framingRegistry.subjects?.[scene]?.[subject],
    ...drafts.subjects?.[scene]?.[subject],
    ...(stage ? framingRegistry.stages?.[stage] : undefined),
    ...(stage ? drafts.stages?.[stage] : undefined),
    ...(entry ? framingRegistry.sceneEntries?.[scene] : undefined),
    ...(entry ? drafts.sceneEntries?.[scene] : undefined),
  } as ResolvedFraming;
  // Even malformed extra orientation metadata on a subject cannot reset an orbit.
  delete profile.cameraOrientation;
  if (entry)
    profile.cameraOrientation =
      drafts.sceneEntries?.[scene]?.cameraOrientation ??
      framingRegistry.sceneEntries?.[scene]?.cameraOrientation ??
      canonicalOrientation;
  return profile;
}

export function resolveComposition(
  profile: FramingProfile,
  card?: { width: number; height: number },
): Point2 {
  // Reserve modest vertical room from the real card, sampled only on explicit focus.
  // Resize/panel observers never recalculate camera composition.
  return profile.compositionOffset ?? [0, card ? Math.min(64, card.height * 0.18) : 0];
}

export function teachingDuration(event: TraceEvent, local: boolean, drafts: FramingRegistry = {}): number {
  const key = framingStageKey(event, local);
  // Timing is stage/subject metadata; scene-entry shot overrides do not change pacing.
  const value = resolveFramingProfile(
    concepts[event.conceptId].scene,
    event.conceptId,
    key,
    false,
    drafts,
  ).teachingDurationMs;
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : event.duration;
}

export function captureFraming(scope: 'stage' | 'entry', key: string, profile: SceneEntryProfile): string {
  const round = (value: number) => Math.round(value * 10000) / 10000;
  const data: SceneEntryProfile = {
    guidedZoom: profile.guidedZoom === undefined ? undefined : round(profile.guidedZoom),
    anchorOffset: profile.anchorOffset?.map(round) as Point3 | undefined,
    compositionOffset: profile.compositionOffset?.map(round) as Point2 | undefined,
    preferredCalloutRegion: profile.preferredCalloutRegion,
    ...(scope === 'entry'
      ? { cameraOrientation: profile.cameraOrientation?.map(round) as Point3 | undefined }
      : {}),
    ...(scope === 'stage' ? { teachingDurationMs: profile.teachingDurationMs } : {}),
  };
  return JSON.stringify({ [scope === 'stage' ? 'stages' : 'sceneEntries']: { [key]: data } }, null, 2);
}
