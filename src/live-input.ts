import type { ProviderConfig } from './provider.ts';
import type { CapabilitySupport, LiveFeature } from './live-capabilities.ts';
export type LiveRequestType = 'TEXT' | 'IMAGE_UNDERSTANDING' | 'IMAGE_GENERATION';
export interface LiveMediaConfiguration {
  /** Declarations apply only to this exact connection and models. No brand/model heuristics. */
  url: string;
  model: string;
  generationModel: string;
  imageText: CapabilitySupport;
  streaming: CapabilitySupport;
  logprobs: CapabilitySupport;
  imageGeneration: CapabilitySupport;
  generatedMedia: CapabilitySupport;
}
export interface LiveConfiguration extends ProviderConfig {
  media?: LiveMediaConfiguration;
}
export function mediaDeclarations(
  config: LiveConfiguration,
): Partial<Record<LiveFeature, CapabilitySupport>> {
  const m = config.media;
  return m && m.url === config.url && m.model === config.model
    ? {
        imageText: m.imageText,
        streaming: m.streaming,
        logprobs: m.logprobs,
        imageGeneration: m.imageGeneration,
        generatedMedia: m.generatedMedia,
      }
    : {};
}
