import type { AtlasScene } from './scene.ts';
import type { ExploreBrowser, ExploreState } from './explore.ts';
import { conceptRegistry } from './concept-registry.ts';
import { openCallout } from './callouts.ts';
import { createExplorePresentation } from './workspace-state.ts';
import { categoryGallery, conceptGallery, exploreGalleries } from './explore-catalogue.ts';
import type { ExploreCategoryView } from './explore-catalogue.ts';

/** Explore owns only visual/reference state. It has no journey or session port. */
export class ExploreAtlas {
  readonly scene: AtlasScene;
  readonly presentation = createExplorePresentation();
  private spatialSelection = false;
  private readonly host: HTMLElement;
  private readonly browser: ExploreBrowser;
  private readonly toolbarClick: (event: Event) => void;
  private readonly viewChange: () => void;

  constructor(Scene: typeof AtlasScene, host: HTMLElement, browser: ExploreBrowser, failure: () => void) {
    this.host = host;
    this.browser = browser;
    const viewport = host.querySelector<HTMLElement>('#explore-viewport')!;
    const framing = host.querySelector<HTMLElement>('#explore-framing')!;
    this.scene = new Scene(
      viewport,
      (id) => this.inspectSpatial(id),
      () => {},
      failure,
      {
        framing,
        gallery: exploreGalleries[0],
        accessibleLabel:
          'Explore 3D atlas. Orbit, pan and zoom freely. Use Contents or object labels to select concepts.',
        annotations: {
          namespace: 'explore-',
          labelRoot: viewport,
          panels: [...host.querySelectorAll<HTMLElement>('.explore-contents, .explore-reference')],
          bounds: () => {
            // The full canvas includes floating panels; keep desktop cards in the
            // same clear area used for framing, without changing crowding rules.
            const frame = framing.getBoundingClientRect();
            const origin = viewport.getBoundingClientRect();
            const tools = host.querySelector('.explore-view-controls')!.getBoundingClientRect();
            return {
              left: Math.max(12, frame.left - origin.left),
              right: Math.min(origin.width - 12, frame.right - origin.left),
              top: frame.top - origin.top,
              bottom: tools.top - origin.top - 16,
            };
          },
        },
      },
    );
    this.scene.setSelected('');
    // Defaults are neutral and flow-free; no foreign journey state is passed in.
    this.scene.setGuidedEmphasis(false);
    this.scene.setTeachingFlow(false, false);
    host
      .querySelectorAll<HTMLButtonElement | HTMLSelectElement>('.explore-view-controls button, #explore-view')
      .forEach((control) => {
        control.disabled = false;
      });
    this.toolbarClick = (event) => {
      const id = (event.target as HTMLElement).closest('button')?.id;
      if (id === 'explore-reset') this.scene.reset();
      if (id === 'explore-focus') this.scene.focus();
      if (id === 'explore-labels') {
        this.presentation.labels = !this.presentation.labels;
        this.scene.setLabels(this.presentation.labels);
        host.querySelector('#explore-labels')!.setAttribute('aria-pressed', String(this.presentation.labels));
      }
    };
    this.viewChange = () => {
      const view = host.querySelector<HTMLSelectElement>('#explore-view')!.value;
      browser.openCategory(exploreGalleries.find((gallery) => gallery.id === view)!.categoryId);
    };
    host.addEventListener('click', this.toolbarClick);
    host.querySelector('#explore-view')!.addEventListener('change', this.viewChange);
    browser.onNavigate = (state) => this.navigate(state);
    this.navigate(browser.selection);
  }

  private inspectSpatial(id: string) {
    // Shared exhibits may appear in several galleries; stay in the clicked gallery.
    this.spatialSelection = true;
    try {
      this.browser.openConcept(id);
    } finally {
      this.spatialSelection = false;
    }
  }

  private showScene(view: ExploreCategoryView) {
    if (view.id === this.presentation.gallery) return;
    this.presentation.views.set(this.presentation.gallery, this.scene.captureView());
    this.presentation.gallery = view.id;
    this.scene.setGallery(view);
    this.scene.resize();
    const remembered = this.presentation.views.get(view.id);
    if (remembered) this.scene.restoreView(remembered);
  }

  private navigate(state: Readonly<ExploreState>) {
    const target = state.conceptId ? conceptGallery(state.conceptId) : categoryGallery(state.categoryId);
    if (target && !this.spatialSelection) this.showScene(target);
    const represented = !!state.conceptId && this.scene.nodes.some((node) => node.id === state.conceptId);
    this.presentation.selected = state.conceptId;
    this.scene.setSelected(represented ? state.conceptId! : '');
    if (represented) {
      this.presentation.pins = openCallout(
        this.presentation.pins,
        state.conceptId!,
        this.presentation.gallery,
      );
      if (!this.spatialSelection) this.scene.focus();
    }
    this.renderPins();
    this.host.dataset.gallery = this.presentation.gallery;
    if (target) this.host.querySelector('#explore-gallery-title')!.textContent = this.scene.gallery!.title;
    this.host.querySelector<HTMLSelectElement>('#explore-view')!.value = this.presentation.gallery;
    this.host.querySelector<HTMLButtonElement>('#explore-focus')!.disabled = !represented;
    this.host.querySelector('#explore-view-note')!.textContent =
      !target || (state.conceptId && !represented)
        ? 'Reference only · No separate 3D representation for this entry. The previous atlas view is retained.'
        : 'Independent exhibits \u00b7 Free exploration';
  }

  private renderPins() {
    this.scene.setCallouts(
      this.presentation.pins.map((pin) => ({
        ...pin,
        id: `reference-${pin.conceptId}`,
        role: 'exploratory' as const,
        title: conceptRegistry[pin.conceptId].title,
        summary: conceptRegistry[pin.conceptId].summary,
      })),
      (id) => {
        this.presentation.pins = this.presentation.pins.filter((pin) => pin.conceptId !== id);
        this.renderPins();
      },
      (id) => this.inspectSpatial(id),
    );
  }

  setVisible(visible: boolean) {
    this.scene.setVisible(visible);
  }
  dispose() {
    this.browser.onNavigate = undefined;
    this.host.removeEventListener('click', this.toolbarClick);
    this.host.querySelector('#explore-view')!.removeEventListener('change', this.viewChange);
    this.scene.dispose();
  }
}
