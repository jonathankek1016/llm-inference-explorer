import type { ProviderObservation } from './live-observations.ts';
import type { LiveEvent } from './live-events.ts';
import { readImage } from './live-media.ts';
import type { ImageInput } from './live-media.ts';
import { mediaDeclarations } from './live-input.ts';
import type { LiveConfiguration, LiveRequestType } from './live-input.ts';
import { liveShell } from './live-shell.ts';
import { LiveJourney } from './live-journey.ts';
import { LiveRequests, requestTerminal } from './live-request.ts';
import type { LiveRequestSnapshot } from './live-request.ts';
import {
  textCapabilities,
  checkTextCapabilities,
  mediaCapabilities,
  checkMediaCapabilities,
} from './live-capabilities.ts';
import { liveContext } from './content-overlays.ts';
import type { Evidence } from './provenance.ts';
import { unknown } from './provenance.ts';
import { concepts } from './content.ts';
import type { SceneId } from './content.ts';
import { conceptRegistry } from './concept-registry.ts';
import { calloutPresentation, openCallout } from './callouts.ts';
import type { ExplorationCallout } from './callouts.ts';
import {
  journeyAdvancing,
  journeyFlowActive,
  journeyFlowSuspended,
  journeyStatus,
  journeySuspended,
} from './core.ts';
import type { JourneyAction, JourneyMode, JourneySuspension } from './core.ts';
import { isIncompleteJourney } from './guided-session.ts';
import type { GuidedSessions, SessionOwner } from './guided-session.ts';
import type { WorkspaceInstanceId, NavigationIntent } from './workspace.ts';
import { navigationFocus } from './navigation.ts';
import type { NavigationPreferences } from './navigation.ts';
import { resolveFramingProfile } from './framing.ts';
import { ReadingHold, observeReading } from './reading-hold.ts';
import { observeSceneFrames } from './scene-loop.ts';
import type { AtlasScene } from './scene.ts';
import { validateEndpoint } from './provider.ts';
import { icon } from './icons.ts';

const esc = (value: unknown) =>
  String(value).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
const labels = {
  OBSERVED: 'Observed',
  LOCALLY_CALCULATED: 'Locally calculated',
  ILLUSTRATIVE: 'Illustrative',
  INFERRED_REPRESENTATIVE: 'Representative',
  UNKNOWN: 'Unknown',
};
function evidenceMarkup(evidence: Evidence<unknown>) {
  const value =
    evidence.kind === 'UNKNOWN'
      ? 'Unavailable'
      : typeof evidence.value === 'string'
        ? evidence.value
        : JSON.stringify(evidence.value, null, 2);
  return `<span class="live-provenance" data-provenance="${evidence.kind}">${labels[evidence.kind]}</span><p class="small">${esc(evidence.basis)}</p><pre>${esc(value)}</pre>`;
}
function observationMarkup(event: ProviderObservation) {
  const badge = '<span class="live-provenance" data-provenance="OBSERVED">Observed provider field</span>';
  if (event.kind === 'source-reference')
    return `${badge}<p><a href="${esc(event.url)}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">${esc(event.title || event.url)}</a></p><p class="small">Provider citation. Source acquisition is unknown; this does not establish that search or retrieval ran. Source content has not been fetched or verified by this app.</p>`;
  return `${badge}<h4>${esc(event.name || 'Function name not yet returned')}</h4><p class="small">${event.phase === 'PARTIAL' ? 'Partial call received' : 'Call returned'}${event.providerCallId ? ` \u00b7 ${esc(event.providerCallId)}` : ''}. Execution owner: unknown. No execution or result observed.</p><p class="small">This app cannot execute or continue tool calls. A completed request means the response arrived, not that the requested function ran.</p>${event.arguments !== undefined ? `<details><summary>Returned arguments${event.truncated ? ' (truncated)' : ''}</summary><pre>${esc(event.arguments)}</pre><p class="small">Untrusted provider data; not executed or validated as tool input.</p></details>` : ''}`;
}
function latestObservations(events: readonly LiveEvent[]) {
  const latest = new Map<string, LiveEvent>();
  for (const event of events)
    if (
      (event.kind === 'tool-call' || event.kind === 'source-reference') &&
      event.evidence.kind !== 'UNKNOWN'
    )
      latest.set((event.evidence.value as ProviderObservation).key, event);
  return [...latest.values()];
}
function eventMarkup(event: LiveEvent) {
  return (event.kind === 'tool-call' || event.kind === 'source-reference') &&
    event.evidence.kind !== 'UNKNOWN'
    ? observationMarkup(event.evidence.value as ProviderObservation)
    : evidenceMarkup(event.evidence);
}
interface LivePorts {
  sessions: GuidedSessions;
  admit(owner: SessionOwner, fresh?: boolean): boolean;
  changed(): void;
  navigate(intent: NavigationIntent): void;
  config(): LiveConfiguration;
  settings(): void;
  navigation(): NavigationPreferences;
}

/** A retained Live host. Transport, global slot, local journey and visual state have separate owners. */
export class LiveWorkspace {
  readonly owner: SessionOwner = {
    workspace: 'LIVE',
    instanceId: 'live:text' as WorkspaceInstanceId,
    label: 'Live Lab',
  };
  readonly requests = new LiveRequests();
  lesson = new LiveJourney();
  scene?: AtlasScene;
  private request?: LiveRequestSnapshot;
  private selected = 'device';
  private requestType: LiveRequestType = 'TEXT';
  private image?: ImageInput;
  private imageRead = 0;
  private mediaKey = '';
  private inputError = '';
  private sceneId: SceneId = 'world';
  private pins: ExplorationCallout[] = [];
  private visible = false;
  private last = performance.now();
  private labelsOn = true;
  private inspectorKey = '';
  private hold: ReadingHold;
  private unsubscribe: () => void;
  private stopFrames: () => void;
  private views = new Map<SceneId, ReturnType<AtlasScene['captureView']>>();
  private $ = <T extends HTMLElement = HTMLElement>(id: string) => this.host.querySelector<T>(`#live-${id}`)!;

  constructor(
    private host: HTMLElement,
    private ports: LivePorts,
  ) {
    host.innerHTML = liveShell;
    this.hold = new ReadingHold((suspended) =>
      this.action({ type: 'SET_SUSPENSION', reason: 'READING_HOLD', suspended }),
    );
    observeReading(document, this.hold, () => this.readingContext(), {
      scope: host,
      inspector: '#live-inspector-body',
    });
    ports.sessions.register(this.owner, {
      incomplete: () => isIncompleteJourney(this.lesson.control),
      detach: () => this.detach(),
      resume: () => this.resume(),
      end: () => this.stop(),
    });
    this.unsubscribe = this.requests.subscribe((snapshot) => this.receive(snapshot));
    this.stopFrames = observeSceneFrames((time) => {
      const dt = time - this.last;
      this.last = time;
      this.hold.sync(this.readingContext(), time);
      if (!document.hidden && this.lesson.tick(dt)) {
        ports.sessions.reconcile(this.owner);
        this.render();
        if (!this.lesson.control.completed) this.showOfficial();
      }
    });
    this.$('form').addEventListener('submit', (event) => {
      event.preventDefault();
      this.submit();
    });
    this.$('request-type').addEventListener('change', () => {
      this.requestType = this.$<HTMLSelectElement>('request-type').value as LiveRequestType;
      this.inputError = '';
      this.render();
    });
    this.$('image-file').addEventListener('change', () => void this.selectImage());
    host.addEventListener('click', (event) => this.click(event));
    this.$('mode').addEventListener('change', () =>
      this.action({ type: 'SET_MODE', mode: this.$<HTMLSelectElement>('mode').value as JourneyMode }),
    );
    this.$('speed').addEventListener('change', () => {
      this.lesson.speed = Number(this.$<HTMLSelectElement>('speed').value);
    });
    this.$('timeline').addEventListener('input', () =>
      this.seek(Number(this.$<HTMLInputElement>('timeline').value)),
    );
    this.$('timeline').addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      const rect = this.$('timeline').getBoundingClientRect();
      this.seek(
        Math.round(
          Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) *
            (this.lesson.stages.length - 1),
        ),
      );
    });
    host.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        host.dataset.sheet = '';
        return;
      }
      if (
        (event.target as HTMLElement).closest(
          'input, textarea, select, button, a, summary, #live-inspector, #live-runtime, .world-callout',
        ) ||
        document.querySelector('dialog[open]')
      )
        return;
      if (event.key === ' ') {
        event.preventDefault();
        this.play();
      }
      if (event.key === 'ArrowRight') this.seek(this.lesson.position + 1);
      if (event.key === 'ArrowLeft') this.seek(this.lesson.position - 1);
    });
    this.render();
  }
  private readingContext() {
    return {
      journey: this.lesson.control,
      stage: this.lesson.current?.id ?? '',
      subject: this.lesson.event?.conceptId ?? '',
      selection: this.selected,
      inspectorVisible:
        this.visible &&
        !this.$('inspector').hidden &&
        (innerWidth > 980 || this.host.dataset.sheet === 'inspector'),
    };
  }
  private action(action: JourneyAction) {
    this.lesson.action(action);
    this.last = performance.now();
    this.ports.sessions.reconcile(this.owner);
    this.render();
  }
  suspend(reason: JourneySuspension, suspended: boolean) {
    this.action({ type: 'SET_SUSPENSION', reason, suspended });
  }
  private submit() {
    // A retained lesson is never silently replaced by a new request's trace.
    if (this.lesson.control.active || (this.request && !requestTerminal(this.request.state))) return;
    const prompt = this.$<HTMLTextAreaElement>('prompt').value.trim();
    if (
      (this.requestType !== 'IMAGE_UNDERSTANDING' && !prompt) ||
      !this.configured() ||
      (this.requestType === 'IMAGE_UNDERSTANDING' && !this.image)
    )
      return;
    const accepted = this.requests.start(
      { workspace: 'LIVE', instanceId: this.owner.instanceId },
      {
        prompt,
        config: this.requestConfig(),
        ...(this.requestType === 'IMAGE_UNDERSTANDING'
          ? { requestType: 'IMAGE_UNDERSTANDING', image: this.image! }
          : { requestType: this.requestType }),
        backendCapabilities: this.requestType === 'TEXT' ? undefined : mediaDeclarations(this.ports.config()),
      },
    );
    if (!accepted.accepted) return;
    const previous = this.lesson.control;
    this.lesson = new LiveJourney();
    this.lesson.control = {
      ...this.lesson.control,
      journeyMode: previous.journeyMode,
      suspensions: previous.suspensions,
    };
    this.pins = [];
    this.request = undefined;
    this.inspectorKey = '';
    this.receive(this.requests.get(accepted.requestId)!);
    // Request execution has already been independently admitted. A conflict here
    // only denies educational acquisition; the result remains available in Live.
    if (this.lesson.stages.length) this.start();
  }
  private receive(snapshot: LiveRequestSnapshot) {
    if (snapshot.id !== this.requests.current?.id) return;
    if (this.request?.id === snapshot.id && this.request.events.length > snapshot.events.length) return;
    this.request = snapshot;
    this.lesson.receive(snapshot);
    this.render();
  }
  private start() {
    if (!this.lesson.stages.length || !this.ports.admit(this.owner, true)) return;
    this.lesson.restart();
    this.last = performance.now();
    this.render();
    this.showOfficial(true);
  }
  private play() {
    const j = this.lesson.control;
    if (!j.active || j.completed || j.journeyMode !== 'AUTO') return;
    this.action({ type: j.playbackRequested ? 'PAUSE' : 'PLAY' });
  }
  private stop() {
    this.scene?.cancelFocus();
    this.action({ type: 'STOP' });
  }
  private detach() {
    this.scene?.cancelFocus();
    this.action({ type: 'DETACH' });
  }
  private resume() {
    if (!this.lesson.control.active) return;
    this.action({ type: 'RESUME' });
    this.showOfficial();
  }
  private seek(position: number, row = false) {
    if (
      !this.lesson.stages.length ||
      (row && this.lesson.control.active && position === this.lesson.position)
    )
      return;
    if (!this.ports.admit(this.owner)) {
      this.render();
      return;
    }
    const focus = navigationFocus(
      row ? { kind: 'row', from: this.lesson.position, to: position } : { kind: 'step' },
      this.lesson.control.guidedFocus,
      this.ports.navigation(),
    );
    this.lesson.action({ type: 'NAVIGATE', guidedFocus: focus });
    this.lesson.seek(position);
    this.last = performance.now();
    this.render();
    if (!(row && focus === 'DETACHED')) this.showOfficial();
    else this.scene?.cancelFocus();
  }
  private changeScene(id: SceneId) {
    if (id === this.sceneId) return false;
    if (this.scene) this.views.set(this.sceneId, this.scene.captureView());
    this.sceneId = id;
    this.scene?.setScene(id, false);
    const view = this.views.get(id);
    if (view) this.scene?.restoreView(view);
    return true;
  }
  private showOfficial(initial = false) {
    const event = this.lesson.event;
    if (!event) return;
    const changed = this.changeScene(concepts[event.conceptId].scene);
    this.selected = event.conceptId;
    this.scene?.setSelected(this.selected);
    this.render();
    if (this.lesson.control.active && this.lesson.control.guidedFocus === 'TRACKING')
      this.scene?.focusJourneySubject(
        this.selected,
        initial || changed,
        resolveFramingProfile(this.sceneId, this.selected, event.id, initial || changed),
      );
  }
  private inspect(id: string, spatial = false) {
    if (!concepts[id]) return;
    if (this.lesson.control.active && id !== this.lesson.event?.conceptId) this.detach();
    this.selected = id;
    if (!spatial) this.changeScene(concepts[id].scene);
    this.pins = openCallout(this.pins, id, this.sceneId);
    this.scene?.setSelected(id);
    this.$('inspector').hidden = false;
    this.host.dataset.sheet = 'inspector';
    this.render();
  }
  private click(event: Event) {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!button) return;
    if (button.dataset.liveStage !== undefined) this.seek(Number(button.dataset.liveStage), true);
    if (button.dataset.livePanel) {
      this.$(button.dataset.livePanel).hidden = false;
      this.host.dataset.sheet =
        this.host.dataset.sheet === button.dataset.livePanel ? '' : button.dataset.livePanel;
    }
    if (button.dataset.liveClose) {
      this.$(button.dataset.liveClose).hidden = true;
      this.host.dataset.sheet = '';
    }
    if (button.hasAttribute('data-explore-reference'))
      this.ports.navigate({ kind: 'explore-concept', conceptId: this.selected });
    switch (button.id) {
      case 'live-remove-image':
        ++this.imageRead;
        this.image = undefined;
        this.inputError = '';
        this.$<HTMLInputElement>('image-file').value = '';
        this.render();
        break;
      case 'live-capability-settings': {
        this.ports.settings();
        const connection = this.ports.config();
        let field = !connection.model.trim() ? 'provider-model' : '';
        try {
          validateEndpoint(connection.url);
        } catch {
          field = 'provider-url';
        }
        const declarations = document.querySelector<HTMLDetailsElement>('.media-configuration')!;
        declarations.open = true;
        const target = field
          ? document.getElementById(field)!
          : declarations.querySelector<HTMLElement>('summary')!;
        target.focus();
        target.scrollIntoView({ block: 'center' });
        break;
      }
      case 'live-settings':
        this.ports.settings();
        break;
      case 'live-cancel':
        if (this.request) this.requests.cancel(this.request.id);
        break;
      case 'live-start':
      case 'live-replay':
        this.start();
        break;
      case 'live-stop':
        this.stop();
        break;
      case 'live-complete':
        if (
          this.lesson.control.active &&
          this.lesson.control.journeyMode === 'MANUAL' &&
          this.lesson.position === this.lesson.stages.length - 1
        )
          this.action({ type: 'COMPLETE' });
        break;
      case 'live-explore-freely':
        this.scene?.cancelFocus();
        this.action({ type: 'EXPLORE' });
        break;
      case 'live-play':
        this.play();
        break;
      case 'live-previous':
        this.seek(this.lesson.position - 1);
        break;
      case 'live-next':
        this.seek(this.lesson.position + 1);
        break;
      case 'live-resume':
        this.resume();
        break;
      case 'live-reset':
        this.detach();
        this.scene?.reset();
        break;
      case 'live-focus':
        if (this.lesson.control.active) this.resume();
        else this.scene?.focus();
        break;
      case 'live-labels':
        this.labelsOn = !this.labelsOn;
        this.scene?.setLabels(this.labelsOn);
        button.setAttribute('aria-pressed', String(this.labelsOn));
        break;
    }
  }
  private async selectImage() {
    const token = ++this.imageRead;
    const file = this.$<HTMLInputElement>('image-file').files?.[0];
    if (!file) return;
    this.image = undefined;
    this.inputError = '';
    this.render();
    try {
      const image = await readImage(file);
      if (token === this.imageRead) this.image = image;
    } catch (error) {
      if (token === this.imageRead)
        this.inputError = error instanceof Error ? error.message : 'Image could not be read.';
    }
    if (token === this.imageRead) this.render();
  }
  private requestConfig(kind = this.requestType) {
    const config = this.ports.config(),
      declarations = mediaDeclarations(config);
    if (kind === 'IMAGE_GENERATION')
      return { ...config, model: config.media?.generationModel ?? '', stream: false, logprobs: false };
    if (kind === 'IMAGE_UNDERSTANDING')
      return {
        ...config,
        stream: config.stream && declarations.streaming === 'SUPPORTED',
        logprobs: config.logprobs && declarations.logprobs === 'SUPPORTED',
      };
    return config;
  }
  private configured(kind = this.requestType) {
    const config = this.requestConfig(kind);
    try {
      validateEndpoint(config.url);
    } catch {
      return false;
    }
    if (!config.model.trim()) return false;
    return kind === 'TEXT'
      ? !checkTextCapabilities(textCapabilities(), config).length
      : !checkMediaCapabilities(mediaCapabilities(kind, mediaDeclarations(this.ports.config())), kind, config)
          .length;
  }
  /** Explanations only: configured() and the existing capability gates still decide availability. */
  private capabilityGuidance(kind: LiveRequestType) {
    const config = this.requestConfig(kind);
    const reasons: string[] = [];
    let missingConfiguration = false;
    try {
      validateEndpoint(config.url);
    } catch {
      missingConfiguration = true;
      reasons.push(
        config.url.trim()
          ? 'Valid connection URL required (HTTPS, or localhost HTTP).'
          : 'Connection configuration required.',
      );
    }
    if (!config.model.trim()) {
      missingConfiguration = true;
      reasons.push(
        kind === 'IMAGE_GENERATION' ? 'Image-generation model required.' : 'Model identifier required.',
      );
    }
    let unsupported = false;
    if (kind !== 'TEXT') {
      const profile = mediaCapabilities(kind, mediaDeclarations(this.ports.config()));
      const labels: Record<string, string> = {
        imageText: 'Image + text support',
        imageGeneration: 'Image-generation endpoint support',
        generatedMedia: 'Generated-media return support',
        streaming: 'Image-understanding streaming',
        logprobs: 'Image-understanding logprobs',
      };
      for (const feature of checkMediaCapabilities(profile, kind, config)) {
        const support = profile.backend[feature].support;
        unsupported ||= support === 'UNSUPPORTED';
        reasons.push(
          `${labels[feature] ?? feature} is ${support === 'UNSUPPORTED' ? 'explicitly Unsupported' : 'Unknown / not advertised'}.`,
        );
      }
    }
    const ready = this.configured(kind);
    return {
      kind,
      ready,
      reasons,
      status: ready
        ? 'Ready'
        : missingConfiguration
          ? 'Not configured'
          : unsupported
            ? 'Unsupported'
            : 'Unknown',
    };
  }
  refreshConfiguration() {
    this.render();
  }
  private render() {
    const j = this.lesson.control,
      stages = this.lesson.stages,
      event = this.lesson.event;
    const busy = !!this.request && !requestTerminal(this.request.state);
    this.host.dataset.requestState = this.request?.state ?? 'IDLE';
    this.host.dataset.requestId = this.request?.id ?? '';
    const config = this.requestConfig();
    this.$('connection').textContent = this.configured()
      ? `${this.requestType === 'IMAGE_GENERATION' ? 'Image generation' : 'Chat Completions'} adapter · ${config.model}`
      : 'Configure the endpoint, model and documented image support in Settings.';
    const type = this.$<HTMLSelectElement>('request-type');
    type.disabled = busy || j.active;
    for (const option of type.options)
      option.disabled = option.value !== 'TEXT' && !this.configured(option.value as LiveRequestType);
    const names: Record<LiveRequestType, string> = {
      TEXT: 'Text',
      IMAGE_UNDERSTANDING: 'Image understanding',
      IMAGE_GENERATION: 'Image generation',
    };
    const guidance = (Object.keys(names) as LiveRequestType[]).map((kind) => this.capabilityGuidance(kind));
    this.$('capability-status').innerHTML = guidance
      .map(
        ({ kind, status, reasons }) =>
          `<div><dt>${names[kind]}</dt><dd data-capability="${kind}"><strong>${status}</strong>${reasons.length ? `<span class="capability-reason">${reasons.map(esc).join(' ')}</span>` : ''}</dd></div>`,
      )
      .join('');
    this.$('capabilities').textContent =
      'Support declarations come from your configuration, not automatic provider detection. Chat adapters read returned function calls and citations; app-owned tool, MCP, retrieval and search execution remain unavailable. Client cancellation does not guarantee remote computation stops.';
    if (this.request) {
      const caps = this.request.capabilities;
      this.$('capabilities').textContent +=
        ` Retained request: ${caps.adapterId}. Image input ${caps.backend.imageText.support} (${caps.backend.imageText.origin}); image generation ${caps.backend.imageGeneration.support} (${caps.backend.imageGeneration.origin}); media return ${caps.backend.generatedMedia.support} (${caps.backend.generatedMedia.origin}). Settings changes apply to subsequent requests.`;
    }
    const understanding = this.requestType === 'IMAGE_UNDERSTANDING';
    this.$('image-input').hidden = !understanding;
    this.$<HTMLInputElement>('image-file').disabled = !this.configured() || busy || j.active;
    this.$<HTMLButtonElement>('remove-image').disabled = busy || j.active;
    this.$('image-preview').hidden = !this.image;
    const preview = this.$('image-preview').querySelector('img')!;
    if (this.image) {
      if (preview.getAttribute('src') !== this.image.dataUrl) preview.src = this.image.dataUrl;
      this.$('image-preview').querySelector('figcaption')!.textContent =
        `Input image · ${this.image.width} × ${this.image.height} · ${Math.ceil(this.image.bytes / 1024)} KiB · ${this.image.mime}`;
    } else preview.removeAttribute('src');
    this.$('input-error').hidden = !this.inputError;
    this.$('input-error').textContent = this.inputError;
    this.$<HTMLTextAreaElement>('prompt').required = !understanding;
    this.$('prompt-label').textContent = understanding
      ? 'Instruction (optional)'
      : this.requestType === 'IMAGE_GENERATION'
        ? 'Image prompt'
        : 'Your text';
    this.$('submit').textContent = understanding
      ? 'Submit image'
      : this.requestType === 'IMAGE_GENERATION'
        ? 'Generate image'
        : 'Send text';
    this.$<HTMLButtonElement>('submit').disabled =
      !this.configured() || busy || j.active || (understanding && !this.image);
    this.$('submit-note').textContent = busy
      ? 'The request runs independently of the lesson. Cancel request to abort client transport.'
      : j.active
        ? 'Keep this lesson, or use Stop journey / Explore freely before submitting another request.'
        : 'Inputs and results stay in this tab’s memory. Sending may begin a guided lesson if the global slot is free. A new request replaces the previous media result.';
    this.$('cancel').hidden = !busy;
    this.$('request-status').textContent = this.request
      ? `Request ${this.request.state.toLowerCase()} · independent of teaching playback`
      : 'No request yet';
    this.$('error').hidden = !this.request?.error;
    this.$('error').textContent =
      this.request?.error && this.request.error.kind !== 'UNKNOWN' ? this.request.error.value : '';
    const text =
      this.request?.result?.text ?? this.request?.events.findLast((e) => e.kind === 'text-update')?.evidence;
    this.$('response').textContent =
      text && text.kind !== 'UNKNOWN'
        ? String(text.value)
        : busy
          ? this.request?.requestType === 'IMAGE_GENERATION'
            ? 'Waiting for generated output…'
            : 'Waiting for returned text…'
          : this.request
            ? this.request.media?.length
              ? 'Generated media is available below.'
              : 'No returned text.'
            : 'Your response will appear here, independently of teaching playback.';
    this.renderMedia();
    const observations = latestObservations(this.request?.events ?? []);
    const observationBody = this.$('observations');
    observationBody.hidden = !observations.length;
    const observationKey = observations.map((e) => e.id).join(':');
    if (observationBody.dataset.revision !== observationKey) {
      const open = [...observationBody.querySelectorAll('details')].map((d) => d.open);
      observationBody.innerHTML =
        '<h2 class="live-section-title">Provider calls & sources</h2>' +
        observations.map(eventMarkup).join('');
      observationBody.querySelectorAll('details').forEach((d, i) => {
        d.open = open[i] ?? false;
      });
      observationBody.dataset.revision = observationKey;
    }
    this.$('receipt-body').innerHTML = this.request
      ? `<p class="small">${esc(this.request.id)}</p><p class="small">${this.request.events
          .filter((e) => e.kind === 'request-state')
          .map((e) => (e.evidence.kind !== 'UNKNOWN' ? esc(e.evidence.value) : ''))
          .join(' → ')}</p>${this.request.events
          .filter((e) =>
            [
              'image-metadata',
              'generation-metadata',
              'media-metadata',
              'client-timing',
              'usage',
              'finish-reason',
              'logprobs',
            ].includes(e.kind),
          )
          .map((e) => `<details><summary>${esc(e.kind)}</summary>${evidenceMarkup(e.evidence)}</details>`)
          .join('')}`
      : '<p>No runtime evidence yet.</p>';
    this.$('playback').hidden = !stages.length;
    Object.assign(this.$('playback').dataset, {
      journeyActive: String(j.active),
      completed: String(j.completed),
      guidedFocus: j.guidedFocus,
      journeyMode: j.journeyMode,
      advancing: String(journeyAdvancing(j)),
      suspensions: j.suspensions.join(' '),
    });
    this.$('position').textContent = `${this.lesson.position + 1} / ${stages.length}`;
    this.$<HTMLSelectElement>('mode').value = j.journeyMode;
    this.$('start').hidden = j.active;
    this.$('stop').hidden = !j.active || j.completed;
    this.$('complete').hidden =
      !j.active || j.completed || j.journeyMode !== 'MANUAL' || this.lesson.position !== stages.length - 1;
    this.$('explore-freely').hidden = !j.completed;
    this.$('resume').hidden = !j.active || j.completed || j.guidedFocus !== 'DETACHED';
    this.$('play').innerHTML = icon(j.playbackRequested ? 'pause' : 'play');
    this.$('play').setAttribute(
      'aria-label',
      j.playbackRequested ? 'Pause Live journey' : 'Play Live journey',
    );
    this.$<HTMLButtonElement>('play').disabled = !j.active || j.completed || j.journeyMode !== 'AUTO';
    this.$<HTMLButtonElement>('previous').disabled = this.lesson.position === 0;
    this.$<HTMLButtonElement>('next').disabled = this.lesson.position >= stages.length - 1;
    this.$('replay').innerHTML = `${icon('replay')}${j.completed ? ' Replay from start' : ''}`;
    this.$('replay').setAttribute(
      'aria-label',
      j.completed ? 'Replay Live from start' : 'Replay Live journey',
    );
    const timeline = this.$<HTMLInputElement>('timeline');
    timeline.max = String(Math.max(0, stages.length - 1));
    timeline.value = String(this.lesson.position);
    this.$('guidance-status').textContent = journeyStatus(j);
    this.$('current-stage').textContent = this.lesson.current?.title ?? '';
    this.$('title').textContent = this.lesson.current?.title ?? 'A real request, an honest view';
    const stageMarkup = stages
      .map(
        (stage, i) =>
          `<button data-live-stage="${i}" ${i === this.lesson.position ? 'aria-current="step"' : ''}><span>${i + 1}. ${esc(stage.title)}</span><small>${labels[stage.evidence.kind]}</small></button>`,
      )
      .join('');
    if (this.$('stages').innerHTML !== stageMarkup) this.$('stages').innerHTML = stageMarkup;
    this.renderInspector();
    if (this.scene) {
      this.scene.setPresentationSuspended(journeySuspended(j));
      this.scene.setTeachingFlow(journeyFlowActive(j), journeyFlowSuspended(j));
      this.scene.setGuidedEmphasis(j.active);
      const cards = event
        ? calloutPresentation(j, event, this.lesson.position, stages.length, this.pins)
        : [];
      const guided = cards.find((c) => c.role === 'guided');
      if (guided && this.lesson.current) {
        guided.title = this.lesson.current.title;
        guided.summary = `${labels[this.lesson.current.evidence.kind]} · ${this.lesson.current.evidence.basis}`;
        guided.detail = '3D representation is illustrative.';
        guided.preferredCalloutRegion = resolveFramingProfile(
          concepts[event!.conceptId].scene,
          event!.conceptId,
        ).preferredCalloutRegion;
      }
      this.scene.setCallouts(
        cards,
        (id) => {
          this.pins = this.pins.filter((pin) => pin.conceptId !== id);
          this.render();
        },
        (id) => this.inspect(id, true),
      );
    }
    this.ports.changed();
  }
  private renderMedia() {
    const key = `${this.request?.id}:${this.request?.media?.map((m) => m.id).join(',')}`;
    this.$('media-output').hidden = !this.request?.media?.length;
    if (key === this.mediaKey) return;
    this.mediaKey = key;
    const output = this.$('generated-images');
    output.replaceChildren();
    for (const [i, media] of (this.request?.media ?? []).entries()) {
      const figure = document.createElement('figure'),
        image = document.createElement('img'),
        caption = document.createElement('figcaption');
      image.alt = `Generated output ${i + 1}`;
      image.referrerPolicy = 'no-referrer';
      image.src = media.src;
      caption.textContent = media.revisedPrompt
        ? `Returned revised prompt: ${media.revisedPrompt}`
        : 'Observed provider output · not the illustrative 3D model';
      image.addEventListener('error', () => {
        caption.textContent =
          'The returned image could not be loaded. Its URL may have expired or its format is invalid.';
      });
      const link = document.createElement('a');
      link.textContent = 'Open full image';
      link.href = media.src;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      if (media.src.startsWith('data:')) {
        link.download = `generated-${i + 1}.${media.mime?.split('/')[1] ?? 'png'}`;
        link.textContent = 'Save full image';
      }
      figure.append(image, caption, link);
      output.append(figure);
    }
  }
  private renderInspector() {
    const context = this.request && liveContext(this.request, this.selected);
    const current = this.lesson.current;
    // Text streaming leaves the reading surface intact; structured evidence refreshes preserve scroll/details.
    const key = `${this.request?.id}:${this.selected}:${current?.id}:${this.request?.state}:${latestObservations(
      context?.evidence ?? [],
    )
      .map((e) => e.id)
      .join(':')}`;
    if (key === this.inspectorKey) return;
    this.inspectorKey = key;
    const body = this.$('inspector-body'),
      scroll = body.scrollTop;
    const opened = [...body.querySelectorAll<HTMLDetailsElement>('details')].map((d) => d.open);
    const stage = current?.conceptId === this.selected ? current : undefined;
    body.innerHTML = `<h2>${esc(concepts[this.selected].title)}</h2><p>${esc(conceptRegistry[this.selected].summary)}</p><button class="text-button explore-reference-action" data-explore-reference>Explore this concept ${icon('expand')}</button>${
      context
        ? `<p class="small">${esc(this.request?.requestType ?? 'TEXT')} · Request ${esc(context.state)} · ${esc(context.requestId)}</p>${stage ? `<h3>${esc(stage.title)}</h3>${stage.events.some((e) => e.kind === 'tool-call' || e.kind === 'source-reference') ? latestObservations(stage.events).map(eventMarkup).join('') : evidenceMarkup(stage.evidence)}` : '<p>Exploratory concept selection; the official educational stage is retained separately.</p>'}<p class="small">${context.caveats.map(esc).join(' ')} Actual media is in Request &amp; result. Vision patches, fusion, latent noise and denoising geometry do not expose this provider’s internals.</p>${evidenceMarkup(unknown('Provider network route, hardware allocation and hidden model internals are not exposed.'))}<details><summary>Available evidence for this concept</summary>${[
            ...context.evidence.filter((e) => !['tool-call', 'source-reference'].includes(e.kind)),
            ...latestObservations(context.evidence),
          ]
            .filter((e) => e.kind !== 'text-update')
            .map((e) => `<h4>${esc(e.kind)}</h4>${eventMarkup(e)}`)
            .join('')}</details>`
        : '<p>No request evidence yet. The atlas is an illustrative educational representation.</p>'
    }`;
    body.querySelectorAll<HTMLDetailsElement>('details').forEach((d, i) => {
      d.open = opened[i] ?? false;
    });
    body.scrollTop = scroll;
  }
  ensureScene(Scene: typeof AtlasScene) {
    if (this.scene) return;
    try {
      this.scene = new Scene(
        this.$('viewport'),
        (id) => this.inspect(id, true),
        () => this.detach(),
        () => this.fallback(),
        {
          framing: this.$('framing'),
          accessibleLabel: 'Live educational 3D atlas. Illustrative, not provider telemetry.',
          annotations: {
            namespace: 'live-',
            labelRoot: this.$('viewport'),
            panels: [this.$('runtime'), this.$('inspector')],
            bounds: () => {
              const frame = this.$('framing').getBoundingClientRect();
              return { left: frame.left, right: frame.right, top: frame.top, bottom: frame.bottom };
            },
          },
        },
      );
      this.scene.setScene(this.sceneId);
      this.scene.setSelected(this.selected);
      this.scene.setVisible(this.visible);
      this.render();
    } catch {
      this.fallback();
    }
  }
  private fallback() {
    this.scene?.dispose();
    this.scene = undefined;
    this.$('fallback').hidden = false;
  }
  setVisible(visible: boolean) {
    this.visible = visible;
    this.scene?.setVisible(visible);
    this.last = performance.now();
    this.hold.sync(this.readingContext(), this.last);
  }
  dispose() {
    ++this.imageRead;
    this.image = undefined;
    this.unsubscribe();
    this.stopFrames();
    this.scene?.dispose();
  }
}
