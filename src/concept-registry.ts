import { concepts, relationships, sources } from './content.ts';
import type { SceneId } from './content.ts';

// Placement is navigation metadata. Empty branches do not invent concept records.
export const exploreCategories = [
  { id: 'all', title: 'Explore', parent: null, concepts: [] },
  { id: 'request', title: 'Request & application', parent: 'all', concepts: ['device', 'response'] },
  { id: 'network', title: 'Network & transport', parent: 'all', concepts: ['router', 'internet'] },
  {
    id: 'serving',
    title: 'Serving infrastructure',
    parent: 'all',
    concepts: ['datacenter', 'ingress', 'rack', 'gpu'],
  },
  { id: 'model', title: 'Model inference', parent: 'all', concepts: ['weights', 'prefill'] },
  {
    id: 'preparation',
    title: 'Context, tokenisation & embeddings',
    parent: 'model',
    concepts: ['context', 'tokenizer', 'embedding'],
  },
  { id: 'blocks', title: 'Transformer blocks', parent: 'model', concepts: ['block'] },
  { id: 'attention', title: 'Attention', parent: 'blocks', concepts: ['attention'] },
  { id: 'mlp', title: 'MLP', parent: 'blocks', concepts: ['mlp'] },
  {
    id: 'normalisation',
    title: 'Normalisation & residuals',
    parent: 'blocks',
    concepts: ['norm', 'residual'],
  },
  { id: 'kv-cache', title: 'KV cache', parent: 'blocks', concepts: ['cache'] },
  {
    id: 'output',
    title: 'Output projection, sampling & decode',
    parent: 'model',
    concepts: ['sampling', 'decode'],
  },
  { id: 'retrieval', title: 'Retrieval', parent: 'all', concepts: [] },
  { id: 'retrieval-embeddings', title: 'Retrieval embeddings', parent: 'retrieval', concepts: [] },
  { id: 'vector-search', title: 'Vector search', parent: 'retrieval', concepts: [] },
  { id: 'rag', title: 'RAG', parent: 'retrieval', concepts: [] },
  { id: 'document-context', title: 'Document / context assembly', parent: 'retrieval', concepts: [] },
  { id: 'tools', title: 'Tools & orchestration', parent: 'all', concepts: [] },
  { id: 'tool-calling', title: 'Function / tool calling', parent: 'tools', concepts: ['intent'] },
  { id: 'mcp', title: 'MCP', parent: 'tools', concepts: ['mcp'] },
  { id: 'host', title: 'Application-host execution', parent: 'tools', concepts: ['host', 'tool-result'] },
  { id: 'web', title: 'Web / search', parent: 'all', concepts: [] },
  {
    id: 'vision',
    title: 'Vision / multimodal understanding',
    parent: 'all',
    concepts: ['image', 'patches', 'fusion'],
  },
  {
    id: 'image-generation',
    title: 'Image generation',
    parent: 'all',
    concepts: ['conditioning', 'noise', 'denoise', 'image-output'],
  },
] as const;

export type CategoryId = (typeof exploreCategories)[number]['id'];
export interface SharedConcept {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly categoryId: CategoryId;
  readonly anchor: { readonly scene: SceneId; readonly conceptId: string };
  readonly sourceIds: readonly string[];
  readonly connectedIds: readonly string[];
  readonly relationships: readonly (typeof relationships)[number][];
}
export interface ExploreReference {
  readonly explanation: string;
  readonly deeper: string;
  readonly input: string;
  readonly output: string;
}

// Omit direct Demo UI instructions, not factual explanations or qualifications.
// The authored source remains untouched and continues to serve Demo as before.
function referenceText(text: string): string {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z])/u)
    .filter(
      (sentence) =>
        !/^(Try |Open |Enter the model view |Select another object |Seek along the timeline |This is the starting point of our journey\.)/.test(
          sentence,
        ),
    )
    .join(' ');
}

const placement = new Map<string, CategoryId>();
for (const category of exploreCategories) for (const id of category.concepts) placement.set(id, category.id);

// Normalized projections of the single authored catalog, not a second content store.
export const conceptRegistry: Readonly<Record<string, SharedConcept>> = Object.fromEntries(
  Object.values(concepts).map((concept) => {
    const edges = relationships.filter((edge) => edge.from === concept.id || edge.to === concept.id);
    return [
      concept.id,
      {
        id: concept.id,
        title: concept.title,
        summary: concept.short,
        categoryId: placement.get(concept.id)!,
        anchor: { scene: concept.scene, conceptId: concept.id },
        sourceIds: concept.sources,
        connectedIds: [
          ...new Set([
            ...concept.related,
            ...edges.map((edge) => (edge.from === concept.id ? edge.to : edge.from)),
          ]),
        ],
        relationships: edges,
      },
    ];
  }),
);

export function exploreReference(id: string): ExploreReference | undefined {
  const concept = concepts[id];
  return (
    concept && {
      explanation: referenceText(concept.description),
      deeper: referenceText(concept.deeper),
      input: concept.input,
      output: concept.output,
    }
  );
}
export function referenceSources(id: string) {
  return conceptRegistry[id]?.sourceIds.map((sourceId) => ({ id: sourceId, ...sources[sourceId] })) ?? [];
}
export function categoryById(id: string) {
  return exploreCategories.find((category) => category.id === id);
}
export function categoryPath(id: CategoryId): (typeof exploreCategories)[number][] {
  const category = categoryById(id)!;
  return category.parent ? [...categoryPath(category.parent), category] : [category];
}
export function childCategories(id: CategoryId) {
  return exploreCategories.filter((category) => category.parent === id);
}
export function categoryConceptCount(id: CategoryId): number {
  return (
    categoryById(id)!.concepts.length +
    childCategories(id).reduce((sum, child) => sum + categoryConceptCount(child.id), 0)
  );
}
export function searchConceptRegistry(query: string): SharedConcept[] {
  const q = query.trim().toLowerCase();
  return Object.values(conceptRegistry).filter((concept) =>
    `${concept.id} ${concept.title} ${concept.summary} ${categoryPath(concept.categoryId)
      .map((c) => c.title)
      .join(' ')}`
      .toLowerCase()
      .includes(q),
  );
}
