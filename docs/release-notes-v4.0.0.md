# LLM Inference Explorer 4.0.0

Release preparation on `v4`, following V3.1.0. These notes describe the implemented release candidate; they do not announce a published tag, GitHub release or deployment.

## Three workspaces, one concept universe

- **Explore** is the default entry and canonical reference atlas. Browse a hierarchical catalogue, independent category galleries, concept references, connected concepts and sources. Supported concepts reuse existing assets; unpopulated categories do not claim completed content.
- **Demo Lab** preserves the authored V3.1 teaching experience, scenarios, Journey/Chat and Manual/Auto interaction grammar. The legacy Scripted demo / Live API request-source control remains separate from root workspace navigation.
- **Live Lab** supports real text, image-understanding and image-generation requests through explicitly configured compatible endpoints, with request/result and contextual evidence surfaces.

Stable concept identities and reusable reference content connect the workspaces. The generated usage graph exposes actual authored Demo locations without duplicating reverse lookup tables. Demo/Live Inspectors can open the exact canonical Explore concept. Opening a Demo usage does not implicitly start a guided journey; parked and completed sessions retain their lifecycle protections.

## Guidance and local presentation

One incomplete Demo/Live educational session may reserve the global guided slot. Cross-workspace browsing detaches and parks guidance; ordinary workspace return remains detached, while Return/Resume restores the official context using inherited recovery semantics. Completion releases the global reservation while retaining the local terminal presentation.

Start, Stop/End current, Complete, Replay and Explore freely remain distinct. Manual/Auto intent, elapsed teaching time, Reading Hold, Settings/Appearance suspension and request execution retain separate meanings.

Explore, Demo and Live own their local scenes, selections, cameras, callouts and Inspector state. Explore uses category-space galleries rather than Demo process ordering and remains free of foreign guided emphasis or teaching particles. Workspace renderers share frame scheduling; hidden renderers do not draw.

## Live requests and truthful evidence

Live request identity, preparation, execution, completion, failure and cancellation are independent of educational guidance. Requests may continue across navigation, detachment, lesson completion or End current. A one-in-flight Live request policy and stale-result fencing protect request ownership; educational Replay does not resend a request.

- Text and image understanding use compatible Chat Completions transport. Streaming, usage, finish reason and logprobs are shown only where genuinely returned and supported.
- Image understanding validates actual PNG/JPEG/WebP input and constructs multimodal payloads.
- Image generation uses a configured generation model and compatible image-generation endpoint. Returned URL/base64 media is validated; no intermediate image-progress stream is invented.
- Image modes require matching, explicit backend capability declarations. Unknown and Unsupported remain unavailable. Configuration guidance explains unmet requirements without claiming automatic provider discovery.
- Structured tool-call objects and citations are observable provider data, not proof of tool/search execution.

Events and incremental traces preserve request identity and stable educational context. Provenance distinguishes **Observed**, **Locally calculated**, **Illustrative**, **Inferred/Representative** and **Unknown**. Real requests never turn the educational 3D models into hidden provider telemetry.

## Usability and release hardening

Shared workspace shell geometry, capability-status rows, Settings form flow, section headings, disclosure styling and responsive light/dark layouts are aligned. Audit fixes add pristine Live exploratory callouts, request-specific legacy Demo error redaction, admitted Live Replay Reading Hold cleanup, request-scoped evidence disclosure memory and truthful image-generation configuration wording.

Regression checks now reflect Explore startup and terminal Replay semantics. Vite 8.3.8 and its compatible dependency tree include PostCSS 8.5.32 and source-map-js 1.2.2, addressing the advisories found during release validation. Production dependency versions are unchanged from the reviewed remediation baseline.

## Compatibility and limits

- The V3.1 Demo journey behavior and V4 ownership architecture are preserved. This release does not add a teaching-content or 3D-model overhaul.
- Browser requests require a backend with compatible schemas and CORS configuration. Capability declarations are user assertions based on backend documentation, not automatic detection.
- API keys remain in tab memory. Live inputs/results are not persistent run history; legacy Demo chat retains its existing bounded history behavior.
- No app-owned MCP/tool execution, tool continuation, RAG execution, web-search execution, audio or video is included. No fake Live usage entries or provider evidence are created.
- Automated provider coverage uses mocks/intercepts. Real-provider credentials/CORS/billing, Firefox/WebKit, physical mobile hardware, deployment security headers and formal screen-reader testing remain separate manual validation areas.
- The production build retains the existing scene-chunk size warning; it is not a measured runtime-performance failure.

See [verification](verification.md) for exact test results, commands and evidence. Merging to `main`, tags, releases and deployment are outside this preparation pass.
