import { placeCallout } from './callouts.ts';
import type { Callout, CalloutBounds, ScreenPoint } from './callouts.ts';
import type { SceneId } from './content.ts';

type CardView = { card: HTMLElement; line: SVGLineElement; content: string; model: Callout };

/** A keyed DOM layer. The renderer owns projection; this layer never writes camera state.
 * Card roots persist across projection, suspension and view changes. Future reading
 * interactions can be observed here without changing journey/camera ownership.
 */
export class CalloutLayer {
  readonly element = document.createElement('section');
  private lines = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  private views = new Map<string, CardView>();
  private resize: ResizeObserver;
  private panels: MutationObserver;
  private refresh?: () => void;

  constructor(
    parent: HTMLElement,
    private onClose: (concept: string) => void,
    private onInspect: (concept: string) => void,
  ) {
    this.element.className = 'callout-layer';
    this.element.setAttribute('aria-label', 'World annotations');
    this.lines.classList.add('callout-leaders');
    this.lines.setAttribute('aria-hidden', 'true');
    this.element.append(this.lines);
    parent.append(this.element);
    this.resize = new ResizeObserver(() => this.refresh?.());
    this.resize.observe(parent);
    this.panels = new MutationObserver(() => this.refresh?.());
    for (const id of ['journey-panel', 'inspector-panel']) {
      const panel = document.getElementById(id)!;
      this.panels.observe(panel, { attributes: true, attributeFilter: ['class', 'style'] });
      this.resize.observe(panel);
    }
  }

  setModels(models: readonly Callout[]) {
    for (const [id, view] of this.views) {
      if (!models.some((model) => model.id === id)) {
        this.resize.unobserve(view.card);
        view.card.remove();
        view.line.remove();
        this.views.delete(id);
      }
    }
    for (const [order, model] of models.entries()) {
      let view = this.views.get(model.id);
      if (!view) {
        const card = document.createElement('article');
        card.className = 'world-callout';
        card.dataset.calloutId = model.id;
        card.tabIndex = -1;
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        this.lines.append(line);
        this.element.append(card);
        view = { card, line, content: '', model };
        this.views.set(model.id, view);
        this.resize.observe(card);
        card.addEventListener('click', (event) => {
          const action = (event.target as HTMLElement).closest<HTMLButtonElement>('button')?.dataset.action;
          if (action === 'close') {
            const id = this.views.get(model.id)!.model.conceptId;
            this.onClose(id);
            // Return keyboard focus to the corresponding selectable world label.
            document
              .querySelector<HTMLButtonElement>(`.object-label[data-concept="${id}"]`)
              ?.focus({ preventScroll: true });
          } else if (action === 'inspect') this.onInspect(this.views.get(model.id)!.model.conceptId);
        });
      }
      view.model = model;
      view.card.dataset.role = model.role;
      view.card.dataset.subject = model.conceptId;
      view.card.dataset.detached = String(!!model.detached);
      view.card.style.zIndex = String(order + 1);
      const content = JSON.stringify(model);
      if (view.content !== content) {
        view.content = content;
        const header = document.createElement('div');
        header.className = 'callout-heading';
        const status = document.createElement('span');
        status.className = 'callout-status';
        status.textContent =
          model.role === 'guided'
            ? `Journey · ${model.position}${model.detached ? ' · Paused focus' : ''}`
            : 'Exploring';
        header.append(status);
        if (model.role === 'exploratory') {
          const close = document.createElement('button');
          close.dataset.action = 'close';
          close.textContent = '×';
          close.setAttribute('aria-label', `Close ${model.title} callout`);
          header.append(close);
        }
        const title = document.createElement('h2');
        title.id = `callout-title-${model.id}`;
        title.textContent = model.title;
        view.card.setAttribute('aria-labelledby', title.id);
        const summary = document.createElement('p');
        summary.textContent = model.summary;
        const detail = document.createElement('p');
        detail.className = 'callout-detail';
        detail.textContent = model.detail ?? '';
        detail.hidden = !model.detail;
        const fallback = document.createElement('span');
        fallback.className = 'callout-context';
        fallback.textContent = 'Scene context · no separate 3D object';
        const inspect = document.createElement('button');
        inspect.dataset.action = 'inspect';
        inspect.className = 'callout-inspect';
        inspect.textContent = 'Read in Inspector ↗';
        view.card.replaceChildren(header, title, summary, detail, fallback, inspect);
      }
    }
    this.refresh?.();
  }

  project(scene: SceneId, resolve: (concept: string) => ScreenPoint | undefined) {
    this.refresh = () => this.project(scene, resolve);
    const bounds = this.bounds();
    for (const { card, line, model } of this.views.values()) {
      const anchor = model.scene === scene ? resolve(model.conceptId) : undefined;
      // Remember off-scene references without attaching them to unrelated geometry.
      const visible = model.scene === scene && (anchor ? anchor.visible : model.role === 'guided');
      card.hidden = !visible;
      line.style.display = visible && anchor ? '' : 'none';
      if (!visible) continue;
      card.dataset.anchored = String(!!anchor);
      card.style.maxWidth = `${Math.max(1, bounds.right - bounds.left)}px`;
      card.style.maxHeight = `${Math.max(1, bounds.bottom - bounds.top)}px`;
      // A previously opened reference can share the canonical subject. Keep both
      // roles visible on opposite vertical sides of that anchor, without packing.
      const guided = this.views.get('guided')?.model;
      const sharesGuidedSubject =
        model.role === 'exploratory' && guided?.scene === model.scene && guided.conceptId === model.conceptId;
      const { x, y } = placeCallout(anchor, card.offsetWidth, card.offsetHeight, bounds, sharesGuidedSubject);
      card.style.transform = `translate(${x}px, ${y}px)`;
      if (anchor) {
        line.setAttribute('x1', String(anchor.x));
        line.setAttribute('y1', String(anchor.y));
        line.setAttribute('x2', String(Math.max(x, Math.min(anchor.x, x + card.offsetWidth))));
        line.setAttribute('y2', String(Math.max(y + 12, Math.min(anchor.y, y + card.offsetHeight - 12))));
      }
    }
  }

  private bounds(): CalloutBounds {
    const origin = this.element.getBoundingClientRect();
    const intro = document.querySelector('.scene-intro')!.getBoundingClientRect();
    const replay = document.querySelector('.playback')!.getBoundingClientRect();
    let left = 16,
      right = origin.width - 16;
    if (innerWidth > 980) {
      const journey = document.getElementById('journey-panel')!;
      const inspector = document.getElementById('inspector-panel')!;
      if (!journey.classList.contains('collapsed'))
        left = journey.getBoundingClientRect().right - origin.left + 12;
      if (!inspector.classList.contains('collapsed'))
        right = inspector.getBoundingClientRect().left - origin.left - 58;
    }
    return {
      left,
      right: Math.max(left + 1, right),
      top: intro.bottom - origin.top + 14,
      bottom: replay.top - origin.top - 56,
    };
  }

  dispose() {
    this.resize.disconnect();
    this.panels.disconnect();
    this.element.remove();
  }
}
