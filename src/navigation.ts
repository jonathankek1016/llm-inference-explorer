import type { GuidedFocus } from './core.ts';

export interface NavigationPreferences {
  past: 'guided' | 'compare';
  future: 'guided' | 'compare';
}

export function readNavigationPreferences(value: unknown): NavigationPreferences {
  const saved = value && typeof value === 'object' ? (value as Partial<NavigationPreferences>) : {};
  return {
    past: saved.past === 'guided' ? 'guided' : 'compare',
    future: saved.future === 'compare' ? 'compare' : 'guided',
  };
}

export type NavigationIntent =
  | { kind: 'row'; from: number; to: number }
  | { kind: 'step' }
  | { kind: 'concept'; subject: string; destination: string }
  | { kind: 'scene' };

/** Row policy changes official ownership; exploration only changes attachment. */
export function navigationFocus(
  intent: NavigationIntent,
  current: GuidedFocus,
  preferences: NavigationPreferences,
): GuidedFocus {
  switch (intent.kind) {
    case 'row':
      if (intent.from === intent.to) return current;
      return preferences[intent.to < intent.from ? 'past' : 'future'] === 'guided' ? 'TRACKING' : 'DETACHED';
    case 'scene':
      return 'DETACHED';
    case 'concept':
      return intent.subject === intent.destination ? current : 'DETACHED';
    case 'step':
      return current;
  }
}
