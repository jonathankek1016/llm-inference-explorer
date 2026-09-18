import './style.css';
import { shell } from './shell.ts';
import { icon } from './icons.ts';
import { concepts, scenarios, sceneNames, sceneParents, sceneEntries, sources } from './content.ts';
import type { SceneId } from './content.ts';
import {
  makeTrace,
  frameAt,
  toyEncode,
  distribution,
  sample,
  boundedContext,
  RunGate,
  createJourneyControl,
  transitionJourney,
  journeyAdvancing,
  journeySuspended,
  advanceJourneyTime,
} from './core.ts';
import type { Message, JourneyAction, JourneyMode } from './core.ts';
import { requestText, validateEndpoint } from './provider.ts';
import type { ProviderConfig, ProviderResult } from './provider.ts';
import type { AtlasScene } from './scene.ts';
import { palettes, readAppearance, readDarkAppearance, makeTheme } from './theme.ts';
import { ColourPicker } from './colour-picker.ts';
import { defaultGridIntensity } from './grid.ts';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: unknown) =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
const read = <T>(key: string, fallback: T): T => {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback;
  } catch {
    return fallback;
  }
};
const save = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* Persistence is optional. */
  }
};
const state = {
  scenario: 'text',
  scene: 'world' as SceneId,
  selected: 'device',
  position: 0,
  speed: 1,
  local: false,
  labels: true,
  tab: 'journey',
  inspector: 'learn',
  temperature: 0.8,
  seed: 42,
  dark: read<string>('atlas-theme', 'light') === 'dark',
};
let journey = createJourneyControl();
const remoteOnly = new Set(['router', 'internet', 'datacenter', 'ingress', 'rack']);
let appearance = readAppearance(read<unknown>('atlas-appearance', null));
let darkAppearance = readDarkAppearance(read<unknown>('atlas-dark-appearance', 0));
let groundGrid = read<unknown>('atlas-ground-grid', true) !== false;
const storedGridIntensity = read<unknown>('atlas-grid-intensity', defaultGridIntensity);
let gridIntensity =
  typeof storedGridIntensity === 'number' && Number.isFinite(storedGridIntensity)
    ? Math.round(Math.max(0, Math.min(100, storedGridIntensity)))
    : defaultGridIntensity;
const sceneName = (id: SceneId) => (id === 'compute' && state.local ? 'On-device compute' : sceneNames[id]);
let trace = makeTrace('text'),
  atlas: AtlasScene | undefined,
  frame = frameAt(trace, 0),
  animationLast = 0,
  stageElapsed = 0;
let mode: 'demo' | 'live' = 'demo',
  latestResult: ProviderResult | undefined,
  latestPrompt = scenarios.text.prompt,
  receipt = 'No live request yet';
let receiptEvents: { time: number; event: string }[] = [];
let promptObserved = false;
const gate = new RunGate();
const stored = read<unknown>('atlas-history', []);
let history: Message[] = Array.isArray(stored)
  ? stored
      .filter(
        (m) =>
          m &&
          ['user', 'assistant'].includes(m.role) &&
          typeof m.content === 'string' &&
          ['demo', 'live', 'legacy'].includes(m.mode),
      )
      .slice(-60)
      .map((m) => ({ ...m, state: m.state === 'running' ? 'cancelled' : m.state }))
  : [];
let legacyNotice = false;
try {
  if (!history.length && !localStorage.getItem('atlas-history')) {
    const old = read<any[]>('chat-history', []);
    if (Array.isArray(old))
      history = old
        .filter((m) => typeof m.text === 'string')
        .map((m) => ({
          role: m.role === 'user' ? 'user' : 'assistant',
          content: m.text,
          mode: 'legacy',
          state: 'completed',
        }));
  }
  if (localStorage.getItem('ai-key')) {
    legacyNotice = true;
    localStorage.removeItem('ai-key');
  }
} catch {
  /* Storage may be disabled. */
}
const prefs = read<Partial<ProviderConfig>>('atlas-provider', {});
let config: ProviderConfig = {
  url: typeof prefs.url === 'string' ? prefs.url : 'https://api.openai.com/v1',
  model: typeof prefs.model === 'string' ? prefs.model : '',
  stream: prefs.stream !== false,
  logprobs: prefs.logprobs === true,
  key: '',
};
$('app').innerHTML = shell;
function applyThemeTokens() {
  const { tokens } = makeTheme(appearance, state.dark, darkAppearance);
  for (const [name, value] of Object.entries(tokens))
    document.documentElement.style.setProperty('--' + name, value);
}
function applyAppearance() {
  applyThemeTokens();
  document.documentElement.dataset.palette = appearance.palette;
  atlas?.setPalette(appearance);
  save('atlas-appearance', appearance);
  document.querySelectorAll<HTMLInputElement>('input[name="palette"]').forEach((input) => {
    input.checked = input.value === appearance.palette;
  });
  $('custom-colour-fields').hidden = appearance.palette !== 'custom';
  colourPicker.setColour(appearance.custom);
}
const colourPicker = new ColourPicker($('custom-colour-fields'), (custom) => {
  appearance = { palette: 'custom', custom };
  applyAppearance();
});
$('appearance-dialog').addEventListener('close', () => colourPicker.setColour(appearance.custom));
let toastTimer: ReturnType<typeof setTimeout>;
function toast(text: string) {
  $('toast').textContent = text;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    $('toast').hidden = true;
  }, 5000);
}
function setPlaying(value: boolean) {
  updateJourney({ type: value ? 'PLAY' : 'PAUSE' });
}
function updateJourney(action: JourneyAction) {
  const starting = !journey.active;
  const wasSuspended = journeySuspended(journey);
  journey = transitionJourney(journey, action);
  // Exclude time across suspension boundaries even if no RAF ran in between.
  if (wasSuspended !== journeySuspended(journey)) animationLast = performance.now();
  renderJourneyControl();
  if (action.type === 'PLAY' || (action.type === 'SET_MODE' && action.mode === 'AUTO' && journey.active)) {
    const previousScene = state.scene;
    if (starting) selectConcept(frame.event.conceptId, { pause: false });
    focusJourneySubject(previousScene !== state.scene);
  }
}
function focusJourneySubject(canonical = false) {
  if (journey.active && journey.guidedFocus === 'TRACKING')
    atlas?.focusJourneySubject(frame.event.conceptId, canonical);
}
function renderJourneyControl() {
  const advancing = journeyAdvancing(journey);
  if (atlas) {
    atlas.setPresentationSuspended(journeySuspended(journey));
    atlas.playing = advancing;
    atlas.dirty = true;
  }
  $('play').innerHTML = icon(advancing ? 'pause' : 'play');
  $('play').setAttribute('aria-label', advancing ? 'Pause journey' : 'Play journey');
  $('play').toggleAttribute(
    'disabled',
    journey.journeyMode === 'MANUAL' || journey.guidedFocus === 'DETACHED',
  );
  $<HTMLSelectElement>('journey-mode').value = journey.journeyMode;
  $<HTMLInputElement>('follow').checked = journey.guidedFocus === 'TRACKING';
  $('follow').closest<HTMLElement>('label')!.hidden = !journey.active || journey.guidedFocus === 'DETACHED';
  $('resume-focus').hidden = !journey.active || journey.guidedFocus !== 'DETACHED';
  $('guidance-status').hidden = journey.active;
  const playback = document.querySelector<HTMLElement>('.playback')!;
  playback.dataset.journeyMode = journey.journeyMode;
  playback.dataset.guidedFocus = journey.guidedFocus;
  playback.dataset.advancing = String(advancing);
  playback.dataset.journeyActive = String(journey.active);
}
function detachGuidedFocus() {
  atlas?.cancelFocus();
  updateJourney({ type: 'DETACH' });
}
function resumeGuidedFocus() {
  if (!journey.active) return;
  // Resolve from the current frame, never from the selection at detachment time.
  const previousScene = state.scene;
  selectConcept(frame.event.conceptId, { pause: false });
  updateJourney({ type: 'RESUME' });
  focusJourneySubject(previousScene !== state.scene);
}
function navigateStage(position: number) {
  // An explicit step retains V2's pause while attached. Detached stepping must
  // not discard Auto intent: Resume still returns to the newly chosen stage.
  if (journey.guidedFocus === 'TRACKING') setPlaying(false);
  updateJourney({ type: 'NAVIGATE' });
  seek(position);
}
function showPanel(which: 'journey' | 'inspector', show = true) {
  $(`${which}-panel`).classList.toggle('collapsed', !show);
  if (!show) $(`${which}-panel`).classList.remove('mobile-open');
  $(`restore-${which}`).hidden = show;
  if (show && innerWidth <= 980) {
    const other = which === 'journey' ? 'inspector' : 'journey';
    $(`${other}-panel`).classList.remove('mobile-open');
    $(`${which}-panel`).classList.add('mobile-open');
  }
}
function setTab(tab: string) {
  state.tab = tab;
  $('journey-content').hidden = tab !== 'journey';
  $('chat-content').hidden = tab !== 'chat';
  $('journey-tab').setAttribute('aria-selected', String(tab === 'journey'));
  $('chat-tab').setAttribute('aria-selected', String(tab === 'chat'));
  showPanel('journey');
}
function changeScene(scene: SceneId) {
  state.scene = scene;
  atlas?.setScene(scene, !journey.active);
  atlas?.resize();
  const lineage: SceneId[] = [scene];
  let parent = sceneParents[scene];
  while (parent) {
    lineage.unshift(parent);
    parent = sceneParents[parent];
  }
  $('breadcrumbs').innerHTML = lineage
    .map(
      (id, i) =>
        `${i ? '<span> / </span>' : ''}<button data-scene="${id}" ${id === scene ? 'aria-current="page"' : ''}>${id === 'world' ? icon('cube') + ' Atlas' : sceneName(id)}</button>`,
    )
    .join('');
  $('scene-title').textContent = scene === 'world' ? 'The journey of an AI request' : sceneName(scene);
  const subtitles: Record<SceneId, string> = {
    world: state.local
      ? 'A local route keeps model computation on your device.'
      : 'A question leaves your device. A whole system brings the answer back.',
    compute: 'From a building to the arithmetic inside an accelerator.',
    model: 'One prompt prefill. A repeated loop to generate the answer.',
    block: 'Separate the operations. Follow the residual pathway.',
    tools: 'The model proposes. The application coordinates. The tool returns.',
    vision: 'Pixels become features that a language model can use.',
    diffusion: 'Text guides an iterative journey from noise to an image.',
  };
  $('scene-subtitle').textContent =
    state.local && scene === 'compute'
      ? 'The application, accelerator and weights stay on this device.'
      : subtitles[scene];
  $('canvas-caption').innerHTML =
    `<span class="caption-line"></span>${['world', 'compute'].includes(scene) ? 'REPRESENTATIVE INFRASTRUCTURE · NOT TO SCALE' : scene === 'block' ? 'PRE-NORMALISED DECODER BLOCK · ILLUSTRATIVE' : scene === 'model' ? 'LOGICAL COMPUTATION · SIX BLOCKS SHOWN FOR CLARITY' : 'SIMULATED SCENARIO · NO MODEL INTERNALS OBSERVED'}<span class="caption-line"></span>`;
  document
    .querySelectorAll('#scene-switcher button')
    .forEach((b) => b.classList.toggle('active', (b as HTMLElement).dataset.scene === scene));
  $('explode-control').hidden = scene !== 'block';
}
function selectConcept(id: string, options: { pause?: boolean; focus?: boolean; keepScene?: boolean } = {}) {
  if (!concepts[id]) return;
  // Exploration during a started journey cannot replace its official frame.
  // Direction-dependent row policies and other navigation settings are later work.
  if (journey.active && options.pause !== false) {
    detachGuidedFocus();
    selectConcept(id, { ...options, pause: false });
    return;
  }
  if (options.pause !== false) {
    setPlaying(false);
    if (state.local && remoteOnly.has(id)) {
      state.local = false;
      $<HTMLSelectElement>('route').value = 'remote';
      atlas?.setLocal(false);
      trace = makeTrace(state.scenario);
    }
    const branch = concepts[id].scene;
    if (['tools', 'vision', 'diffusion'].includes(branch) && state.scenario !== branch) {
      state.scenario = branch;
      trace = makeTrace(branch, state.local);
      $<HTMLSelectElement>('scenario').value = branch;
      $('journey-name').textContent = scenarios[branch].name;
      $('journey-description').textContent = scenarios[branch].subtitle;
      $('example').textContent = scenarios[branch].prompt + ' ↗';
    }
    const index = trace.findIndex((e) => e.conceptId === id);
    if (index >= 0) {
      frame = frameAt(trace, index);
      state.position = index;
      stageElapsed = 0;
      atlas?.setProgress(frame.decode, frame.refinement);
      renderPlayback();
    }
  }
  state.selected = id;
  if (!options.keepScene) changeScene(concepts[id].scene);
  atlas?.setSelected(id);
  if (options.focus) atlas?.focus();
  renderInspector();
  renderStages();
}
function goScene(id: SceneId) {
  if (journey.active) detachGuidedFocus();
  else setPlaying(false);
  changeScene(id);
  selectConcept(id === 'compute' && state.local ? 'gpu' : sceneEntries[id], {
    keepScene: true,
    pause: !journey.active,
  });
  atlas?.reset();
}
function renderStages() {
  let group = '';
  const extras = Object.values(concepts).filter(
    (c) =>
      c.scene === state.scene &&
      !(state.local && remoteOnly.has(c.id)) &&
      !trace.some((e) => e.conceptId === c.id),
  );
  $('stages').innerHTML =
    (extras.length
      ? `<div class="stage-group">Inside this view</div>${extras.map((c) => `<button class="stage ${c.id === state.selected ? 'selected' : ''}" data-concept="${c.id}"><span class="stage-number">◇</span><span>${c.title}</span><span class="stage-arrow">›</span></button>`).join('')}`
      : '') +
    trace
      .map((e, index) => {
        const c = concepts[e.conceptId],
          label = sceneName(c.scene),
          header = group === label ? '' : `<div class="stage-group">${label}</div>`;
        group = label;
        return `${header}<button class="stage ${state.selected === c.id && index === state.position ? 'selected' : ''} ${index < state.position ? 'visited' : ''}" data-stage="${index}" ${index === state.position ? 'aria-current="step"' : ''}><span class="stage-number">${index < state.position ? '✓' : String(index + 1).padStart(2, '0')}</span><span>${c.title}${e.kind === 'decode' ? ` <small>Pass ${e.payload.decode}</small>` : e.kind === 'denoise' ? ` <small>Step ${e.payload.refinement}</small>` : ''}</span><span class="stage-arrow">›</span></button>`;
      })
      .join('');
  $('stage-count').textContent = String(trace.length);
  $('fallback-stages').innerHTML = trace
    .map((e, i) => `<button data-stage="${i}">${i + 1}. ${concepts[e.conceptId].title}</button>`)
    .join('');
  const selected = $('stages').querySelector<HTMLElement>('.stage.selected');
  if (selected) {
    const list = $('stages'),
      top = selected.offsetTop - list.offsetTop;
    if (top < list.scrollTop || top + selected.offsetHeight > list.scrollTop + list.clientHeight)
      list.scrollTop = Math.max(0, top - 45);
  }
}
function seek(position: number) {
  const previousScene = state.scene;
  frame = frameAt(trace, position);
  state.position = frame.index;
  stageElapsed = 0;
  atlas?.setProgress(frame.decode, frame.refinement);
  selectConcept(frame.event.conceptId, { pause: false });
  focusJourneySubject(previousScene !== state.scene);
  renderPlayback();
}
function renderPlayback() {
  $<HTMLInputElement>('timeline').max = String(trace.length - 1);
  $<HTMLInputElement>('timeline').value = String(frame.index);
  $('playback-position').textContent = `${String(frame.index + 1).padStart(2, '0')} / ${trace.length}`;
  $('current-stage').textContent =
    `${concepts[frame.event.conceptId].title}${frame.event.kind === 'decode' ? ` · pass ${frame.decode}` : frame.event.kind === 'denoise' ? ` · step ${frame.refinement}` : ''}`;
  $('previous').toggleAttribute('disabled', frame.index === 0);
  $('next').toggleAttribute('disabled', frame.index === trace.length - 1);
  $('playback-position').title =
    'Position in the teaching replay. Inspecting additional concepts does not run the model.';
}
function renderInspector() {
  const c = concepts[state.selected];
  $('inspector-header').innerHTML =
    `<div class="concept-symbol">${icon(c.scene === 'world' ? 'expand' : 'cube')}</div><span class="eyebrow">${c.category}</span><h2>${c.title}</h2><p>${c.short}</p>`;
  ['learn', 'data', 'sources'].forEach((t) =>
    $(`${t}-tab`).setAttribute('aria-selected', String(state.inspector === t)),
  );
  if (state.inspector === 'learn')
    $('inspector-body').innerHTML =
      `<h3>What happens here</h3><p>${c.description}</p><dl class="io"><div><dt>↳ INPUT</dt><dd>${c.input}</dd></div><div><dt>↗ OUTPUT</dt><dd>${c.output}</dd></div></dl>${c.enter ? `<button class="enter-scene" data-scene="${c.enter}">Inspect ${c.enter === 'compute' ? 'the hardware' : c.enter === 'model' ? 'inference' : 'this block'} ${icon('expand')}</button>` : ''}<details class="deeper"><summary>A closer look</summary><p>${c.deeper}</p></details><div class="related"><h3>Connected concepts</h3>${c.related.map((id) => `<button data-concept="${id}">${concepts[id].title} <span>↗</span></button>`).join('')}</div>`;
  else if (state.inspector === 'sources')
    $('inspector-body').innerHTML =
      `<h3>Grounded in public documentation</h3><p>These sources describe the underlying concepts, not a trace of your selected provider.</p><div class="source-list">${c.sources.map((id) => `<a href="${sources[id].url}" target="_blank" rel="noreferrer">${sources[id].title} ${icon('expand')}</a>`).join('')}</div><h3>What is simplified</h3><p>${c.deeper}</p>`;
  else renderData();
}
function renderData() {
  const id = state.selected;
  if (id === 'sampling') {
    $('inspector-body').innerHTML =
      `<span class="data-label">ILLUSTRATIVE · SYNTHETIC DISTRIBUTION</span><h3>Choose the next word</h3><p class="sample-sentence">“The sky is <strong>_____</strong>”</p><div class="slider-label"><label for="temperature">Temperature</label><output id="temperature-value">${state.temperature.toFixed(1)}</output></div><input id="temperature" type="range" min="0" max="2" step="0.1" value="${state.temperature}" aria-label="Synthetic temperature"><div class="range-captions"><span>Focused / greedy</span><span>More varied</span></div><div id="sample-bars"></div><label class="seed-label">Seed <input id="seed" type="number" value="${state.seed}" min="0" max="999999"></label><button class="primary full" id="sample-again">Sample another seed</button><p class="small">Five invented logits, a complete toy distribution. This experiment changes neither a live request nor a received answer.</p>`;
    renderSampling();
  } else if (['tokenizer', 'context', 'embedding'].includes(id)) {
    const ids = toyEncode(latestPrompt);
    $('inspector-body').innerHTML =
      `<span class="data-label">${promptObserved ? 'OBSERVED · LOCALLY CAPTURED INPUT' : 'ILLUSTRATIVE · EXAMPLE INPUT'}</span><pre class="input-preview">${esc(latestPrompt)}</pre><span class="data-label">ILLUSTRATIVE · TOY UTF-8 BYTE TOKENIZER</span><p>${ids.length} bytes · IDs 0–255 · not provider tokens</p><div class="token-ids">${ids
        .slice(0, 160)
        .map((n) => `<span>${n}</span>`)
        .join(
          '',
        )}</div>${ids.length > 160 ? '<p class="small">First 160 byte IDs shown.</p>' : ''}<p class="small">Whitespace is preserved. Multi-byte characters occupy several IDs. This is not BPE; these counts are not used for billing.</p>`;
  } else if (id === 'attention') {
    const words = ['The', 'sky', 'is', 'blue'];
    $('inspector-body').innerHTML =
      `<span class="data-label">ILLUSTRATIVE · CAUSAL MASK</span><h3>Only look backward</h3><p>Rows are query positions; columns are key positions. Future positions are masked.</p><div class="heatmap" role="img" aria-label="Synthetic causal attention matrix. Each row attends only to itself and earlier positions."><span></span>${words.map((w) => `<span>${w}</span>`).join('')}${words.map((w, r) => `<span>${w}</span>${words.map((_, col) => (col <= r ? `<span class="heat-cell" style="--weight:${(col + 1) / (((r + 1) * (r + 2)) / 2)}">${Math.round(((col + 1) / (((r + 1) * (r + 2)) / 2)) * 100)}%</span>` : '<span class="heat-cell masked">—</span>')).join('')}`).join('')}</div><p class="small">Synthetic values, not observed attention or an explanation of hidden reasoning.</p><details class="deeper"><summary>The equation</summary><p class="formula">softmax(QKᵀ / √d + mask)V</p><p>The mask sets future-position scores to negative infinity before softmax.</p></details>`;
  } else if (['cache', 'decode', 'prefill'].includes(id)) {
    const pieces = ['The', ' sky', ' is', ' blue'];
    $('inspector-body').innerHTML =
      `<span class="data-label">ILLUSTRATIVE · PREFILL / DECODE</span><h3>${frame.decode ? `Decode pass ${frame.decode}` : 'Prompt prefill'}</h3><p>Prefill processes the prompt. Each decode pass adds a new position and reuses earlier keys and values.</p><div class="token-ribbon">${pieces
        .slice(0, Math.max(1, frame.decode + 1))
        .map((s, i) => `<span class="${i ? 'new-token' : ''}">${esc(s)}</span>`)
        .join(
          '',
        )}</div><div class="cache-demo">${Array.from({ length: 6 }, (_, i) => `<div><small>Layer ${i + 1}</small>${Array.from({ length: 4 + frame.decode }, (_, j) => `<i class="${j >= 4 ? 'new' : ''}" title="Illustrative position ${j + 1}"></i>`).join('')}</div>`).join('')}</div><p class="small">Six illustrative layers; four initial positions. These are diagram counts, not provider dimensions or cache contents.</p><button class="enter-scene" id="next-decode">Advance to a decode pass ${icon('next')}</button>`;
  } else if (concepts[id].scene === 'tools') {
    const n = ['intent', 'host', 'mcp', 'tool-result'].indexOf(id);
    $('inspector-body').innerHTML =
      `<span class="data-label">ILLUSTRATIVE · SIMULATED TOOL TRACE</span><h3>24 × 7</h3><ol class="tool-trace">${['Model proposes multiply(24, 7)', 'Host validates fixed arguments', 'Client → server: multiply(24, 7)', 'Result 168 returns to context'].map((s, i) => `<li class="${i <= n ? 'done' : ''}">${s}</li>`).join('')}</ol><pre>${esc(JSON.stringify(n < 3 ? { tool: 'multiply', arguments: { a: 24, b: 7 }, simulated: true } : { result: 168, next: 'model step', simulated: true }, null, 2))}</pre><p class="small">A fixed calculator fixture. No external tool or account is accessed.</p>`;
  } else if (['vision', 'diffusion'].includes(concepts[id].scene)) {
    $('inspector-body').innerHTML =
      `<span class="data-label">ILLUSTRATIVE · BUNDLED IMAGE FIXTURE</span><div id="image-fixture" class="image-fixture"></div><p>${concepts[id].scene === 'vision' ? 'Pixels → visual features → language context. The landscape is authored in code and stays on this device.' : `Refinement ${frame.refinement} / 3 shown in the scene. The progression blends seeded noise with fixture art; it is not real denoising.`}</p><p class="small">No image-generation or vision endpoint is called.</p>`;
    import('./scene.ts').then(({ landscapeCanvas }) => {
      if ($('image-fixture')) $('image-fixture').replaceChildren(landscapeCanvas());
    });
  } else
    $('inspector-body').innerHTML =
      `<span class="data-label">ILLUSTRATIVE · ${['world', 'compute'].includes(concepts[id].scene) ? 'REPRESENTATIVE INFRASTRUCTURE' : 'LOGICAL COMPUTATION'}</span><h3>What this view can show</h3><p>${concepts[id].deeper}</p><dl class="io"><div><dt>RELATIONSHIP</dt><dd>${id === 'datacenter' ? 'Contains racks and servers' : id === 'gpu' ? 'Executes model operations' : id === 'router' ? 'Forwards network traffic' : 'Participates in the selected journey'}</dd></div><div><dt>LIVE TELEMETRY</dt><dd>Not available through this text adapter</dd></div></dl><button class="enter-scene" id="open-chat-data">See observed request data ${icon('next')}</button>`;
}
function renderSampling() {
  const p = distribution([3.1, 2.3, 1.4, 0.6, -0.2], state.temperature),
    chosen = sample(p, state.seed),
    words = ['blue', 'clear', 'bright', 'grey', 'quiet'];
  $('sample-bars').innerHTML =
    p
      .map(
        (v, i) =>
          `<div class="probability ${i === chosen ? 'chosen' : ''}"><span>${words[i]} ${i === chosen ? '<b>✓</b>' : ''}</span><div><i style="width:${v * 100}%"></i></div><output>${(v * 100).toFixed(1)}%</output></div>`,
      )
      .join('') +
    `<p class="sample-choice">Selected: <strong>${words[chosen]}</strong> <span>· seed ${state.seed}</span></p>`;
}
function renderChat() {
  $('messages').innerHTML = history.length
    ? history
        .map(
          (m) =>
            `<article class="message ${m.role}"><div><strong>${m.role === 'user' ? 'You' : m.mode === 'demo' ? 'Sample response' : 'Assistant'}</strong><span>${m.mode === 'legacy' ? 'Restored · not sent' : m.mode === 'demo' ? 'Illustrative' : m.state === 'running' ? 'Receiving' : m.state || 'Observed'}</span></div><p>${esc(m.content || (m.state === 'running' ? 'Waiting for response…' : 'No text received.'))}</p></article>`,
        )
        .join('')
    : `<div class="chat-empty"><span>${icon('chat')}</span><h3>What happens after Enter?</h3><p>Run a sample and explore the systems behind a response.</p></div>`;
  $('messages').scrollTop = $('messages').scrollHeight;
  save('atlas-history', history.slice(-60));
  renderReceivedData();
}
function renderReceivedData() {
  const messages = boundedContext(history, $<HTMLTextAreaElement>('prompt').value || latestPrompt);
  $('received-data').innerHTML =
    `<p>Next live request: ${Math.max(0, (messages.length - 2) / 2)} complete prior live exchanges + current input. Maximum four exchanges and 12,000 content characters; prompt limit 6,000. Demo, restored, cancelled and errored responses are not sent.</p><p><strong>Observed:</strong> ${esc(receipt)}</p>${
      receiptEvents.length
        ? `<ol>${receiptEvents
            .slice(-5)
            .map((e) => `<li>${new Date(e.time).toLocaleTimeString()} · ${esc(e.event)}</li>`)
            .join('')}</ol>`
        : ''
    }<p>Usage: ${latestResult?.usage ? esc(JSON.stringify(latestResult.usage)) : 'not available'}</p><h4>API token candidates · observed</h4>${
      latestResult?.tokens.length
        ? latestResult.tokens
            .slice(0, 12)
            .map(
              (t) =>
                `<details><summary>Selected ${esc(JSON.stringify(t.token))}</summary>${t.candidates.map((c) => `<div class="observed-candidate ${c.chosen ? 'chosen' : ''}"><code>${esc(JSON.stringify(c.token))}</code><span>${(c.probability * 100).toFixed(3)}% ${c.chosen ? '✓ selected' : ''}</span></div>`).join('')}</details>`,
            )
            .join('') +
          '<p>Returned candidates only; not renormalised. First 12 output-token records shown.</p>'
        : '<p>Not available. Enable logprobs only if your model supports them.</p>'
    }`;
}
function cancelRequest() {
  if (gate.status === 'running') {
    gate.cancel();
    const last = history.at(-1);
    if (last?.role === 'assistant' && last.state === 'running') last.state = 'cancelled';
    $('request-status').textContent = 'Cancelled · partial text preserved';
    receiptEvents.push({ time: Date.now(), event: 'Local request cancelled' });
    renderChat();
  }
  $('stop-request').hidden = true;
}
async function send() {
  const prompt = $<HTMLTextAreaElement>('prompt').value;
  if (!prompt.trim()) {
    toast('Write a message or choose the example prompt.');
    return;
  }
  if (prompt.length > 6000) {
    toast('Keep the prompt within 6,000 characters.');
    return;
  }
  if (mode === 'live' && !config.model.trim()) {
    openSettings();
    return;
  }
  // Browsing a branch can change the teaching scenario during a live request.
  // A subsequent text request restores its own timeline without cancelling twice.
  if (mode === 'live' && state.scenario !== 'text') {
    state.scenario = 'text';
    $<HTMLSelectElement>('scenario').value = 'text';
    $('journey-name').textContent = scenarios.text.name;
    $('journey-description').textContent = scenarios.text.subtitle;
    $('example').textContent = scenarios.text.prompt + ' ↗';
  }
  cancelRequest();
  latestPrompt = prompt;
  promptObserved = true;
  latestResult = undefined;
  receiptEvents = [];
  const messages = boundedContext(history, prompt);
  history.push({ role: 'user', content: prompt, mode, state: 'completed' });
  const output: Message = { role: 'assistant', content: '', mode, state: 'running' };
  history.push(output);
  $<HTMLTextAreaElement>('prompt').value = '';
  renderChat();
  const run = gate.start();
  trace = makeTrace(mode === 'live' ? 'text' : state.scenario, state.local, run.id);
  seek(0);
  setPlaying(true);
  if (mode === 'demo') {
    output.content = scenarios[state.scenario].answer;
    output.state = 'completed';
    gate.finish(run.id, 'completed');
    $('request-status').textContent = 'Sample ready · journey is a teaching replay';
    receipt = 'Demo mode: no live request made';
    renderChat();
    return;
  }
  $('stop-request').hidden = false;
  $('request-status').textContent = 'Connecting · playback is independent';
  const start = performance.now();
  receipt = 'Request sent from this browser';
  receiptEvents.push({ time: Date.now(), event: receipt });
  try {
    const result = await requestText(config, messages, run.signal, (text, event) => {
      if (!gate.current(run.id)) return;
      output.content = text;
      receipt = `${event} · ${(performance.now() - start).toFixed(0)} ms since send (client)`;
      receiptEvents.push({ time: Date.now(), event });
      renderChat();
    });
    if (!gate.finish(run.id, 'completed')) return;
    latestResult = result;
    output.content = result.text;
    output.state = 'completed';
    $('request-status').textContent = `Response received · ${result.finishReason || 'completed'}`;
    renderChat();
  } catch (error) {
    if (!gate.finish(run.id, 'error')) return;
    output.state = 'error';
    $('request-status').textContent = `Error: ${error instanceof Error ? error.message : 'Request failed'}`;
    receipt = `Request failed after ${(performance.now() - start).toFixed(0)} ms (client)`;
    renderChat();
  } finally {
    if (run.id === gate.generation) $('stop-request').hidden = true;
  }
}
function chooseScenario(id: string) {
  cancelRequest();
  setPlaying(false);
  state.scenario = id;
  $<HTMLSelectElement>('scenario').value = id;
  trace = makeTrace(id, state.local);
  latestPrompt = scenarios[id].prompt;
  promptObserved = false;
  $('journey-name').textContent = scenarios[id].name;
  $('journey-description').textContent = scenarios[id].subtitle;
  $('example').textContent = scenarios[id].prompt + ' ↗';
  if (id !== 'text' && mode === 'live') {
    mode = 'demo';
    $<HTMLSelectElement>('mode').value = mode;
    updateMode();
  }
  seek(0);
}
function updateMode() {
  $('mode-note').textContent =
    mode === 'demo'
      ? 'Scripted sample responses. No account or API key needed.'
      : 'Actual text response from your endpoint. The 3D journey remains illustrative.';
  $('send').innerHTML = `${mode === 'demo' ? 'Run demo' : 'Send request'} ${icon('send')}`;
  if (mode === 'live' && state.scenario !== 'text') chooseScenario('text');
  renderReceivedData();
}
function openSettings() {
  $<HTMLInputElement>('provider-url').value = config.url;
  $<HTMLInputElement>('provider-model').value = config.model;
  $<HTMLInputElement>('provider-key').value = config.key;
  $<HTMLInputElement>('provider-stream').checked = config.stream;
  $<HTMLInputElement>('provider-logprobs').checked = config.logprobs;
  $('settings-error').textContent = '';
  $<HTMLDialogElement>('settings-dialog').showModal();
  updateJourney({ type: 'SET_SUSPENSION', reason: 'SETTINGS', suspended: true });
}
function search() {
  const q = $<HTMLInputElement>('search-input').value.trim().toLowerCase(),
    matches = Object.values(concepts).filter(
      (c) => !q || `${c.title} ${c.short} ${c.id} ${c.category}`.toLowerCase().includes(q),
    );
  $('search-results').innerHTML = matches.length
    ? matches
        .slice(0, 12)
        .map(
          (c) =>
            `<button data-search-concept="${c.id}"><span class="search-result-icon">${icon('cube')}</span><span><strong>${c.title}</strong><small>${sceneNames[c.scene]}</small></span>${icon('next')}</button>`,
        )
        .join('')
    : '<p class="no-results">No concepts found. Try “attention”, “GPU”, “MLP” or “MCP”.</p>';
}
document.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('button, a');
  if (!b) return;
  if (b.classList.contains('object-label')) return;
  if (b.dataset.close) $<HTMLDialogElement>(b.dataset.close).close();
  if (b.dataset.scene) goScene(b.dataset.scene as SceneId);
  if (b.dataset.concept) selectConcept(b.dataset.concept);
  if (b.dataset.stage) {
    navigateStage(Number(b.dataset.stage));
  }
  if (b.dataset.searchConcept) {
    $<HTMLDialogElement>('search-dialog').close();
    selectConcept(b.dataset.searchConcept);
    showPanel('inspector');
  }
  switch (b.id) {
    case 'home':
      e.preventDefault();
      goScene('world');
      break;
    case 'theme':
      state.dark = !state.dark;
      document.documentElement.dataset.theme = state.dark ? 'dark' : 'light';
      save('atlas-theme', state.dark ? 'dark' : 'light');
      atlas?.setDark(state.dark);
      applyAppearance();
      renderDarkPreference();
      b.setAttribute('aria-label', state.dark ? 'Toggle light theme' : 'Toggle dark theme');
      break;
    case 'appearance-open':
      $<HTMLDialogElement>('appearance-dialog').showModal();
      break;
    case 'journey-tab':
      setTab('journey');
      break;
    case 'chat-tab':
      setTab('chat');
      break;
    case 'learn-tab':
    case 'data-tab':
    case 'sources-tab':
      state.inspector = b.id.split('-')[0];
      renderInspector();
      break;
    case 'collapse-journey':
      showPanel('journey', false);
      break;
    case 'collapse-inspector':
      showPanel('inspector', false);
      break;
    case 'restore-journey':
    case 'mobile-journey':
      showPanel('journey');
      break;
    case 'restore-inspector':
    case 'mobile-inspector':
      showPanel('inspector');
      break;
    case 'search-open':
      $<HTMLDialogElement>('search-dialog').showModal();
      search();
      $<HTMLInputElement>('search-input').focus();
      break;
    case 'settings-open':
      openSettings();
      break;
    case 'about-open':
      $<HTMLDialogElement>('about-dialog').showModal();
      break;
    case 'play':
      if (journey.journeyMode === 'MANUAL' || journey.guidedFocus === 'DETACHED') break;
      if (state.position === trace.length - 1) seek(0);
      setPlaying(!journeyAdvancing(journey));
      break;
    case 'start-tour':
      updateJourney({ type: 'START' });
      seek(0);
      break;
    case 'previous':
      navigateStage(state.position - 1);
      break;
    case 'next':
      navigateStage(state.position + 1);
      break;
    case 'replay':
      updateJourney({ type: 'START' });
      seek(0);
      break;
    case 'resume-focus':
      resumeGuidedFocus();
      break;
    case 'reset-camera':
    case 'fit-scene':
      detachGuidedFocus();
      atlas?.reset();
      break;
    case 'focus-selection':
      detachGuidedFocus();
      atlas?.focus();
      break;
    case 'toggle-labels':
      state.labels = !state.labels;
      atlas?.setLabels(state.labels);
      b.setAttribute('aria-pressed', String(state.labels));
      break;
    case 'example':
      $<HTMLTextAreaElement>('prompt').value = scenarios[state.scenario].prompt;
      $<HTMLTextAreaElement>('prompt').focus();
      break;
    case 'stop-request':
      cancelRequest();
      break;
    case 'clear-chat':
      cancelRequest();
      history = [];
      latestResult = undefined;
      receipt = 'No live request yet';
      receiptEvents = [];
      $('request-status').textContent = 'Conversation cleared';
      renderChat();
      setPlaying(false);
      break;
    case 'sample-again':
      state.seed = (state.seed + 1) % 1000000;
      $<HTMLInputElement>('seed').value = String(state.seed);
      renderSampling();
      break;
    case 'next-decode': {
      let i = trace.findIndex((e, j) => j > state.position && e.kind === 'decode');
      if (i < 0) i = trace.findIndex((e) => e.kind === 'decode');
      if (i >= 0) seek(i);
      else toast('Switch to the text scenario to explore autoregressive decoding.');
      break;
    }
    case 'open-chat-data':
      setTab('chat');
      ($('received-data').parentElement as HTMLDetailsElement).open = true;
      break;
  }
});
document.addEventListener('input', (e) => {
  const el = e.target as HTMLInputElement;
  if (el.id === 'timeline') {
    navigateStage(Number(el.value));
  }
  if (el.id === 'search-input') search();
  if (el.id === 'temperature') {
    state.temperature = Number(el.value);
    $('temperature-value').textContent = state.temperature.toFixed(1);
    renderSampling();
  }
  if (el.id === 'seed') {
    state.seed = Math.max(0, Math.min(999999, Math.floor(Number(el.value) || 0)));
    renderSampling();
  }
  if (el.id === 'explode') {
    atlas?.setExplode(Number(el.value) / 100);
    $('explode-value').textContent = el.value + '%';
  }
  if (el.id === 'prompt') renderReceivedData();
});
document.addEventListener('change', (e) => {
  const el = e.target as HTMLInputElement;
  if (el.name === 'palette' && (el.value === 'custom' || palettes.some((p) => p.id === el.value))) {
    appearance.palette = el.value;
    applyAppearance();
  }
  if (el.id === 'scenario') chooseScenario(el.value);
  if (el.id === 'route') {
    state.local = el.value === 'local';
    atlas?.setLocal(state.local);
    trace = makeTrace(state.scenario, state.local);
    setPlaying(false);
    seek(0);
  }
  if (el.id === 'speed') state.speed = Number(el.value);
  if (el.id === 'journey-mode') updateJourney({ type: 'SET_MODE', mode: el.value as JourneyMode });
  if (el.id === 'mode') {
    cancelRequest();
    mode = el.value as 'demo' | 'live';
    updateMode();
  }
  if (el.id === 'follow') {
    if (!el.checked) detachGuidedFocus();
  }
});
$('chat-form').addEventListener('submit', (e) => {
  e.preventDefault();
  void send();
});
$('settings-form').addEventListener('submit', (e) => {
  e.preventDefault();
  try {
    config = {
      url: validateEndpoint($<HTMLInputElement>('provider-url').value.trim()),
      model: $<HTMLInputElement>('provider-model').value.trim(),
      key: $<HTMLInputElement>('provider-key').value.trim(),
      stream: $<HTMLInputElement>('provider-stream').checked,
      logprobs: $<HTMLInputElement>('provider-logprobs').checked,
    };
    if (!config.model) throw new Error('Enter a model identifier.');
    const { key: _key, ...safe } = config;
    save('atlas-provider', safe);
    $<HTMLDialogElement>('settings-dialog').close();
    toast('Connection saved. Your key stays in this tab’s memory.');
  } catch (err) {
    $('settings-error').textContent = (err as Error).message;
  }
});
$('settings-dialog').addEventListener('close', () => {
  $<HTMLInputElement>('provider-key').value = '';
  // A queued close event must not release a newly reopened modal's suspension.
  if (!$<HTMLDialogElement>('settings-dialog').open)
    updateJourney({ type: 'SET_SUSPENSION', reason: 'SETTINGS', suspended: false });
});
// Native backdrop clicks target the dialog itself. Check bounds so clicks on
// the panel's padding do not dismiss it, and slider drags ending outside are safe.
for (const id of ['settings-dialog', 'appearance-dialog']) {
  const dialog = $<HTMLDialogElement>(id);
  let backdropPress = false;
  const outside = (event: MouseEvent) => {
    const rect = dialog.getBoundingClientRect();
    return (
      event.clientX < rect.left ||
      event.clientX >= rect.right ||
      event.clientY < rect.top ||
      event.clientY >= rect.bottom
    );
  };
  dialog.addEventListener('pointerdown', (event) => {
    backdropPress = event.target === dialog && outside(event);
  });
  dialog.addEventListener('click', (event) => {
    if (backdropPress && event.target === dialog && outside(event)) dialog.close();
    backdropPress = false;
  });
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape')
    document.querySelectorAll('.mobile-open').forEach((el) => el.classList.remove('mobile-open'));
  const activeTab = (e.target as HTMLElement).closest<HTMLButtonElement>('[role="tab"]');
  if (activeTab && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
    e.preventDefault();
    const tabs = Array.from(activeTab.parentElement!.querySelectorAll<HTMLButtonElement>('[role="tab"]')),
      index = tabs.indexOf(activeTab);
    const next =
      e.key === 'Home'
        ? 0
        : e.key === 'End'
          ? tabs.length - 1
          : (index + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    tabs[next].focus();
    tabs[next].click();
    return;
  }
  if ((e.target as HTMLElement).matches('input, textarea, select')) {
    if ((e.target as HTMLElement).id === 'search-input' && e.key === 'Enter') {
      e.preventDefault();
      document.querySelector<HTMLButtonElement>('[data-search-concept]')?.click();
    }
    if ((e.target as HTMLElement).id === 'prompt' && e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
    return;
  }
  if (document.querySelector('dialog[open]')) return;
  if (e.key === '/') {
    e.preventDefault();
    $('search-open').click();
  }
  if ((e.target as HTMLElement).matches('button, a, summary')) return;
  if (e.key === ' ') {
    e.preventDefault();
    $('play').click();
  }
  if (e.key === 'ArrowRight') {
    navigateStage(state.position + 1);
  }
  if (e.key === 'ArrowLeft') {
    navigateStage(state.position - 1);
  }
});
function tick(time: number) {
  const dt = time - animationLast;
  animationLast = time;
  if (!document.hidden) {
    stageElapsed = advanceJourneyTime(journey, stageElapsed, dt, state.speed);
    if (journeyAdvancing(journey) && stageElapsed >= trace[state.position].duration) {
      if (state.position < trace.length - 1) seek(state.position + 1);
      else setPlaying(false);
    }
  }
  requestAnimationFrame(tick);
}
document.documentElement.dataset.theme = state.dark ? 'dark' : 'light';
$<HTMLInputElement>('ground-grid').checked = groundGrid;
const intensityControl = $<HTMLInputElement>('grid-intensity');
const renderGridPreference = () => {
  intensityControl.value = String(gridIntensity);
  intensityControl.disabled = !groundGrid;
  intensityControl.setAttribute('aria-valuetext', `${gridIntensity}%`);
  $('grid-intensity-value').textContent = `${gridIntensity}%`;
};
renderGridPreference();
$('ground-grid').addEventListener('change', () => {
  groundGrid = $<HTMLInputElement>('ground-grid').checked;
  save('atlas-ground-grid', groundGrid);
  atlas?.setGrid(groundGrid);
  renderGridPreference();
});
intensityControl.addEventListener('input', () => {
  gridIntensity = Number(intensityControl.value);
  save('atlas-grid-intensity', gridIntensity);
  atlas?.setGridIntensity(gridIntensity);
  renderGridPreference();
});
const darkControl = $<HTMLInputElement>('dark-appearance');
function renderDarkPreference() {
  darkControl.value = String(darkAppearance);
  darkControl.disabled = !state.dark;
  darkControl.setAttribute(
    'aria-valuetext',
    `${darkAppearance}% deeper${darkAppearance === 0 ? ' (default)' : ''}`,
  );
  $('dark-appearance-value').textContent = darkAppearance === 0 ? 'Default' : `${darkAppearance}%`;
  $('dark-appearance-mode-note').hidden = state.dark;
}
renderDarkPreference();
darkControl.addEventListener('input', () => {
  if (!state.dark) return;
  darkAppearance = readDarkAppearance(Number(darkControl.value));
  save('atlas-dark-appearance', darkAppearance);
  applyThemeTokens();
  renderDarkPreference();
});
applyAppearance();
chooseScenario('text');
renderChat();
requestAnimationFrame(tick);
$('theme').setAttribute('aria-label', state.dark ? 'Toggle light theme' : 'Toggle dark theme');
// Keep the viewport clear of a resized panel, without carrying desktop widths into mobile.
let panelResizeFrame = 0;
const panelObserver = new ResizeObserver(() => {
  cancelAnimationFrame(panelResizeFrame);
  // Apply ancestor layout changes outside ResizeObserver's delivery cycle.
  panelResizeFrame = requestAnimationFrame(() => {
    const panel = $('journey-panel');
    if (innerWidth > 980 && !panel.classList.contains('collapsed')) {
      const width = `${Math.round(panel.getBoundingClientRect().width)}px`;
      if (document.documentElement.style.getPropertyValue('--left') !== width)
        document.documentElement.style.setProperty('--left', width);
    }
  });
});
panelObserver.observe($('journey-panel'));
window.addEventListener('resize', () => {
  $('journey-panel').style.removeProperty('width');
  document.documentElement.style.removeProperty('--left');
});
function fallback() {
  atlas?.dispose();
  atlas = undefined;
  $('viewport').hidden = true;
  $('fallback').hidden = false;
  $('atlas-main').classList.add('without-webgl');
  showPanel('journey');
  toast('3D rendering is unavailable. The full HTML journey is ready to explore.');
}
import('./scene.ts')
  .then(({ AtlasScene: Scene }) => {
    $('viewport').replaceChildren();
    try {
      atlas = new Scene(
        $('viewport'),
        (id) => {
          if (journey.active && id !== frame.event.conceptId) detachGuidedFocus();
          // A scene-object inspection changes exploration selection, not the
          // official trace position, scenario, or accumulated teaching time.
          selectConcept(id, { pause: !journey.active, keepScene: id === 'cache' && state.scene === 'block' });
          showPanel('inspector');
        },
        detachGuidedFocus,
        fallback,
      );
      atlas.setDark(state.dark);
      atlas.setGrid(groundGrid);
      atlas.setGridIntensity(gridIntensity);
      atlas.setPalette(appearance);
      atlas.setLocal(state.local);
      atlas.setProgress(frame.decode, frame.refinement);
      atlas.setScene(state.scene, !journey.active);
      atlas.setSelected(state.selected);
      renderJourneyControl();
      focusJourneySubject();
    } catch {
      fallback();
    }
  })
  .catch(fallback);
window.addEventListener('pagehide', () => {
  cancelAnimationFrame(panelResizeFrame);
  panelObserver.disconnect();
  gate.cancel();
  atlas?.dispose();
});
if (legacyNotice) toast('The old saved API key was removed. Re-enter it in Settings to use live mode.');
