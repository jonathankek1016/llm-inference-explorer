# V4 release-candidate verification

This guide describes the implemented V4 candidate on `v4`. Package version remains **3.1.0** until a separately authorized release-version change. The repository source is authoritative for behavior. The V4 architecture specification v2 and addenda v2.1/v2.2 describe the destination and inherited ownership/lifecycle rules; V3.1 implementation references describe the preserved journey mechanics.

## Reproduce

Use Node.js 22.18+ or a newer supported release. The validation environment is Windows, Node 26.3.0, npm 11.16.0 and installed Microsoft Edge. On PowerShell with script restrictions, use `npm.cmd` / `npx.cmd`.

```sh
npm ci
npm test
npm run test:e2e
npm run format:check
npm run build
npm audit
npm audit --omit=dev
npm audit signatures
npm ls --depth=0
git diff --check
```

`npm run build` runs strict TypeScript checking (`tsc --noEmit`) before producing `dist/`. ESLint is not configured; Prettier is the repository's formatting check. The complete Playwright suite uses one worker, Edge on Windows and Chromium elsewhere. On other platforms, install its browser with `npx playwright install chromium`. It starts a development server on port 5173 when none is running.

For production-bundle validation, start `npm run preview -- --host 127.0.0.1 --port 4173 --strictPort` in another terminal, then run:

```sh
npm run verify:preview
npm run verify:visual
npm run verify:palettes
```

All three scripts verify **Explore as the fresh startup workspace**, then explicitly enter Demo for their established authored-scene/playback checks. They do not change the product default. Browser cleanup runs even if a standalone assertion fails. Stop the local preview after validation; none of these commands deploys the application.

## Automated coverage

The current inventory is **116 unit/module integration tests and 179 browser tests**. These are test counts, not a guarantee for untested providers, browsers or devices. No tests are skipped to establish a release result.

| Area                       | Assertions and evidence                                                                                                                                                                                         |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Startup and roots          | Fresh startup/reload opens Explore; Demo and Live remain functional; hidden hosts do not receive keyboard navigation or borrow the visible workspace's state.                                                   |
| Shared concepts            | All 32 existing identities and authored references resolve. Taxonomy is acyclic, placements deterministic, and future categories remain unpopulated rather than fabricated.                                     |
| Explore catalogue          | Category-space galleries, independent exhibits, taxonomy/3D selection, search, canonical reference, sources and connected concepts. Root/category levels do not duplicate contents in the Inspector.            |
| Usage graph                | Derived authored locations preserve repeated usages, routes and scenario context. Usage navigation remains idle or preserves retained/parked sessions; it does not silently start another lesson.               |
| Global Guided Session      | One incomplete reservation; explicit admission conflicts; cross-root detachment; manual return remains detached; global Return restores guidance; completion releases only the reservation.                     |
| Local presentation         | Independent camera poses, scene bookmarks, pins and Inspector state; local emphasis/particles; hidden renderers do not draw; shared scheduler and disposal behavior.                                            |
| Demo journey               | All four authored scenarios traverse every stage. Manual/Auto, timeline seeking, elapsed-time continuity, Stop, completion, Replay, Explore freely and Resume retain their distinct semantics.                  |
| Reading and suspension     | Reading Hold has bounded leases; Settings/Appearance compose with Pause/detachment. Particle phase is sampled at the actual suspension boundary and continues according to existing post-close rules.           |
| Request lifecycle          | Explicit request identity and transitions, one-in-flight admission, cancellation/stale fencing, errors and partial results. Requests outlive parked/completed/ended education and remain owned by Live.         |
| Text transport             | Controlled JSON/SSE responses, split UTF-8/CRLF, whitespace, optional usage/finish reason/logprobs and safe failure handling.                                                                                   |
| Image capabilities         | Matching configuration declarations are required. Unknown/Unsupported remain disabled; Supported becomes reachable through Settings. Model/connection changes invalidate declarations.                          |
| Image requests             | Real file validation and multimodal payload construction with intercepted transport; generated URL/base64 validation, malformed/unsafe media rejection, cancellation and ownership after completion/navigation. |
| Tool/citation observations | Returned structured calls and citations, stream-fragment assembly, safe text/URL rendering and request identity. Keywords alone never establish tools, MCP, RAG or search execution.                            |
| Provenance                 | Observed, Locally calculated, Illustrative, Inferred/Representative and Unknown remain distinct; late evidence enriches stable stages without rewriting educational history.                                    |
| UI/accessibility           | Shared shell geometry, capability guidance, declaration form/heading hierarchy, keyboard access, disclosures, themes, reduced motion, responsive sheets and forced Demo WebGL fallback.                         |

## Audit-fix regressions

- **B1:** Explore default startup and independent idle hosts.
- **B2:** Pristine Live exploratory cards without a request, guided card or session reservation.
- **B3:** Request-specific Demo credential redaction, including configuration changes before failure; Live retains shared sanitization.
- **B4:** Admitted same-stage Live Replay clears the old Reading Hold without resending or clearing Settings ownership.
- **D1:** Eight repaired assertions retain meaningful ownership checks: Demo-only toolbar count; two detached emphasis cases; two suspension-phase cases; functional Live instead of the old scaffold; Auto/Manual completed Demo camera isolation through Explore, Live and back to Demo.
- **D2:** Request-scoped evidence disclosures survive educational rerenders and newly appended evidence; new requests do not inherit unrelated disclosure state.
- **D3:** Generation-model copy truthfully says it is required for image generation.

The later regression remediation updates the terminal Replay assertion to **Replay from start** and explicitly checks Completed/disabled Play, stage-1 restart, effective Auto advancement and subsequent Pause. No test is deleted or relaxed to accept a different lifecycle.

## Production and visual scripts

`verify:preview` checks production-only calibration exclusion, Explore startup, Demo scenes and scenarios, playback/request separation, six responsive sizes, runtime errors/warnings and unexpected external requests. It samples actual WebGL calls over 500 ms: a settled idle view must issue zero calls, while teaching playback must draw. This is a local sample, not a universal FPS or cold-start performance claim.

`verify:visual` checks ten viewport sizes in each theme at native 100% zoom. It verifies full-window canvas bounds, page overflow, title bounds, framing bounds, visible heading/control/text clearance and text/heatmap contrast. The invisible camera-framing guide is not a clipping boundary and may underlap overlay headings; clearance is measured against visible controls and rendered text, including wrapped subtitle lines, rather than empty container space.

`verify:palettes` checks all six presets in light/dark mode and the custom appearance dialog on desktop/mobile. Existing geometry assertions remain in place.

Generated evidence includes:

- `artifacts/preview-verification.json`, `final-explore.png`, `final-overview.png` and authored-scene/responsive screenshots.
- `artifacts/refinement/visual-audit.json` and light/dark screenshots at each size.
- `artifacts/palettes/` for presets and custom appearance.
- Browser screenshots under `artifacts/v4/`; failure attachments under `test-results/`.

These paths, `dist/` and Playwright reports are ignored by Git. Screenshots require actual inspection; their existence alone is not visual approval.

## Remediation validation results — 13 November 2026

Validated the uncommitted remediation on `v4`, based on `a9b969d83c2fa9b39d03b5bbc78f0bef4d8933ce`, with package version still 3.1.0.

| Check                                      | Result                                                                                                            |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| Strict TypeScript and production build     | PASS; 50 modules; existing scene-chunk size warning only                                                          |
| Unit/module integration tests              | PASS; 116 passed, 0 failed, 0 skipped                                                                             |
| Complete browser suite                     | PASS; 179 passed in 18.6 minutes; no failed tests                                                                 |
| Production preview verification            | PASS; zero idle draw calls, positive playback drawing, no runtime errors/warnings or unexpected external requests |
| Visual verification                        | PASS; 20 light/dark layouts and contrast checks                                                                   |
| Palette verification                       | PASS; six presets in both themes and custom desktop/mobile appearance                                             |
| Formatting and whitespace                  | PASS; Prettier and `git diff --check`                                                                             |
| Full and production-only dependency audits | PASS; zero vulnerabilities in both                                                                                |
| Registry signature/provenance verification | PASS; 31 verified signatures and 14 verified attestations                                                         |

The complete browser run is recorded in `artifacts/remediation-e2e.log`. Its PowerShell wrapper returned exit 1 because redirected Node colour-environment warnings were classified as `NativeCommandError`; Playwright reported all 179 tests passed and recorded `status: passed` with no failed tests. A separate harmless diagnostic reproduced this shell behavior with a native process exit of 0. This is an execution-wrapper caveat, not a suppressed test failure.

Representative generated Explore desktop and Demo light/dark tablet/mobile screenshots, including the dark mobile appearance dialog, were visually inspected. This does not substitute for the manual/device/provider coverage below.

## Dependencies and limits

The targeted development-toolchain remediation pins Vite **8.3.8**. Its normal dependency path resolves PostCSS **8.5.32** and source-map-js **1.2.2**, addressing the Vite/launch-editor and indexed-source-map advisories reported by the previous audit. No forced audit fix, dependency override, production-dependency change or application-version bump is used. The lockfile also records Vite's compatible bundler/native-binding updates. Re-run audits when preparing release: advisory databases can change.

The separately loaded Three.js/scene bundle still produces Vite's warning for chunks over 500 kB. It is a size advisory, not a type/build failure or a measured performance result.

Real-provider authentication, CORS, billing, every model/backend combination, deployment security headers, Firefox/WebKit, physical mobile hardware and formal screen-reader/accessibility certification are **not verified** by this suite. Requests use mocks/intercepts; no real credentials or paid quota are required. Tool/citation observations do not imply app-owned execution: MCP, RAG, web-search execution and audio/video remain outside scope. Real input/output never upgrades educational 3D models into telemetry.
