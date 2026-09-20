import './calibration.css';
import { captureFraming, resolveComposition } from './framing.ts';
import type { FramingRegistry, ResolvedFraming, SceneEntryProfile, CalloutRegion } from './framing.ts';
import type { SceneId } from './content.ts';

interface CalibrationState {
  key: string;
  scene: SceneId;
  index: number;
  stages: string[];
  profile: ResolvedFraming;
  duration: number;
  card?: { width: number; height: number };
  pose?: SceneEntryProfile;
  active: boolean;
}
interface CalibrationHost {
  read: (entry: boolean) => CalibrationState;
  choose: (index: number) => void;
  change: (drafts: FramingRegistry, entry: boolean, timingOnly: boolean) => void;
}

/** Loaded only behind Vite DEV + ?calibrate=1. Drafts never touch storage or source. */
export class CalibrationPanel {
  private element = document.createElement('details');
  private drafts: FramingRegistry = { stages: {}, sceneEntries: {} };
  private entry = false;
  constructor(private host: CalibrationHost) {
    this.element.id = 'framing-calibration';
    this.element.open = true;
    this.element.innerHTML = `
      <summary>Framing calibration <small>DEV</small></summary>
      <div class="calibration-body">
        <p>Temporary preview. Capture JSON into <code>src/framing.ts</code> to author a profile. Reload discards drafts.</p>
        <label>Journey stage<select data-field="stage"></select></label>
        <button type="button" data-action="preview">Preview stage in Manual</button>
        <label>Profile scope<select data-field="scope"><option value="stage">Subject / stage</option><option value="entry">Scene entry</option></select></label>
        <p data-status></p>
        <div data-controls></div>
        <label>Callout region<select data-field="region">${['auto', 'upper-left', 'upper-right', 'left', 'right', 'above', 'below'].map((region) => `<option>${region}</option>`).join('')}</select></label>
        <div data-orientation><p>Scene entry only: orbit the world, then use this angle.</p><button type="button" data-action="angle">Use current orbit for entry</button><output data-angle></output></div>
        <label>Teaching duration (ms)<input data-field="duration" type="number" min="500" max="120000" step="100"></label>
        <small>Teaching time at 1× speed, not inference latency. Duration always belongs to the current stage.</small>
        <div class="calibration-actions"><button type="button" data-action="reset">Reset profile</button><button type="button" data-action="reset-time">Reset duration</button><button type="button" data-action="capture">Capture framing</button><button type="button" data-action="copy">Copy JSON</button></div>
        <label>Captured registry data<textarea data-output readonly rows="6" placeholder="Capture the current pose to produce registry JSON"></textarea></label>
        <output data-message aria-live="polite"></output>
      </div>`;
    const controls = this.element.querySelector('[data-controls]')!;
    for (const [key, label, min, max, step] of [
      ['zoom', 'Guided zoom', 0.55, 3.6, 0.01],
      ['cx', 'Composition X (px)', -400, 400, 1],
      ['cy', 'Composition Y (px)', -300, 300, 1],
      ['ax', 'Anchor X (world)', -8, 8, 0.05],
      ['ay', 'Anchor Y (world)', -5, 10, 0.05],
      ['az', 'Anchor Z (world)', -8, 8, 0.05],
    ] as const) {
      const row = document.createElement('label');
      row.innerHTML = `${label}<span class="calibration-value"><input aria-label="${label}" type="range" data-field="${key}" min="${min}" max="${max}" step="${step}"><input aria-label="${label} value" type="number" data-field="${key}" min="${min}" max="${max}" step="${step}"></span>`;
      controls.append(row);
    }
    document.body.append(this.element);
    this.element.addEventListener('input', (event) => {
      const input = event.target as HTMLInputElement;
      const field = input.dataset.field;
      if (!field || ['stage', 'scope'].includes(field)) return;
      const state = this.host.read(this.entry);
      if (field === 'duration') {
        const value = input.valueAsNumber;
        if (!Number.isFinite(value)) return;
        this.drafts.stages![state.key] = {
          ...this.drafts.stages![state.key],
          teachingDurationMs: Math.max(500, Math.min(120000, value)),
        };
        this.host.change(this.drafts, this.entry, true);
        return;
      }
      const profile: SceneEntryProfile = {
        ...state.profile,
        compositionOffset: resolveComposition(state.profile, state.card),
      };
      if (field === 'region') profile.preferredCalloutRegion = input.value as CalloutRegion;
      else {
        const value = input.valueAsNumber;
        if (!Number.isFinite(value)) return;
        const clamped = Math.max(Number(input.min), Math.min(Number(input.max), value));
        if (field === 'zoom') profile.guidedZoom = clamped;
        else if (field.startsWith('c')) {
          const point: [number, number] = [...profile.compositionOffset!];
          point[field === 'cx' ? 0 : 1] = clamped;
          profile.compositionOffset = point;
        } else {
          const point: [number, number, number] = [...profile.anchorOffset!];
          point[field === 'ax' ? 0 : field === 'ay' ? 1 : 2] = clamped;
          profile.anchorOffset = point;
        }
      }
      this.store(profile);
    });
    this.element.addEventListener('change', (event) => {
      const input = event.target as HTMLSelectElement;
      if (input.dataset.field === 'stage') this.host.choose(Number(input.value));
      if (input.dataset.field === 'scope') {
        this.entry = input.value === 'entry';
        this.refresh();
      }
    });
    this.element.addEventListener('focusout', () => this.refresh());
    this.element.addEventListener('click', (event) => {
      const action = (event.target as HTMLElement).closest<HTMLButtonElement>('button')?.dataset.action;
      if (!action) return;
      const state = this.host.read(this.entry);
      if (action === 'preview') {
        this.host.choose(state.index);
        if (this.entry) this.host.change(this.drafts, true, false);
      } else if (action === 'angle' && state.pose) {
        this.store({ ...state.profile, cameraOrientation: state.pose.cameraOrientation });
      } else if (action === 'reset') {
        if (this.entry) delete this.drafts.sceneEntries![state.scene];
        else {
          const duration = this.drafts.stages![state.key]?.teachingDurationMs;
          this.drafts.stages![state.key] = duration === undefined ? {} : { teachingDurationMs: duration };
        }
        this.host.change(this.drafts, this.entry, false);
      } else if (action === 'reset-time') {
        if (this.drafts.stages![state.key]) delete this.drafts.stages![state.key].teachingDurationMs;
        this.host.change(this.drafts, this.entry, true);
      } else if (action === 'capture') this.capture();
      else if (action === 'copy') void this.copy();
    });
    this.refresh();
  }
  private store(profile: SceneEntryProfile) {
    const state = this.host.read(this.entry);
    if (this.entry) {
      delete profile.teachingDurationMs;
      this.drafts.sceneEntries![state.scene] = profile;
    } else {
      delete profile.cameraOrientation;
      this.drafts.stages![state.key] = { ...profile, teachingDurationMs: state.duration };
    }
    this.host.change(this.drafts, this.entry, false);
  }
  refresh() {
    const state = this.host.read(this.entry);
    const select = this.element.querySelector<HTMLSelectElement>('[data-field="stage"]')!;
    if (select.dataset.stages !== JSON.stringify(state.stages)) {
      select.replaceChildren(...state.stages.map((name, index) => new Option(name, String(index))));
      select.dataset.stages = JSON.stringify(state.stages);
    }
    select.value = String(state.index);
    const composition = resolveComposition(state.profile, state.card);
    const values: Record<string, string | number> = {
      zoom: state.profile.guidedZoom,
      cx: composition[0],
      cy: composition[1],
      ax: state.profile.anchorOffset[0],
      ay: state.profile.anchorOffset[1],
      az: state.profile.anchorOffset[2],
      region: state.profile.preferredCalloutRegion,
      duration: state.duration,
    };
    for (const input of this.element.querySelectorAll<HTMLInputElement>('[data-field]')) {
      // Let a number be typed (including a temporary minus/decimal) without
      // replacing its text/caret on every keystroke. Sliders still preview live.
      if (input === document.activeElement && input.type === 'number') continue;
      const value = values[input.dataset.field!];
      if (value !== undefined)
        input.value = typeof value === 'number' ? String(Math.round(value * 10000) / 10000) : value;
    }
    this.element.querySelector<HTMLElement>('[data-orientation]')!.hidden = !this.entry;
    this.element.querySelector('[data-angle]')!.textContent = JSON.stringify(
      state.profile.cameraOrientation ?? [],
    );
    this.element.querySelector('[data-status]')!.textContent =
      `${this.entry ? state.scene : state.key} · ${state.active ? 'Live draft preview' : 'Preview a stage to begin'}`;
  }
  private capture() {
    const state = this.host.read(this.entry);
    if (!state.active || !state.pose) {
      this.element.querySelector('[data-message]')!.textContent =
        'Preview the official stage before capturing.';
      return '';
    }
    const text = captureFraming(this.entry ? 'entry' : 'stage', this.entry ? state.scene : state.key, {
      ...state.profile,
      ...state.pose,
      teachingDurationMs: state.duration,
    });
    this.element.querySelector<HTMLTextAreaElement>('[data-output]')!.value = text;
    this.element.querySelector('[data-message]')!.textContent =
      'Captured current pose. Merge this data into framingRegistry; source files are unchanged.';
    return text;
  }
  private async copy() {
    const text = this.capture();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      this.element.querySelector('[data-message]')!.textContent = 'Copied registry JSON.';
    } catch {
      const output = this.element.querySelector<HTMLTextAreaElement>('[data-output]')!;
      output.focus();
      output.select();
      this.element.querySelector('[data-message]')!.textContent =
        'Clipboard unavailable. Copy the selected JSON.';
    }
  }
}
