import { concepts, scenarios } from './content.ts';
import type { Evidence, SceneId } from './content.ts';

export type JourneyMode = 'MANUAL' | 'AUTO';
export type GuidedFocus = 'TRACKING' | 'DETACHED';
export interface JourneyControl {
  active: boolean;
  journeyMode: JourneyMode;
  guidedFocus: GuidedFocus;
  playbackRequested: boolean;
}
export type JourneyAction =
  | { type: 'SET_MODE'; mode: JourneyMode }
  | { type: 'START' | 'NAVIGATE' | 'PLAY' | 'PAUSE' | 'DETACH' | 'RESUME' };

export function createJourneyControl(): JourneyControl {
  // Preserve the existing ready-to-play replay, without starting a timer on load.
  return { active: false, journeyMode: 'AUTO', guidedFocus: 'TRACKING', playbackRequested: false };
}

export function transitionJourney(state: JourneyControl, action: JourneyAction): JourneyControl {
  switch (action.type) {
    case 'SET_MODE':
      return {
        ...state,
        active: state.active || action.mode === 'AUTO',
        journeyMode: action.mode,
        playbackRequested: action.mode === 'AUTO',
      };
    case 'START':
      return {
        ...state,
        active: true,
        guidedFocus: 'TRACKING',
        playbackRequested: state.journeyMode === 'AUTO',
      };
    case 'NAVIGATE':
      return { ...state, active: true };
    case 'PLAY':
      return { ...state, active: true, playbackRequested: state.journeyMode === 'AUTO' };
    case 'PAUSE':
      return { ...state, playbackRequested: false };
    case 'DETACH':
      return state.active ? { ...state, guidedFocus: 'DETACHED' } : state;
    case 'RESUME':
      return state.active
        ? { ...state, guidedFocus: 'TRACKING', playbackRequested: state.journeyMode === 'AUTO' }
        : state;
  }
}

export function journeyAdvancing(state: JourneyControl): boolean {
  return (
    state.active &&
    state.journeyMode === 'AUTO' &&
    state.guidedFocus === 'TRACKING' &&
    state.playbackRequested
  );
}

export interface TraceEvent {
  runId: number;
  scenarioId: string;
  id: string;
  kind: string;
  source: Evidence;
  conceptId: string;
  duration: number;
  receivedAt?: number;
  payload: Record<string, unknown>;
}
export function makeTrace(scenarioId: string, local = false, runId = 0): TraceEvent[] {
  const steps = scenarios[scenarioId].steps.filter(
    (id) => !local || !['router', 'internet', 'datacenter', 'ingress', 'rack'].includes(id),
  );
  let decode = 0,
    refine = 0;
  return steps.map((id, i) => ({
    runId,
    scenarioId,
    id: `${scenarioId}-${i}`,
    kind: id,
    source: 'Illustrative',
    conceptId: id,
    duration: 2600,
    payload: {
      decode: id === 'decode' ? ++decode : 0,
      refinement: id === 'denoise' ? ++refine : 0,
      ...(id === 'mcp' ? { tool: 'multiply', arguments: [24, 7], result: 168, simulated: true } : {}),
    },
  }));
}
export function frameAt(trace: TraceEvent[], position: number) {
  const index = Math.max(0, Math.min(trace.length - 1, Math.floor(Number.isFinite(position) ? position : 0)));
  const event = trace[index];
  return {
    index,
    event,
    scene: concepts[event.conceptId].scene as SceneId,
    decode: trace.slice(0, index + 1).filter((e) => e.kind === 'decode').length,
    refinement: trace.slice(0, index + 1).filter((e) => e.kind === 'denoise').length,
  };
}
export function toyEncode(text: string): number[] {
  return Array.from(new TextEncoder().encode(text));
}
export function toyDecode(ids: number[]): string {
  return new TextDecoder().decode(Uint8Array.from(ids));
}
export function distribution(logits: number[], temperature: number): number[] {
  if (!logits.length || logits.some((n) => !Number.isFinite(n))) throw new Error('Finite logits required');
  if (!Number.isFinite(temperature) || temperature < 0) throw new Error('Non-negative temperature required');
  const max = Math.max(...logits);
  if (temperature === 0) return logits.map((_, i) => (i === logits.indexOf(max) ? 1 : 0));
  const weights = logits.map((n) => Math.exp((n - max) / temperature));
  const sum = weights.reduce((a, b) => a + b, 0);
  return weights.map((n) => n / sum);
}
export function randomSeed(seed: number): number {
  let t = (seed + 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
export function sample(probabilities: number[], seed: number): number {
  let r = randomSeed(seed);
  for (let i = 0; i < probabilities.length; i++) {
    r -= probabilities[i];
    if (r < 0) return i;
  }
  return probabilities.length - 1;
}
export class RunGate {
  generation = 0;
  controller?: AbortController;
  status: 'idle' | 'running' | 'completed' | 'cancelled' | 'error' = 'idle';
  start() {
    this.controller?.abort();
    this.controller = new AbortController();
    this.status = 'running';
    return { id: ++this.generation, signal: this.controller.signal };
  }
  current(id: number) {
    return id === this.generation && this.status === 'running';
  }
  finish(id: number, state: 'completed' | 'error') {
    if (!this.current(id)) return false;
    this.status = state;
    return true;
  }
  cancel() {
    this.controller?.abort();
    this.generation++;
    this.status = 'cancelled';
  }
}
export interface Message {
  role: 'user' | 'assistant';
  content: string;
  mode: 'demo' | 'live' | 'legacy';
  state?: string;
}
export function boundedContext(history: Message[], prompt: string) {
  const pairs: { role: string; content: string }[][] = [];
  for (let i = 0; i < history.length - 1; i++) {
    const a = history[i],
      b = history[i + 1];
    if (
      a.role === 'user' &&
      b.role === 'assistant' &&
      a.mode === 'live' &&
      b.mode === 'live' &&
      b.state === 'completed'
    )
      pairs.push([
        { role: a.role, content: a.content },
        { role: b.role, content: b.content },
      ]);
  }
  const selected: { role: string; content: string }[] = [];
  let budget = 12000 - prompt.length;
  for (const pair of pairs.slice(-4).reverse()) {
    const size = pair.reduce((n, m) => n + m.content.length, 0);
    if (size > budget) break;
    selected.unshift(...pair);
    budget -= size;
  }
  return [
    { role: 'system', content: 'You are a helpful assistant. Keep your response clear and concise.' },
    ...selected,
    { role: 'user', content: prompt },
  ];
}
