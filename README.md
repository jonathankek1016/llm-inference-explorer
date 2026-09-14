# LLM Inference Explorer

**What happens after I press Enter?** Explore the answer in an interactive 3D atlas, from your device and network to server hardware, model computation and the response coming home.

The light-first interface uses floating HTML panels around procedural Three.js scenes. A working demo opens immediately, with no API key. An optional personal BYOK connection supplies real text responses; the atlas remains an educational illustration.

## Run locally

Use Node.js **22.18+** (or a newer supported release) and npm. The implementation was verified with Node 26.3.0 on Windows and Microsoft Edge.

```sh
npm ci
npm run dev
```

Open **http://127.0.0.1:5173**. On Windows PowerShell with script execution disabled, use `npm.cmd` in place of `npm`.

```sh
npm run build       # TypeScript check and production bundle in dist/
npm run preview     # Preview the production bundle, normally port 4173
npm test            # Deterministic state, Unicode and provider tests
npm run test:e2e    # Browser interaction and controlled mock API tests
npm run verify:preview # Screenshots and runtime audit; requires the preview on port 4173
```

Browser tests use installed Microsoft Edge on Windows. On other platforms, run `npx playwright install chromium` once. The browser suite starts Vite if needed. Screenshots are written to the ignored `artifacts/` directory. No test makes a paid model request.

## Explore the atlas

| View                | What you can inspect                                                                                                                                          |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Request journey     | Laptop, Wi-Fi/router, representative backbone and data centre, outbound request and return path                                                               |
| Hardware            | Service ingress, rack, accelerator board and model weights; an alternate on-device route                                                                      |
| Model               | Context preparation, toy token IDs, embeddings and position, prompt prefill, repeated transformer blocks, per-layer KV cache, projection, sampling and decode |
| Transformer block   | Two normalisations, attention, MLP and two residual additions, with an explode control and a synthetic causal matrix                                          |
| Tools & MCP         | Simulated tool-call intent, application host, client/server communication, calculator result and another model step                                           |
| Understand an image | A bundled landscape, visual patches/encoder and connection to language context                                                                                |
| Generate an image   | Representative text conditioning, seeded noise, illustrative refinement and image decoding                                                                    |

Choose a scenario at the top. Use **Journey** to navigate the stages or **Chat** to run a sample. The inspector offers **Learn**, **Data**, and **Sources**, with deeper explanations and links between concepts.

- Drag the scene to orbit, scroll/pinch to zoom, and right-drag to pan.
- Click a model object or its label to inspect it. **Inspect inference** and **Inspect this block** enter nested views. Breadcrumbs and the scale controls return to broader views.
- Search with the search button or `/`. Try `KV cache`, `attention`, `GPU`, `MLP`, or `MCP`.
- Use the **Colour palette** button beside the theme toggle to choose Original Sage, Powder Blue, Soft Lavender, Dusty Rose, Warm Apricot, Monochrome or a custom accent. The palette persists across reloads and works in both modes; dark surfaces stay neutral. Custom text and surface shades adapt for contrast.
- Open **Settings → Display** to show or hide the faint ground grid. This preference saves immediately, independently of model connection settings. The 3D environment spans the window beneath the floating frosted interface.
- Play/pause, previous/next, seek, speed, and replay affect teaching playback only. With the page focused, Space toggles playback and the arrow keys step through it.
- Manual camera interaction turns off **Follow journey**. Re-enable it to restore guided framing. Camera controls reset, fit, focus and toggle labels.
- Collapse panels when you want more open space. The desktop journey panel can be resized at its lower-right corner. Tablet and mobile use dismissible sheets; Escape closes overlays.
- Tab reaches controls; arrow keys switch tabs. The system reduced-motion preference suppresses decorative travel animation. A rendering failure retains the HTML journey and inspector.

## Demo and live behaviour

**Demo** returns the selected scenario's labelled sample response, even if you type a different question. It is a repeatable teaching fixture, not an in-browser language model. The tool and image scenarios do not connect to external services or accounts.

For **Live API**, open Settings and use **Model connection** to enter a Chat Completions compatible base URL and a model identifier, then supply your own key if required. Streaming and logprobs are separately configurable. The browser calls `/chat/completions` directly; the provider must allow browser requests through its CORS policy. Native provider APIs with different schemas need an adapter. Changing the illustrative cloud/local route does **not** change your configured API endpoint.

There is one answer request per send, with no narration request and no silent retry for unsupported capabilities. Missing logprobs leave a usable text response and an explicit “not available.” Provider-returned candidate probabilities are not renormalised, and the selected token stays identified even when another candidate has higher probability.

Live context contains the current prompt and up to four complete earlier live exchanges, bounded by 12,000 user/assistant content characters. The prompt field accepts up to 6,000 UTF-16 code units. The fixed system instruction and provider chat-template overhead are additional; this character limit is not a tokenizer-based context limit. Demo, legacy-restored, cancelled and errored exchanges are excluded. **Context & received data** shows the policy, client receipt events, optional usage and available candidates.

**Stop request** aborts local receipt where possible and preserves partial text. Clear chat cancels active work. Generation IDs prevent stale completions from changing a newer run. Pausing the atlas does not stop a remote request; local cancellation cannot guarantee that the provider stopped computation or billing.

Keys remain in the current tab's memory and disappear on reload. The old prototype's `ai-key` entry is removed rather than silently migrated. Theme, non-secret endpoint settings and conversation history are saved locally. Legacy conversation text is restored for display, labelled as excluded from sent context. Clear chat removes the current saved conversation.

## Evidence and boundaries

- **Observed:** locally captured user input, actual returned text, optional usage/logprobs, and client-measured receipt times.
- **Illustrative:** infrastructure placement, model diagrams, toy IDs, synthetic probabilities and attention, cache counts, tool traces and image fixtures.
- **Playback:** deliberate timing, camera transitions and animated travel. This is not provider latency, throughput or packet telemetry.

The tokenizer is explicitly a deterministic **UTF-8 byte toy**, with IDs 0–255. It preserves valid Unicode and whitespace and is not BPE, provider tokenisation or a billing estimate. The sampling experiment uses stable softmax, an explicit zero-temperature greedy case and a seed; it cannot alter an answer already received.

The block order follows a representative pre-normalised decoder layout informed by LLaMA. Six visible model blocks are a drawing choice, not a model specification. Inference does not update trained weights. Context and KV caches are not permanent conversational memory, databases or stores of finished answers. Nothing exposes hidden chain-of-thought, proprietary activations, real cache contents or hardware utilisation.

Image understanding uses a representative encoder/connector path. Image generation is a latent-diffusion-style illustration using locally authored art and seeded noise; its frames are not genuine intermediate model states. Other architectures differ.

## Implementation

Vite + TypeScript + direct Three.js keep the original small browser-app footprint without adding a framework or backend.

| Module                                          | Responsibility                                                                                            |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `src/content.ts`                                | Concept registry, sources, scene hierarchy, typed relationships and scenario fixtures                     |
| `src/core.ts`                                   | Deterministic traces/playhead state, toy encoding, seeded sampling, cancellation gate and bounded context |
| `src/provider.ts`                               | Chat Completions JSON/SSE parsing, Unicode-safe stream assembly and selected-token identity               |
| `src/scene.ts`                                  | Procedural geometry, labels, picking, camera controls, resource disposal and fixture image drawing        |
| `src/main.ts`                                   | UI state, navigation, playback and request lifecycle                                                      |
| `src/shell.ts`, `src/style.css`, `src/icons.ts` | Accessible HTML panels, responsive themes and interface icons                                             |

The renderer is loaded separately from the HTML interface. Pixel ratio is capped at 1.6. Geometry and materials are reused; scene resources are disposed on replacement. Static scenes render on demand, and hidden pages suspend animation work. Hardware performance varies; the tests do not establish a universal frame rate.

## Verification and remaining limits

The test suite covers deterministic seeking, Unicode/whitespace, stable sampling, selected-token identity, cancellation/stale runs, bounded context, JSON/SSE parsing (including split multibyte input), unsupported capabilities, partial stream errors, all scenario stages, navigation, camera interaction, live error recovery with mocks, persistence, mobile sheets and renderer fallback.

Visual checks include overview, model, block, all optional branches, cloud/local hardware, light/dark themes, desktop, 1280×720 laptop, tablet and mobile layouts down to 360×640. See [the verification guide](docs/verification.md) for the checked workflows and runtime limits.

Live behaviour is verified with controlled mocks, not paid credentials or a compatibility claim for every provider. There is no real MCP connection, browser-hosted LLM, image inference endpoint or hardware telemetry. Training, distributed execution details, audio/video, expert routing and real tokenizer integration remain future extensions.

## Why I built this

This began as my first AI-assisted (“vibe coded”) project and the first software project I was proud to share publicly. I come from a cybersecurity and infrastructure background. While learning about transformers, I kept asking a simpler question: **what is the AI actually doing while generating my reply?**

This atlas continues that personal learning journey. It connects familiar systems to less familiar computation, with clarity and intellectual honesty as the priorities. It complements deeper tools such as [Transformer Explainer](https://github.com/poloclub/transformer-explainer) and [BertViz](https://github.com/jessevig/bertviz).

Sources are linked next to each concept, including [Hugging Face's cache explanation](https://huggingface.co/docs/transformers/cache_explanation), [the official MCP architecture](https://modelcontextprotocol.io/docs/learn/architecture), [LLaMA](https://arxiv.org/abs/2302.13971), [LLaVA documentation](https://huggingface.co/docs/transformers/model_doc/llava), and [Diffusers text-to-image guidance](https://huggingface.co/docs/diffusers/using-diffusers/conditional_image_generation). The Human Atlas reference inspired the floating interface, not the subject matter or branding.

Feedback and corrections are welcome through [GitHub](https://github.com/jonathankek1016) or [LinkedIn](https://www.linkedin.com/in/jonathan-kek/).

MIT licence · © 2026 **jonathankek1016**. See [LICENSE](LICENSE). Locally bundled fonts retain their own open-font licences.
