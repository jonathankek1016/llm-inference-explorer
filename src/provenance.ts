/** Evidence classifications describe knowledge, not animation or execution state. */
export type Evidence<T> =
  | {
      readonly kind: 'OBSERVED';
      readonly source: 'APPLICATION' | 'PROVIDER';
      readonly basis: string;
      readonly value: T;
    }
  | {
      readonly kind: 'LOCALLY_CALCULATED';
      readonly source: 'APPLICATION';
      readonly basis: string;
      readonly value: T;
    }
  | { readonly kind: 'ILLUSTRATIVE'; readonly source: 'AUTHORED'; readonly basis: string; readonly value: T }
  | {
      readonly kind: 'INFERRED_REPRESENTATIVE';
      readonly source: 'INTERPRETATION';
      readonly basis: string;
      readonly value: T;
    }
  | {
      readonly kind: 'UNKNOWN';
      readonly source: 'UNAVAILABLE';
      readonly basis: string;
      readonly value?: never;
    };

export const observed = <T>(value: T, source: 'APPLICATION' | 'PROVIDER', basis: string): Evidence<T> => ({
  kind: 'OBSERVED',
  source,
  basis,
  value,
});
export const calculated = <T>(value: T, basis: string): Evidence<T> => ({
  kind: 'LOCALLY_CALCULATED',
  source: 'APPLICATION',
  basis,
  value,
});
export const unknown = <T>(basis: string): Evidence<T> => ({ kind: 'UNKNOWN', source: 'UNAVAILABLE', basis });

/** Guard normalized evidence before accepting it from future adapters. */
export function validEvidence(value: unknown): value is Evidence<unknown> {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  if (typeof item.basis !== 'string' || !item.basis.trim()) return false;
  if (item.kind === 'UNKNOWN') return item.source === 'UNAVAILABLE' && !('value' in item);
  if (!('value' in item) || item.value === undefined) return false;
  switch (item.kind) {
    case 'OBSERVED':
      return item.source === 'APPLICATION' || item.source === 'PROVIDER';
    case 'LOCALLY_CALCULATED':
      return item.source === 'APPLICATION';
    case 'ILLUSTRATIVE':
      return item.source === 'AUTHORED';
    case 'INFERRED_REPRESENTATIVE':
      return item.source === 'INTERPRETATION';
    default:
      return false;
  }
}

/** Snapshots never lend mutable payloads to callers or retain caller-owned objects. */
export function immutableCopy<T>(value: T): T {
  const copy = structuredClone(value);
  const freeze = (item: unknown) => {
    if (item && typeof item === 'object') {
      for (const child of Object.values(item)) freeze(child);
      Object.freeze(item);
    }
  };
  freeze(copy);
  return copy;
}
