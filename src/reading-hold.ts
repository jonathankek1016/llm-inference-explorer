import type { JourneyControl } from './core.ts';

export const readingIdleMs = 4000;
export type ReadingSurface = 'inspector' | 'callout';
export interface ReadingContext {
  journey: JourneyControl;
  stage: string;
  subject: string;
  selection: string;
  inspectorVisible: boolean;
}

/** Interaction leases, not another playback clock. Only emits the existing blocker. */
export class ReadingHold {
  private leases = new Map<ReadingSurface, number>();
  private stage = '';
  private held = false;
  private notify: (held: boolean) => void;
  constructor(notify: (held: boolean) => void) {
    this.notify = notify;
  }
  has(surface: ReadingSurface) {
    return this.leases.has(surface);
  }
  clear() {
    this.leases.clear();
    this.publish();
  }
  activity(surface: ReadingSurface, context: ReadingContext, now: number) {
    this.sync(context, now);
    if (this.eligible(surface, context)) this.leases.set(surface, now + readingIdleMs);
    this.publish();
  }
  sync(context: ReadingContext, now: number) {
    if (this.stage !== context.stage) this.leases.clear();
    this.stage = context.stage;
    for (const [surface, until] of this.leases)
      if (now >= until || !this.eligible(surface, context)) this.leases.delete(surface);
    this.publish();
  }
  private eligible(surface: ReadingSurface, context: ReadingContext) {
    const { journey } = context;
    return (
      journey.active &&
      journey.journeyMode === 'AUTO' &&
      journey.guidedFocus === 'TRACKING' &&
      (surface === 'callout' || (context.inspectorVisible && context.selection === context.subject))
    );
  }
  private publish() {
    const held = this.leases.size > 0;
    if (held === this.held) return;
    this.held = held;
    this.notify(held);
  }
}

/** One delegated lifecycle survives Inspector tab renders and keyed callout updates. */
export function observeReading(root: Document, hold: ReadingHold, read: () => ReadingContext) {
  const activity = (event: Event) => {
    const element = event.target instanceof Element ? event.target : null;
    if (!element || element.closest('[data-concept], [data-scene], [data-search-concept], #next-decode'))
      return;
    if (event.type === 'focusin' && !element.matches(':focus-visible')) return;
    const context = read();
    // DOM replacement can itself scroll. User wheel/touch/keyboard/scrollbar
    // gestures establish a lease first; layout-driven scrolls cannot start one.
    const deliberate = (surface: ReadingSurface) =>
      !['scroll', 'toggle'].includes(event.type) || hold.has(surface);
    if (element.closest('#inspector-header, #inspector-body, .inspector-tabs') && deliberate('inspector'))
      hold.activity('inspector', context, performance.now());
    const card = element.closest<HTMLElement>('.world-callout[data-role="guided"]');
    if (card && !card.hidden && card.dataset.subject === context.subject && deliberate('callout'))
      hold.activity('callout', context, performance.now());
  };
  for (const event of [
    'wheel',
    'scroll',
    'pointerdown',
    'pointerup',
    'click',
    'keydown',
    'input',
    'copy',
    'focusin',
    'toggle',
  ])
    root.addEventListener(event, activity, { capture: true, passive: true });
  root.addEventListener('selectionchange', () => {
    const selection = root.getSelection();
    if (selection && !selection.isCollapsed && selection.anchorNode?.parentElement)
      activity({ target: selection.anchorNode.parentElement, type: 'selectionchange' } as unknown as Event);
  });
}
