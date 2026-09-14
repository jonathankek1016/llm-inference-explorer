# v2.0.0 verification

This guide covers validation of the 3D Interactive Atlas, including navigation, camera controls, playback, error recovery, responsive layouts and appearance preferences. The original MIT licence and author attribution are preserved.

## Reproduce

```sh
npm ci
npm test
npm run test:e2e
npm run format:check
npm run build
npm run preview
```

With the preview running at `http://127.0.0.1:4173`, run `npm run verify:preview` in another terminal. It writes screenshots and a machine-readable report to `artifacts/`. On Windows with PowerShell script restrictions, use `npm.cmd`. Browser tests use installed Edge on Windows and Playwright Chromium elsewhere.

## Acceptance audit

| Area                       | Result and evidence                                                                                                                                                                                                                                      |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| First launch               | Immediately displays procedural, interactive WebGL infrastructure in the light theme; no credentials or external asset requests. Production preview checked.                                                                                             |
| Connected scales           | Overview, cloud/on-device hardware, model, and expanded transformer block share concept IDs, breadcrumbs, search, selection and inspector content. Browser navigation and camera checks pass.                                                            |
| Text inference             | Context, deterministic toy byte encoding, embeddings/position, prefill, six representative blocks, per-layer cache, projection/sampling, repeated decode and return are inspectable. Synthetic internals remain labelled.                                |
| Expanded block             | Representative pre-normalised order: normalisation, attention, residual addition, normalisation, MLP, residual addition. Two visible bypass paths, cache, individual concept selection and assembled/exploded states inspected.                          |
| Optional stories           | Calculator/MCP orchestration, image patches/fusion and latent-diffusion-style image refinement each have a complete selectable fixture trace. Plain text excludes those branches.                                                                        |
| Playback                   | All four stories play from first stage through return at 2×, select each stage in order, then stop. Seeking, backward navigation, replay, pause and speed changes also checked. Navigation/replay makes no answer request.                               |
| Camera                     | Orbit, zoom, reset, focus, fit, labels and manual/follow interaction exercised. Screenshot comparisons confirm that orbit, zoom and focus change the rendering.                                                                                          |
| Live adapter               | Controlled JSON and streaming SSE responses; one-byte UTF-8/CRLF splits, output whitespace, optional usage, absent logprobs, selected non-top candidate, error handling and truncated streams. No paid endpoint used.                                    |
| Lifecycle                  | Abort, clear while pending, late completion, subsequent send, recoverable HTTP error, partial response preservation and bounded completed-live context are covered. Keys disappear on reload and are absent from persisted preferences/history fixtures. |
| Input                      | Empty, whitespace, Chinese, emoji, mixed text and long input covered by state tests and browser flows. Toy encoding round-trips valid Unicode. UI rejects whitespace-only sends and limits prompts to 6,000 UTF-16 code units.                           |
| Responsive panels          | Desktop floating panels; dismissible sheets at widths ≤980px. Tablet regression checks ensure the closed panels leave a full-width canvas and that sheet switching/dismissal survives desktop resizing.                                                  |
| Accessibility and fallback | Labelled HTML controls, keyboard tabs/search/Escape, reduced-motion mode and dark theme checked. Forced WebGL failure retains usable journey navigation and inspector content. This is not a formal assistive-technology audit.                          |
| Asset resilience           | Geometry and landscape art are authored locally; fonts are bundled with licences. No glTF prop, remote font, model download or paid service is needed for any demo scene.                                                                                |

The suite contains **15 unit tests and 13 browser tests**, including theme contrast, the in-app colour picker, grid preferences, automatic persistence and independent connection saving. The production bundle passes TypeScript checking. Vite reports a size advisory for the separately loaded Three.js/scene chunk (approximately 597 kB minified, 151 kB gzip); it is not a compile error. The production-preview audit checks for runtime errors, warnings and unexpected external requests.

## Visual inspection

Screenshots were opened and reviewed, not merely captured. The inspected set includes overview, hardware, model, block at both explosion endpoints, tools, image understanding, image generation, settings, chat, dark theme, on-device compute and mobile inspector.

Run `npm run verify:visual` to check both themes at native 100% zoom across ten viewport sizes, from 2048×1140 down to 360×640. It checks full-window canvas bounds, heading clearance, contrast and absence of page overflow. Run `npm run verify:palettes` for all six presets and the custom picker on desktop and mobile.

Useful generated files include `artifacts/final-overview.png`, `final-model.png`, `final-block-exploded.png`, `final-tools.png`, `final-vision.png`, `final-diffusion.png`, `final-tablet-portrait.png`, `final-small-laptop.png`, `final-mobile-inspector.png` and `preview-verification.json`. Artifacts are deliberately ignored by Git and regenerated by the verification commands.

## Runtime checks and limits

- The preview report records browser, renderer and startup timing locally. Performance varies by device and browser; a local sample is not a cold-network performance guarantee.
- The settled scene issued **zero WebGL draw calls during 500 ms**. Playback resumed drawing. The script counts actual WebGL calls rather than equating animation callbacks with rendered frames; it does not establish universal FPS.
- Pixel ratio is capped at 1.6, geometry/materials are reused, replaced scene resources are disposed, static rendering is demand-driven, and hidden-page animation work is skipped.
- Live compatibility was tested with controlled mocks. Provider CORS, authentication, billing and every provider/model variant were not validated against real credentials.
- The atlas is an educational representation, not hardware/network telemetry or a view into a provider's hidden reasoning. Tools and image branches are fixtures; no real MCP server, local LLM or image model is executed.
