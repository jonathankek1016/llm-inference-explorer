import {
  categoryById,
  categoryPath,
  childCategories,
  categoryConceptCount,
  conceptRegistry,
  exploreReference,
  referenceSources,
} from './concept-registry.ts';
import { exploreRooms } from './workspace-state.ts';
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

/** Canonical reference state, independent of Demo and global guided sessions. */
export class ExploreBrowser {
  private state = initialExploreState();
  onNavigate?: (state: ExploreState) => void;
  private referenceScroll = new Map<string, number>();
  private referenceKey() {
    return this.state.conceptId ? `concept:${this.state.conceptId}` : `category:${this.state.categoryId}`;
  }
  get selection(): Readonly<ExploreState> {
    return this.state;
  }
  private readonly host: HTMLElement;
  constructor(host: HTMLElement) {
    this.host = host;
    // Stable mounts: browsing reference content must never reconstruct the viewport.
    host.innerHTML = `<aside class="explore-contents panel" aria-label="Explore contents"></aside>
      <section class="explore-atlas" aria-label="Explore 3D atlas">
        <div class="explore-view-controls">
          <label>Atlas view <select id="explore-view" aria-label="Explore atlas view">${exploreRooms.map((room) => `<option value="${room.scene}">${room.title}</option>`).join('')}</select></label>
          <div role="group" aria-label="Explore camera tools">
            <button id="explore-reset" title="Reset Explore view">Reset</button>
            <button id="explore-focus" disabled>Focus</button>
            <button id="explore-labels" aria-pressed="true">Labels</button>
          </div>
        </div>
        <div class="explore-stage"><div id="explore-viewport" class="viewport"></div></div>
        <p id="explore-view-note" class="small" role="status">Drag to orbit · Scroll to zoom · Right-drag to pan</p>
      </section>
      <article class="explore-reference panel" aria-labelledby="explore-reference-title"></article>`;
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
  openCategory(id: string) {
    this.navigate({ categoryId: id });
  }
  private navigate(destination: ExploreDestination) {
    const next = navigateExplore(this.state, destination);
    if (next === this.state) return;
    const reference = this.host.querySelector<HTMLElement>('.explore-reference')!;
    this.referenceScroll.set(this.referenceKey(), reference.scrollTop);
    this.state = next;
    this.render();
    reference.scrollTop = this.referenceScroll.get(this.referenceKey()) ?? 0;
    this.onNavigate?.(this.state);
    const heading = this.host.querySelector<HTMLElement>(
      'conceptId' in destination ? '#explore-reference-title' : '#explore-contents-title',
    )!;
    if ('categoryId' in destination) this.host.scrollTop = 0;
    heading.focus({ preventScroll: true });
    if (matchMedia('(max-width: 980px)').matches) heading.scrollIntoView({ block: 'nearest' });
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
    this.host.querySelector('.explore-contents')!.innerHTML = `
        <span class="eyebrow">REFERENCE ATLAS</span><h2 id="explore-contents-title" tabindex="-1">Explore</h2>
        <p class="small">Browse concepts at your own pace.</p>
        <nav aria-label="Explore categories">
          ${category.parent ? `<button class="explore-up" data-explore-category="${category.parent}">← ${escape(categoryById(category.parent)!.title)}</button>` : ''}
          <h3>${categoryId === 'all' ? 'Categories' : escape(category.title)}</h3>
          <div class="explore-category-list">${children.map((child) => categoryButton(child.id)).join('')}</div>
          ${category.concepts.length ? `<h3>Concepts</h3><div class="explore-concept-list">${category.concepts.map((id) => conceptLink(id, conceptId)).join('')}</div>` : ''}
          ${!categoryConceptCount(categoryId) ? '<p class="small">No reference entries yet. This area is reserved for future content.</p>' : ''}
        </nav>
      `;
    this.host.querySelector('.explore-reference')!.innerHTML = `
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
          <p class="explore-note">Browse the atlas alongside this reference. Areas without models remain available as reference categories.</p>
          ${children.length ? `<div class="explore-category-cards">${children.map((child) => categoryButton(child.id)).join('')}</div>` : ''}
          ${category.concepts.length ? `<div class="explore-reference-links">${category.concepts.map((id) => conceptLink(id)).join('')}</div>` : ''}
        `
        }
      `;
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
