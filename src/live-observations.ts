/** Normalized evidence, independent of provider wire formats. No executor or capability inference. */
export interface ToolObservation {
  readonly kind: 'tool-call';
  /** Adapter-local key within one request; not a provider ID or educational session ID. */
  readonly key: string;
  readonly providerCallId?: string;
  readonly name?: string;
  readonly arguments?: string;
  readonly phase: 'PARTIAL' | 'RETURNED';
  readonly truncated: boolean;
  readonly executionOwner: 'UNKNOWN';
  readonly execution: 'NOT_OBSERVED';
}
export interface SourceObservation {
  readonly kind: 'source-reference';
  readonly key: string;
  readonly url: string;
  readonly title?: string;
  readonly startIndex?: number;
  readonly endIndex?: number;
  /** A citation is not proof of search or retrieval execution. */
  readonly acquisition: 'UNKNOWN';
}
export type ProviderObservation = ToolObservation | SourceObservation;

export function safeSourceUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 4096) return;
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return;
    return url.href;
  } catch {
    return;
  }
}
