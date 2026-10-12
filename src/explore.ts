import {
  categoryById,
  categoryPath,
  childCategories,
  categoryConceptCount,
  conceptRegistry,
  exploreReference,
  referenceSources,
} from './concept-registry.ts';
import { exploreGalleries } from './explore-catalogue.ts';
import { icon } from './icons.ts';
import { usageGraph } from './usage-graph.ts';
import { scenarios } from './content.ts';
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
  onDemoUsage?: (usageId: string) => void;
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
    host.innerHTML = `<section class="explore-atlas" aria-label="Explore 3D atlas">
        <div class="explore-stage"><div id="explore-viewport" class="viewport"></div></div>
        <div id="explore-framing" aria-hidden="true"></div>
        <header class="explore-intro"><span class="eyebrow">THE SPATIAL CATALOGUE</span><h1 id="explore-gallery-title"></h1><p id="explore-view-note" class="small" role="status"></p></header>
        <div class="explore-view-controls">
          <label><span class="sr-only">Gallery</span><select id="explore-view" aria-label="Explore atlas view">${exploreGalleries.map((view) => `<option value="${view.id}">${escape(view.title)}</option>`).join('')}</select></label>
          <div role="group" aria-label="Explore camera tools">
            <button id="explore-reset" class="icon-button" aria-label="Reset Explore view" title="Reset Explore view">${icon('replay')}</button>
            <button id="explore-focus" class="icon-button" aria-label="Focus Explore concept" title="Focus Explore concept" disabled>${icon('focus')}</button>
            <button id="explore-labels" class="icon-button" aria-label="Explore labels" title="Explore labels" aria-pressed="true">${icon('labels')}</button>
          </div>
        </div>
      </section>
      <button id="explore-contents-toggle" class="explore-panel-toggle" aria-controls="explore-contents" aria-expanded="true">${icon('list')} Contents</button>
      <aside id="explore-contents" class="explore-contents panel" aria-label="Explore contents"></aside>
      <button id="explore-reference-toggle" class="explore-panel-toggle" aria-controls="explore-reference" aria-expanded="true" hidden>${icon('info')} Reference</button>
      <article id="explore-reference" class="explore-reference panel" aria-labelledby="explore-reference-title" hidden></article>`;
    host.dataset.contentsOpen = String(!matchMedia('(max-width: 700px)').matches);
    this.applyPanels();
    host.addEventListener('click', (event) => {
      const button = (event.target as HTMLElement).closest<HTMLElement>('button');
      if (button?.id === 'explore-contents-toggle') {
        host.dataset.contentsOpen = String(host.dataset.contentsOpen !== 'true');
        if (matchMedia('(max-width: 700px)').matches) host.dataset.inspectorOpen = 'false';
        this.applyPanels();
      }
      if (button?.id === 'explore-reference-toggle' || button?.id === 'explore-reference-close') {
        host.dataset.inspectorOpen = String(host.dataset.inspectorOpen !== 'true');
        if (matchMedia('(max-width: 700px)').matches) host.dataset.contentsOpen = 'false';
        this.applyPanels();
        host.querySelector<HTMLElement>('#explore-reference-toggle')!.focus();
      }
      if (button?.dataset.exploreCategory) this.navigate({ categoryId: button.dataset.exploreCategory });
      if (button?.dataset.exploreConcept) this.navigate({ conceptId: button.dataset.exploreConcept });
      if (button?.dataset.demoUsage) this.onDemoUsage?.(button.dataset.demoUsage);
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
    this.host.dataset.inspectorOpen = String(!!next.conceptId);
    if (next.conceptId && matchMedia('(max-width: 700px)').matches) this.host.dataset.contentsOpen = 'false';
    this.render();
    reference.scrollTop = this.referenceScroll.get(this.referenceKey()) ?? 0;
    this.onNavigate?.(this.state);
    const heading = this.host.querySelector<HTMLElement>(
      'conceptId' in destination ? '#explore-reference-title' : '#explore-contents-title',
    )!;
    if ('categoryId' in destination) this.host.scrollTop = 0;
    heading.focus({ preventScroll: true });
  }
  private applyPanels() {
    const contents = this.host.dataset.contentsOpen === 'true';
    const reference = this.host.dataset.inspectorOpen === 'true' && !!this.state.conceptId;
    this.host.querySelector<HTMLElement>('.explore-contents')!.hidden = !contents;
    this.host.querySelector<HTMLElement>('.explore-reference')!.hidden = !reference;
    this.host.querySelector('#explore-contents-toggle')!.setAttribute('aria-expanded', String(contents));
    const toggle = this.host.querySelector<HTMLButtonElement>('#explore-reference-toggle')!;
    toggle.hidden = !this.state.conceptId;
    toggle.setAttribute('aria-expanded', String(reference));
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
    this.host.querySelector('#explore-gallery-title')!.textContent =
      categoryId === 'all' ? 'The concept atlas' : category.title;
    this.host.querySelector('.explore-contents')!.innerHTML = `
        <span class="eyebrow">EXPLORE / CONTENTS</span>
        <nav class="explore-breadcrumbs" aria-label="Explore breadcrumbs">${path
          .map(
            (item, i) =>
              `<button data-explore-category="${item.id}" ${i === path.length - 1 ? 'aria-current="page"' : ''}>${escape(item.title)}</button>`,
          )
          .join('<span aria-hidden="true">/</span>')}</nav>
        <h2 id="explore-contents-title" tabindex="-1">${categoryId === 'all' ? 'Categories' : escape(category.title)}</h2>
        <nav aria-label="Explore categories">
          <div class="explore-category-list">${children.map((child) => categoryButton(child.id)).join('')}</div>
          ${category.concepts.length ? `<div class="explore-concept-list">${category.concepts.map((id) => conceptLink(id, conceptId)).join('')}</div>` : ''}
          ${!categoryConceptCount(categoryId) ? '<p class="small">No reference entries yet. This area is reserved for future content.</p>' : ''}
        </nav>`;
    this.host.querySelector('.explore-reference')!.innerHTML = concept
      ? `
        <div class="inspector-top"><span class="eyebrow">CONCEPT REFERENCE</span><button id="explore-reference-close" class="small-icon" aria-label="Close Explore reference">${icon('minus')}</button></div>
        <h1 id="explore-reference-title" tabindex="-1">${escape(concept.title)}</h1>
        ${this.reference(concept.id)}`
      : '';
    this.applyPanels();
  }
  private reference(id: string): string {
    const concept = conceptRegistry[id];
    const reference = exploreReference(id)!;
    const usages = usageGraph.forConcept(id).filter((usage) => usage.workspace === 'DEMO');
    const usageSection = `<section class="concept-usages"><h2>Used in Demo</h2>
      <p class="small">Authored lesson locations. Opening a location does not start a journey.</p>
      ${
        usages.length
          ? Object.values(scenarios)
              .map((scenario) => {
                const locations = usages.filter((usage) => usage.scenarioId === scenario.id);
                return locations.length
                  ? `<details><summary>${escape(scenario.name)} <span class="small">(${locations.length} locations)</span></summary><div class="explore-reference-links">${locations.map((usage) => `<button data-demo-usage="${escape(usage.id)}"><span>${usage.local ? 'On-device' : 'Cloud service'} · Stage ${usage.stageIndex + 1} / ${usage.stageCount} · ${escape(concept.title)}</span><span aria-hidden="true">↗</span></button>`).join('')}</div></details>`
                  : '';
              })
              .join('')
          : '<p class="small">No authored Demo stages currently use this concept.</p>'
      }
    </section>`;
    return `<p class="explore-summary">${escape(concept.summary)}</p>
      <p>${escape(reference.explanation)}</p>
      <h2>Deeper context</h2><p>${escape(reference.deeper)}</p>
      <dl class="io"><div><dt>INPUT</dt><dd>${escape(reference.input)}</dd></div><div><dt>OUTPUT</dt><dd>${escape(reference.output)}</dd></div></dl>
      <p class="explore-note">Conceptual reference, not evidence of a live request. Examples and spatial descriptions refer to the atlas’s illustrative models.</p>
      ${concept.connectedIds.length ? `<section class="related"><h2>Connected concepts</h2><div class="explore-reference-links">${concept.connectedIds.map((related) => conceptLink(related)).join('')}</div></section>` : ''}
      ${usageSection}
      <section><h2>Sources</h2><div class="source-list">${referenceSources(id)
        .map(
          (source) =>
            `<a href="${escape(source.url)}" target="_blank" rel="noreferrer">${escape(source.title)} ↗</a>`,
        )
        .join('')}</div></section>`;
  }
}
