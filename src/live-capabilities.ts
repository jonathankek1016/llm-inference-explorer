import { immutableCopy } from './provenance.ts';

export const liveFeatures = [
  'text',
  'streaming',
  'cancellation',
  'boundedContext',
  'usage',
  'finishReason',
  'logprobs',
  'imageText',
  'imageGeneration',
  'toolCalling',
  'mcp',
  'rag',
  'webSearch',
  'generatedMedia',
] as const;
export type LiveFeature = (typeof liveFeatures)[number];
export type CapabilitySupport = 'SUPPORTED' | 'UNSUPPORTED' | 'UNKNOWN';
export interface CapabilityAssertion {
  readonly support: CapabilitySupport;
  readonly origin: 'ADAPTER_CONTRACT' | 'BACKEND_DECLARATION' | 'UNADVERTISED';
}
export interface LiveCapabilities {
  readonly adapterId: 'chat-completions-text' | 'chat-completions-image' | 'image-generation';
  readonly adapter: Readonly<Record<LiveFeature, CapabilityAssertion>>;
  readonly backend: Readonly<Record<LiveFeature, CapabilityAssertion>>;
}

/** Transport support is not proof that an arbitrary configured endpoint supports it. */
export function textCapabilities(
  declarations: Partial<Record<LiveFeature, CapabilitySupport>> = {},
): LiveCapabilities {
  const supported = new Set<LiveFeature>([
    'text',
    'streaming',
    'cancellation',
    'boundedContext',
    'usage',
    'finishReason',
    'logprobs',
  ]);
  return immutableCopy({
    adapterId: 'chat-completions-text',
    adapter: Object.fromEntries(
      liveFeatures.map((feature) => [
        feature,
        {
          support: supported.has(feature) ? 'SUPPORTED' : 'UNSUPPORTED',
          origin: 'ADAPTER_CONTRACT',
        },
      ]),
    ) as Record<LiveFeature, CapabilityAssertion>,
    backend: Object.fromEntries(
      liveFeatures.map((feature) => [
        feature,
        {
          support: declarations[feature] ?? 'UNKNOWN',
          origin: declarations[feature] ? 'BACKEND_DECLARATION' : 'UNADVERTISED',
        },
      ]),
    ) as Record<LiveFeature, CapabilityAssertion>,
  });
}

export function checkTextCapabilities(
  profile: LiveCapabilities,
  options: { stream: boolean; logprobs: boolean },
) {
  const requested: LiveFeature[] = [
    'text',
    ...(options.stream ? ['streaming' as const] : []),
    ...(options.logprobs ? ['logprobs' as const] : []),
  ];
  return requested.filter(
    (feature) =>
      profile.adapter[feature].support !== 'SUPPORTED' || profile.backend[feature].support === 'UNSUPPORTED',
  );
}

/** Image features require positive, connection-scoped declarations; unknown stays disabled. */
export function mediaCapabilities(
  kind: 'IMAGE_UNDERSTANDING' | 'IMAGE_GENERATION',
  declarations: Partial<Record<LiveFeature, CapabilitySupport>> = {},
): LiveCapabilities {
  const base = textCapabilities(declarations);
  const features: LiveFeature[] =
    kind === 'IMAGE_UNDERSTANDING'
      ? ['text', 'imageText', 'streaming', 'cancellation', 'usage', 'finishReason', 'logprobs']
      : ['imageGeneration', 'generatedMedia', 'cancellation', 'usage'];
  return immutableCopy({
    ...base,
    adapterId: kind === 'IMAGE_UNDERSTANDING' ? 'chat-completions-image' : 'image-generation',
    adapter: Object.fromEntries(
      liveFeatures.map((f) => [
        f,
        { support: features.includes(f) ? 'SUPPORTED' : 'UNSUPPORTED', origin: 'ADAPTER_CONTRACT' },
      ]),
    ) as Record<LiveFeature, CapabilityAssertion>,
  });
}
export function checkMediaCapabilities(
  profile: LiveCapabilities,
  kind: 'IMAGE_UNDERSTANDING' | 'IMAGE_GENERATION',
  options: { stream: boolean; logprobs: boolean },
) {
  const requested: LiveFeature[] =
    kind === 'IMAGE_GENERATION'
      ? ['imageGeneration', 'generatedMedia']
      : [
          'imageText',
          ...(options.stream ? ['streaming' as const] : []),
          ...(options.logprobs ? ['logprobs' as const] : []),
        ];
  return requested.filter(
    (f) => profile.adapter[f].support !== 'SUPPORTED' || profile.backend[f].support !== 'SUPPORTED',
  );
}
