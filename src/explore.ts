import {
  categoryById,
  categoryPath,
  childCategories,
  categoryConceptCount,
  conceptRegistry,
  exploreReference,
  referenceSources,
} from './concept-registry.ts';
import type { CategoryId } from './concept-registry.ts';

export interface ExploreState {
  categoryId: CategoryId;
  conceptId: string | null;
}
export type ExploreDestination = { categoryId: string } | { conceptId: string };
export const initialExploreState = (): ExploreState => ({ categoryId: 'all', conceptId: null });
export function navigateExplore(state: ExploreState, destination: ExploreDestination): ExploreState {
  if ('conceptId' in destination) {
    const concept = conceptRegistry[destination.conceptId];
    return concept ? { categoryId: concept.categoryId, conceptId: concept.id } : state;
  }
  const category = categoryById(destination.categoryId);
  return category ? { categoryId: category.id, conceptId: null } : state;
}

const escape = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (c) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[c]!,
  );
const conceptLink = (id: string, current: string | null = null) =>
  `<button data-explore-concept="${escape(id)}" ${id === current ? 'aria-current="page"' : ''}>${escape(conceptRegistry[id].title)}<span aria-hidden="true">↗</span></button>`;

/** Local reference browser only: no journey, renderer, request or Demo callbacks. */
export class ExploreBrowser {
  private state = initialExploreState();
  private readonly host: HTMLElement;
  constructor(host: HTMLElement) {
    this.host = host;
    host.addEventListener('click', (event) => {
      const button = (event.target as HTMLElement).closest<HTMLElement>('button');
      if (button?.dataset.exploreCategory) this.navigate({ categoryId: button.dataset.exploreCategory });
      if (button?.dataset.exploreConcept) this.navigate({ conceptId: button.dataset.exploreConcept });
    });
    this.render();
  }
  openConcept(id: string) {
    this.navigate({ conceptId: id });
  }
  private navigate(destination: ExploreDestination) {
    const next = navigateExplore(this.state, destination);
    if (next === this.state) return;
    this.state = next;
    this.render();
    const heading = this.host.querySelector<HTMLElement>(
      'conceptId' in destination ? '#explore-reference-title' : '#explore-contents-title',
    )!;
    if ('categoryId' in destination) this.host.scrollTop = 0;
    heading.focus({ preventScroll: true });
    heading.scrollIntoView({ block: 'nearest' });
  }
  private render() {
    const { categoryId, conceptId } = this.state;
    const category = categoryById(categoryId)!;
    const path = categoryPath(categoryId);
    const children = childCategories(categoryId);
    const concept = conceptId ? conceptRegistry[conceptId] : undefined;
    this.host.dataset.category = categoryId;
    this.host.dataset.concept = conceptId ?? '';
    const categoryButton = (id: CategoryId) => {
      const item = categoryById(id)!;
      const count = categoryConceptCount(id);
      return `<button data-explore-category="${id}"><span>${escape(item.title)}</span><small>${count ? `${count} concepts` : 'Not yet populated'}</small></button>`;
    };
    this.host.innerHTML = `
      <aside class="explore-contents panel" aria-label="Explore contents">
        <span class="eyebrow">REFERENCE ATLAS</span><h2 id="explore-contents-title" tabindex="-1">Explore</h2>
        <p class="small">Browse concepts at your own pace.</p>
        <nav aria-label="Explore categories">
          ${category.parent ? `<button class="explore-up" data-explore-category="${category.parent}">← ${escape(categoryById(category.parent)!.title)}</button>` : ''}
          <h3>${categoryId === 'all' ? 'Categories' : escape(category.title)}</h3>
          <div class="explore-category-list">${children.map((child) => categoryButton(child.id)).join('')}</div>
          ${category.concepts.length ? `<h3>Concepts</h3><div class="explore-concept-list">${category.concepts.map((id) => conceptLink(id, conceptId)).join('')}</div>` : ''}
          ${!categoryConceptCount(categoryId) ? '<p class="small">No reference entries yet. This area is reserved for future content.</p>' : ''}
        </nav>
      </aside>
      <article class="explore-reference panel" aria-labelledby="explore-reference-title">
        <nav class="explore-breadcrumbs" aria-label="Explore breadcrumbs">${path
          .map(
            (item, i) =>
              `<button data-explore-category="${item.id}" ${!concept && i === path.length - 1 ? 'aria-current="page"' : ''}>${escape(item.title)}</button>`,
          )
          .join(
            '<span aria-hidden="true">/</span>',
          )}${concept ? `<span aria-hidden="true">/</span><span aria-current="page">${escape(concept.title)}</span>` : ''}</nav>
        <span class="eyebrow">${concept ? 'CONCEPT REFERENCE' : 'CONTENTS'}</span>
        <h1 id="explore-reference-title" tabindex="-1">${escape(concept?.title ?? category.title)}</h1>
        ${
          concept
            ? this.reference(concept.id)
            : `
          <p>${categoryConceptCount(categoryId) ? `Browse ${categoryConceptCount(categoryId)} supported concepts${categoryId === 'all' ? ' across the atlas' : ' in this area'}. Choose a category or concept from Contents, or use Find a concept.` : 'Reference material for this area has not been added yet.'}</p>
          <p class="explore-note">This is the reference library. The free 3D atlas view will arrive in a later update.</p>
          ${children.length ? `<div class="explore-category-cards">${children.map((child) => categoryButton(child.id)).join('')}</div>` : ''}
          ${category.concepts.length ? `<div class="explore-reference-links">${category.concepts.map((id) => conceptLink(id)).join('')}</div>` : ''}
        `
        }
      </article>`;
  }
  private reference(id: string): string {
    const concept = conceptRegistry[id];
    const reference = exploreReference(id)!;
    return `<p class="explore-summary">${escape(concept.summary)}</p>
      <p>${escape(reference.explanation)}</p>
      <h2>Deeper context</h2><p>${escape(reference.deeper)}</p>
      <dl class="io"><div><dt>INPUT</dt><dd>${escape(reference.input)}</dd></div><div><dt>OUTPUT</dt><dd>${escape(reference.output)}</dd></div></dl>
      <p class="explore-note">Conceptual reference, not evidence of a live request. Examples and spatial descriptions refer to the atlas’s illustrative models.</p>
      ${concept.connectedIds.length ? `<section class="related"><h2>Connected concepts</h2><div class="explore-reference-links">${concept.connectedIds.map((related) => conceptLink(related)).join('')}</div></section>` : ''}
      <section><h2>Sources</h2><div class="source-list">${referenceSources(id)
        .map(
          (source) =>
            `<a href="${escape(source.url)}" target="_blank" rel="noreferrer">${escape(source.title)} ↗</a>`,
        )
        .join('')}</div></section>`;
  }
}
