# LLM Inference Explorer

**What happens after I press Enter?** Explore the answer in an interactive 3D atlas, from your device and network to server hardware, model computation and the response coming home.

V4 separates three workspaces: **Explore**, the canonical concept atlas and default entry; **Demo Lab**, deterministic authored lessons; and **Live Lab**, real browser-to-provider requests with an independent educational journey. Explore and Demo need no API key. The 3D models remain educational illustrations even when a real request runs.

Package version **4.0.0** is prepared on `v4` for release. See the [V4.0.0 release notes](docs/release-notes-v4.0.0.md) for changes and boundaries. Main-branch promotion, tagging and publication remain separate release steps.

## Run locally

Use Node.js **22.18+** (or a newer supported release) and npm. Validation uses Node 26.3.0 on Windows and Microsoft Edge.

```sh
npm ci
npm run dev
```

Open **http://127.0.0.1:5173**. On Windows PowerShell with script execution disabled, use `npm.cmd` in place of `npm`.

```sh
npm run build           # TypeScript check and production bundle in dist/
npm run preview         # Local production preview, normally port 4173
npm test                # Unit/module integration tests
npm run test:e2e        # Complete browser suite, with intercepted provider responses
npm run format:check
npm run verify:preview  # Requires the production preview on port 4173
npm run verify:visual   # Requires the same preview
npm run verify:palettes # Requires the same preview
npm audit
npm audit --omit=dev
```

Browser tests use installed Microsoft Edge on Windows. On other platforms, run `npx playwright install chromium` once. The browser suite starts Vite if needed. Screenshots and reports are written to ignored `artifacts/` and `test-results/` directories. Tests use mocks/intercepts, not paid model requests. ESLint is not configured; formatting is checked with Prettier.

## Three workspaces

| Workspace | Purpose and navigation                                                                                                                                                                                                                                                                                                                 |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Explore   | Starts at the concept atlas. Browse categories, subcategories and concepts; search opens canonical reference. Independent category exhibits share concept IDs without implying a process sequence. The Inspector opens for concepts and contains reference material, sources, connected concepts and generated **Used in Demo** links. |
| Demo Lab  | Select an authored text, tool, image-understanding or image-generation scenario. Journey/Chat, cloud/on-device routes and Overview/Hardware/Model/Block views retain their teaching behavior. The contextual Inspector explains the selected lesson location and offers **Explore this concept**.                                      |
| Live Lab  | Configure a connection, submit text or an enabled image request, and inspect returned results/evidence. The dynamic educational journey is separate from request execution. A real request does not turn the illustrative atlas into provider telemetry.                                                                               |

Explore covers Request & application, Network & transport, Serving infrastructure, Model inference, Tools & orchestration, Vision / multimodal understanding and Image generation. Retrieval and Web / search remain truthful, unpopulated taxonomy areas. Demo usages are derived from authored scenario/stage definitions; runtime observations do not fabricate permanent Live usage entries.

Drag to orbit, scroll/pinch to zoom, and right-drag to pan. Select objects or labels for concise exploratory callouts; use the Inspector for deeper content. Explore, Demo and Live retain local presentation state rather than sharing camera poses or guided cards. Search is available through the header or `/` where applicable. Panels collapse or become sheets on narrow screens; Escape closes overlays.

Theme, palette, grid and display preferences save automatically. Six preset palettes and a custom accent work in light and dark themes. Controls support keyboard access; reduced motion suppresses teaching-particle animation. The Demo HTML journey and Inspector remain usable if WebGL fails.

## Guided sessions and requests

Only **one incomplete Demo/Live Guided Session** owns the global slot. Browsing another workspace parks/detaches it while preserving official stage, mode, playback intent and elapsed teaching time. Returning through a workspace tab does not reattach; **Resume focus** or global **Return to active session** restores guidance. Settings, Appearance and Reading Hold affect educational presentation, not backend execution.

- **Start journey** and **Replay from start** use guided-session admission.
- **Manual/Auto** choose educational advancement, not provider execution speed.
- **Stop journey / End current** ends incomplete education without cancelling a request.
- Natural Auto completion or Manual **Complete journey** releases the global slot and retains the local Completed presentation.
- **Replay from start** begins a new educational traversal; Live Replay does not resend the request.
- **Explore freely** leaves the retained Completed presentation for neutral local exploration. It does not navigate to the Explore root.
- **Cancel request** belongs to request execution and does not implicitly Stop the lesson.

Live has its own one-in-flight request policy. A second request is rejected while one is running; cancellation fences stale callbacks. A request may finish while the learner browses Explore, after its lesson completes, or while Demo owns the guided slot. Its result remains Live-owned. Local cancellation cannot guarantee remote computation or billing stops.

## Model connection and capabilities

Open **Settings > Model connection** to enter a compatible base URL, model and optional API key. Requests go directly from the browser; the backend must permit CORS and support the selected wire format. Other provider schemas need an adapter. There is no automatic capability discovery or inference from provider branding or prompt keywords.

| Request family      | Configuration and transport                                                                                                                                                                                                                  |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Text                | Chat Completions-compatible `/chat/completions`; optional SSE, usage, finish reason and logprobs where returned.                                                                                                                             |
| Image understanding | Actual PNG/JPEG/WebP input, with optional text, sent as multimodal Chat Completions content. Requires matching image+text support declarations; requested image streaming/logprobs also require support.                                     |
| Image generation    | `/images/generations` with one image. Requires an image-generation model identifier plus declared generation and generated-media return support. Returned URL/base64 media is validated. No intermediate image-progress stream is simulated. |

The expandable **Live image capability declarations** section contains user assertions based on backend documentation, not measured telemetry. Unknown and Unsupported image modes remain disabled. Connection/model identity changes invalidate declarations. The Live capability rows explain missing requirements and link to the existing configuration flow. Unsupported requests are not silently retried or downgraded.

Structured provider tool-call objects and citations are displayed as observations. **No tool/MCP execution, tool continuation, RAG execution or web-search execution is implemented.** A citation does not prove search ran; a tool-call object does not prove execution occurred.

Keys stay in this tab's memory, are excluded from stored preferences, and disappear on reload. Errors redact the credential belonging to the failed request. Live inputs/results/media stay in memory; a new request replaces the displayed media result. Non-secret connection settings and appearance preferences persist locally.

Demo retains its legacy **Request source: Scripted demo / Live API** control. It is not the root Demo/Live selector. Scripted responses are authored fixtures. The legacy Live API path preserves bounded conversation context, local chat history, streaming and cancellation; only complete eligible exchanges enter its bounded context. Clearing that chat removes its saved history. Changing the illustrative compute route does not change the configured endpoint.

## Evidence and boundaries

Evidence carries explicit provenance: **Observed**, **Locally calculated**, **Illustrative**, **Inferred/Representative**, or **Unknown**. Returned text/usage/logprobs are observations only when actually supplied. App-side elapsed timing and calculations are not provider telemetry. Missing evidence stays unknown.

The toy tokenizer uses deterministic UTF-8 byte IDs, not provider tokenisation or a billing estimate. Sampling and attention experiments are authored educational representations. The representative pre-normalised decoder, six visible blocks, cache geometry, network route, GPU and teaching particles do not expose actual provider internals, tensors, cache contents, hidden reasoning or hardware allocation. Real image input/output does not validate a particular hidden model architecture.

## Implementation

Vite + TypeScript + direct Three.js, without an application backend or UI framework.

| Modules                                                                                         | Responsibility                                                                                   |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `content.ts`, `concept-registry.ts`, `usage-graph.ts`, `content-overlays.ts`                    | Shared concept identities/facts, canonical reference, generated usages and contextual overlays   |
| `workspace.ts`, `main.ts`, `guided-session.ts`                                                  | Explicit destinations, root coordination and one incomplete educational reservation              |
| `core.ts`, `navigation.ts`, `reading-hold.ts`                                                   | Inherited local journey, navigation and reading semantics                                        |
| `explore.ts`, `explore-catalogue.ts`, `explore-scene.ts`, `workspace-state.ts`                  | Category navigation, independent exhibit placement and Explore presentation memory               |
| `scene.ts`, `scene-loop.ts`, `callouts.ts`, `callout-layer.ts`, `emphasis.ts`                   | Retained workspace visuals, shared frame scheduling, local callouts/emphasis and camera behavior |
| `live-workspace.ts`, `live-journey.ts`                                                          | Live UI and incremental educational traversal                                                    |
| `live-request.ts`, `live-events.ts`, `live-trace.ts`, `provenance.ts`                           | Independent request/run identity, lifecycle, evidence and stable trace construction              |
| `provider.ts`, `live-capabilities.ts`, `live-input.ts`, `live-media.ts`, `live-observations.ts` | Transport, scoped capability declarations, media validation and structured observations          |
| `shell.ts`, `style.css`, `icons.ts`                                                             | Responsive, accessible shell and controls                                                        |

All module paths above are under `src/`. Retained workspace renderers share one frame scheduler; hidden renderers do not draw. Scene resources are disposed on replacement. Static rendering is demand-driven; pixel ratio is capped at 1.6. This is not a universal performance guarantee.

## Verification and remaining limits

The current suite contains **116 unit/module integration tests and 179 browser tests**. It covers workspace/session isolation, concept navigation, cameras/callouts, completion and recovery, request independence, capabilities, JSON/SSE parsing, images, tool/citation observations, provenance, redaction, responsive UI and audit-fix regressions. See [the verification guide](docs/verification.md) for commands, scope, results and limitations.

Live integration is validated with controlled responses, not paid credentials or a compatibility claim for every provider. Physical mobile devices, Firefox/WebKit, screen readers, deployment security configuration and universal performance require separate validation. Audio/video, real MCP/RAG/search execution and a teaching-content/model overhaul are outside this V4 scope.

## Why I built this

This began as my first AI-assisted (“vibe coded”) project and the first software project I was proud to share publicly. I come from a cybersecurity and infrastructure background. While learning about transformers, I kept asking a simpler question: **what is the AI actually doing while generating my reply?**

This atlas continues that personal learning journey. It connects familiar systems to less familiar computation, with clarity and intellectual honesty as the priorities. It complements deeper tools such as [Transformer Explainer](https://github.com/poloclub/transformer-explainer) and [BertViz](https://github.com/jessevig/bertviz).

Sources are linked next to each concept, including [Hugging Face's cache explanation](https://huggingface.co/docs/transformers/cache_explanation), [the official MCP architecture](https://modelcontextprotocol.io/docs/learn/architecture), [LLaMA](https://arxiv.org/abs/2302.13971), [LLaVA documentation](https://huggingface.co/docs/transformers/model_doc/llava), and [Diffusers text-to-image guidance](https://huggingface.co/docs/diffusers/using-diffusers/conditional_image_generation). The Human Atlas reference inspired the floating interface, not the subject matter or branding.

Feedback and corrections are welcome through [GitHub](https://github.com/jonathankek1016) or [LinkedIn](https://www.linkedin.com/in/jonathan-kek/).

MIT licence · © 2026 **jonathankek1016**. See [LICENSE](LICENSE). Locally bundled fonts retain their own open-font licences.
