# PaperMotion

**Bring Learning PDFs to Life**

Open a learning PDF or Markdown document in your browser, explore its concepts through interactive visualizations, and study with document chat, flashcards, quizzes, and a knowledge graph.

This repository packages the working browser version with a configurable, server-side AI connection. The original Get It. interface and desktop source are retained; this version focuses on local web use.

## Run locally

Use Node.js 22 or newer and npm. Node.js 24 has been tested on Windows.

```sh
git clone https://github.com/zhenyuduan98/PaperMotion.git
cd PaperMotion
npm ci
```

Copy `.env.example` to `.env.local` (`Copy-Item .env.example .env.local` in PowerShell, or `cp .env.example .env.local` on macOS/Linux), then replace `PI_API_KEY` with your own key.

The example uses `https://copilot.chillicurry.uk/v1`, model `gpt-6-astra`, and `openai-responses`. This model requires the Responses endpoint on that service. You can use another compatible provider by changing the base URL, API type, and both model settings. The repository does not include an API key or API access.

```sh
npm run check:api
npm run browser:build
npm run browser:start
```

Open **http://127.0.0.1:3000**. Keep the terminal open while using the app; press Ctrl+C to stop it. For development, use `npm run browser:dev` instead of building and starting.

## 本机使用

1. 安装 Node.js 22 或以上版本，下载仓库后运行 `npm ci`。
2. 将 `.env.example` 复制为 `.env.local`，把 `PI_API_KEY` 改为自己的密钥。
3. 运行 `npm run check:api` 检查连接，再运行 `npm run browser:build` 和 `npm run browser:start`。
4. 浏览器打开 **http://127.0.0.1:3000**，上传含有可选中文字的 PDF 或 Markdown 文件，也可以打开内置示例。

## Edge and Chrome extension

The companion extension imports a PDF from the current browser tab into the local engine and provides sidebar chat, flashcards, quizzes, and concepts. Open the full interactive viewer for inline PDF tags, animations, and the other study tools.

With dependencies installed, run `npm run extension:build`, then load `extension/build` as an unpacked extension in Edge or Chrome. Keep the local engine running, open the extension sidebar, and approve its connection on the localhost pairing page.

See [extension/README.md](extension/README.md) for installation, permissions, limitations, and verification commands. Managed browsers may require administrator approval to install an unpacked extension.

## Edge release preparation

Run `npm run release:edge` with dependencies already installed to create versioned extension and companion-source ZIPs, license inventories, checksums, and submission drafts under `dist-release/edge/0.1.0`. The package verifier checks every archived file. `npm run release:edge:verify` additionally extracts the source package and tests the no-download prerequisite path.

This prepares a candidate; it does not publish, sign, register a developer account, or imply certification. Read [release/edge/READINESS.md](release/edge/READINESS.md) and [release/edge/SECURITY-REVIEW.md](release/edge/SECURITY-REVIEW.md). Supply real publisher details and public URLs in [release/edge/release.json](release/edge/release.json), approve the privacy policy, resolve security and consent gates, and complete clean-machine and store-ID testing before submission. `npm run release:edge:ready` fails while required fields or confirmations remain incomplete.

The companion source package includes a Windows launcher with explicit dependency installation; it is not a signed, self-contained installer. See [release/companion/START-HERE.md](release/companion/START-HERE.md). The source build and AI services can require network access. No registry or organization policy is bypassed.

## Interactive learning and revisions

### Evidence-linked explanations (prototype)

New **Formula**, **Source**, and **Step by Step** results generated from a document include a claim-level evidence map. Click the evidence markers beside formula lines or simulator pseudocode, or the claim links beneath a Source explanation. The panel distinguishes **Stated in the paper**, **Derived**, **Illustrative assumption**, and **Unsupported / not checked**, with rationale and clickable dependencies. **Show passage** highlights the corresponding PDF text; mobile readers switch to Document and can return with **Back to visualization**.

The model proposes claims, classifications, and exact quotations; the server resolves those quotations against the supplied PDF page using case-sensitive matching with whitespace normalization. Missing or ambiguous quotations are flagged, not linked as verified passages. Matching produces actual text offsets, a source-page hash, and approximate text-run highlight rectangles. A changed document/page is rejected when following a link. Classification and semantic support are model-assessed: **excerpt matched is not proof that the claim follows from it**. Derivations and calculations are not independently checked, and illustrative inputs are not paper findings.

An evidence claim pointing to a missing element (for example, a formula target left over after switching to Step by Step) is omitted along with claims that depend on it. A visible evidence warning reports the omission; valid evidence and the visualization remain available. We never guess a different target for that claim. Duplicate claim IDs and other invalid dependency structures are still rejected. Formula and derivation text fits its container down to a readable minimum size; longer expressions scroll inside their equation row rather than overflowing the panel.

Evidence is stored inside each visualization specification, so revision, undo, and saved-version switching retain the appropriate evidence. Existing results remain usable with **Evidence not checked**; generate a new version to add evidence. Source narratives remain English, but evidence quotations preserve the PDF's original language. This prototype uses the concept's source page, not document-wide retrieval. Graph/Canvas/3D object picking, OCR/image evidence, numerical proof checks, and human review status are not included yet. Inspecting evidence and switching saved versions make no AI requests; generating evidence is part of the normal generation call.

Tests: `npm run test:evidence` and `npm run test:evidence:browser` (built extension and installed Edge required).

In the full viewer, select a concept tag. The visualization controls offer **Animation**, **Step by Step**, **Formula**, **3D Model**, **Plot**, and **Source**. Choose a format and click **Generate**. In manual mode, selecting an ungenerated tag no longer starts a request before you choose its format; automatic generation remains available in Settings.

### Visualize a selected passage

You can create a visualization even when automatic detection missed a concept. Select text directly in the PDF, choose **Formula**, **Animation**, **Step by Step**, **3D Model**, **Graph**, or **Source** in the selection toolbar, optionally name the tag, and click **Generate selection**. On mobile, switch to **Document** first. The result opens in the study pane and its tag is saved with the document for reopening, revision, and retry.

Selections must contain 4-4000 characters from a single page. This uses the PDF's selectable text layer; image-only formulas, scanned passages, and image-region selection are not supported. The selected text and its source page are provided to the generator. Creating a manual tag does not rerun concept detection or overwrite existing visualizations, and works whether auto-generation is on or off. Requests use the configured generation model and visualization queue limits. Dismiss before generating to discard the selection without a model call.

Checks: `npm run test:manual-viz` and `npm run test:manual-viz:browser` (requires the built extension, installed Edge, and existing test dependencies).

- **Animation** is a live Canvas render, not a GIF. Pause, resume, restart, or change its playback speed.
- **Step by Step** generates an executable algorithm simulator with editable inputs (numbers, numeric arrays, switches, and option sets). Change inputs and click **Run simulation** to compute a fresh execution trace locally, without another AI request. Inspect the computed diagram states, variables, and highlighted pseudocode with previous/next, the timeline, or playback. **Reset inputs** restores the generated defaults. Invalid inputs or failed runs preserve the previous trace, marked as a previous run. Inputs reset to defaults when the page reloads.
- **Discuss and revise visualization** opens a per-concept feedback panel. For example: "The formula should multiply by velocity", "Show the allocation one block at a time", or "The 3D structure is missing a layer". The next request includes the current render, recent applied feedback, and source-page context.
- The current result stays visible while a revision runs. A failed revision preserves it. Feedback and results survive reloads. **Saved version** switches to any retained render without another AI call and keeps the other versions available, so you can return to the newer result. **Undo last revision** is also still available. The current render plus up to five other versions and twenty feedback entries are retained per concept; new generation prunes older history beyond that limit. Existing saved histories work without regenerating them, and background regeneration also preserves previous renders.
- Use the trash icon (**Delete visualization**) and confirm **Delete permanently** to remove an unwanted concept tag, its render, feedback, and saved versions. This applies to detected and manually selected concepts. The PDF, other concepts, and study history remain. Deletion cannot be undone; you can select the passage to create a new manual visualization later. A queued request is removed; an already-running request may finish and consume allowance, but its result is discarded. Deleted IDs remain recorded so late results, stale writes, or repeat detection cannot recreate the removed tag. Wait for an active manual revision to finish before deleting that concept.
- Narrow screens provide **Document** and **Study** views instead of squeezing both panes side by side. The Edge/Chrome sidebar's **Open interactive viewer** button opens this experience.

Generation and revisions use the selected provider and consume its allowance. Structural and code-syntax validation cannot guarantee factual or mathematical correctness; check the source and use feedback to correct mistakes. Ordinary document Chat remains separate from the visualization feedback panel.

Previously saved snapshot lessons remain viewable. Select **Step by Step** and **Generate** again to replace one with a simulator; no conversion happens silently. The generated algorithm can be revised through the existing feedback panel. Execution is limited to 500 steps, a bounded trace payload, and approximately 1.5 seconds in a worker inside a sandboxed opaque-origin frame. CSP blocks network access; generated code has no app DOM or storage access. Runs can be cancelled and do not execute on the server. Worker isolation does not provide a hard memory quota or prove algorithm correctness; use small inputs and verify important results against the source.

For an update while an existing server is running, set `GETIT_ISOLATED_BUILD=1` for both the build and start commands to use `.next-preview` instead of overwriting `.next`. Do not run two servers against the same data directory while either is writing; use a separate `GETIT_DATA_DIR` for a concurrent preview, or stop the old server once its jobs finish.

Checks: `npm run test:simulation` covers input validation, recomputation, and worker trace limits. `npm run test:viz-edit` covers lesson structure, prompt context, camera fitting, revision persistence, undo, and conflicts. `npm run test:viz-browser` uses a synthetic provider to exercise input changes without AI calls, playback, feedback, failure preservation, reloads, desktop/mobile rendering, and browser sandbox timeouts, cancellation, network blocking, and storage isolation. To exercise the same workflow through the Copilot fixture, run `node scripts/test-extension-browser.mjs --copilot --viz` after building the extension. The optional `npm run test:simulation:live` check uses real Copilot allowance to generate a simulator and verifies its algorithm with several synthetic inputs in the browser sandbox.

## GitHub Copilot

GitHub Copilot is available as a model engine for the browser app and its extension. No Codex account, custom API endpoint, or OpenAI API key is required for this option.

1. Install the official [GitHub Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/install-copilot-cli) using your organization's approved software source, if it is not already installed.
2. Run `copilot login` in your terminal and complete GitHub's sign-in flow. Your account and organization must allow Copilot CLI access; VS Code sign-in alone does not guarantee this.
3. Start the local engine, open **Settings**, and select **GitHub Copilot** under **Model Engine**. Choose separate **Generation model** and **Conversation model** options from your account's model list, or leave **Auto (Copilot chooses)** selected. Use the pencil button to enter another model ID; existing custom IDs remain editable and are not overwritten when Settings opens.
4. Retry your study action. Start a new chat when switching from a different provider; existing documents and study materials remain saved.

The API-key setup and `check:api` command above apply to BYOK, not Copilot. The example's third-party API URL is not GitHub Copilot's authentication endpoint.

The model dropdown loads a live account-specific catalog from `GET /api/provider/models` when Copilot Settings opens. The server starts a temporary metadata-only Copilot CLI process, checks its existing authentication, and calls `models.list` over its JSON-RPC interface. No credentials are returned to the browser, no PDF is sent, and no model inference is requested. The endpoint shares simultaneous lookups but does not retain completed results; HTTP responses are `no-store`. Use the refresh icon after switching CLI accounts or changing organization policy. Explicitly unavailable models are disabled in the list. Discovery errors show a retryable message while Auto and custom-ID entry remain available; saved selections are never silently replaced. Actual access and costs still depend on your account, organization policy, and CLI version. The regular same-origin API restrictions apply; the extension gateway does not expose account-model discovery.

Model changes apply after Settings saves them, to requests launched subsequently. In-flight Copilot calls, including their schema-correction turn, keep the model selected when they started. Existing visualizations are not regenerated automatically. The Conversation model applies to the next chat turn, not one already running.

PaperMotion invokes the real CLI directly, skipping VS Code installation bootstrappers and disabling automatic CLI updates. If the engine cannot find it, set `COPILOT_CLI_PATH` to the real executable or the installed npm package's JavaScript entry point and restart the engine. `GETIT_DEFAULT_PROVIDER=copilot`, `COPILOT_MODEL_FAST`, and `COPILOT_MODEL_SMART` provide optional defaults; saved Settings take precedence.

Study requests send relevant document text to GitHub Copilot and consume your plan's allowance. Organization restrictions remain in effect. Model tools are disabled, built-in MCP servers are disabled, and prompts run outside your project working directory without project instructions. This is not an OS-level sandbox. Copilot CLI manages its own credentials and native session storage; PaperMotion never reads VS Code tokens. The Account panel verifies connectivity on successful study requests rather than assuming an installed CLI is signed in. Reported consumption is available in the Account panel as described below.

Copilot responses are validated against each study tool's schema. A schema mismatch or a response requesting tools triggers at most one correction turn in the same session and with the same model. Both cases share that one-turn budget, and tools remain disabled throughout. This extra turn consumes Copilot allowance. Invalid corrected output is rejected; authentication, policy, and network errors are not retried by this correction step.

For **Source** concepts, Copilot summarizes the supplied document context rather than browsing. Background Source generation includes the extracted source page, as manual generation/revisions already do. Prompts require quotes to come from supplied text, prohibit invented references, and allow an empty citations list when no source URLs are supplied. The result must disclose that external sources were not verified. These are generation instructions, not an independent fact-checker; review important quotations against the PDF. If a Source tag failed before this fix, retry that tag; completed visualizations are not automatically changed.

**Source responses always use English**, regardless of the PDF or feedback language, for all providers. This includes titles, captions, body text, and citation descriptions. Non-English passages are paraphrased in English rather than copied or presented as verbatim translated quotations; URLs, identifiers, and proper names are preserved. The rule applies to new generation, revisions, and repairs. Regenerate an existing saved Source response to apply it; other visualization categories continue to follow the source language.

Run `npm run test:copilot` for adapter checks, `npm run test:copilot-models` for discovery/protocol/API checks, and `npm run test:copilot:browser` for the extension workflow using a local CLI fixture, including model discovery and correction of an oversized graph overview. The fixture tests do not authenticate your account or consume Copilot quota. Live use still requires `copilot login`.

## Configuration and saved work

### Consumption metrics

Open **Account** to view today's provider usage; the panel refreshes every five seconds while open and has a manual refresh button. Token totals remain available for other providers, with reported USD cost for API-key providers and Codex subscription limits where supported.

For **GitHub Copilot**, the panel shows input/output/total tokens, cache reads/writes (already included in input tokens), AI units, weighted premium requests, and CLI attempts. These are local-calendar-day totals from PaperMotion on this machine, not account-wide usage or remaining quota. AI units are the CLI's reported `totalNanoAiu` divided by one billion. They are **not labeled as credits or USD**; the current CLI does not report an explicit credit amount, so **Credits used** shows **Not reported**, with a link to GitHub billing.

Usage is recorded after each CLI attempt, including corrections and failed validation when metadata is reported. Cumulative per-session checkpoints prevent chat resumes and retries from double-counting usage. No token estimates or raw prompts are stored by the tracker; numeric totals/checkpoints live in the local usage JSON file. Metrics persist across restarts and reset their displayed daily bucket at local midnight. Older CLI versions can fall back to reported billing metadata without token counts. Missing data is shown as **Not reported**, and incomplete coverage as **partial**, rather than zero.

Tracking starts with this update; past usage is not backfilled. The first resumed turn of a pre-existing chat establishes a baseline and may be marked unreported; subsequent turns use the difference from that baseline. CLI crashes or missing metadata can leave totals incomplete. GitHub billing remains authoritative for actual charged credits. Checkpoints are local to the engine and are not returned by the status API. Tests: `npm run test:usage`, `npm run test:copilot`, and `npm run test:viewer-settings`.

### Parallel requests

Open **Settings > Parallel requests** to optionally increase background concurrency for any AI provider:

| Setting | Default | Range | Scope |
| --- | --- | --- | --- |
| Detection batches | 3 | 1-8 | Concurrent concept-detection calls per document, up to 5 pages per call |
| Visualizations | 4 | 1-16 | Concurrent background visualization-generation calls per document |

Values save automatically and survive restarts. The reset icon restores 3 and 4. Existing installations keep these defaults until changed. Saving a higher limit immediately wakes active queues and fills their available slots. Lowering a limit never cancels running requests; the queue waits until it drops below the new limit before scheduling replacements. Detection and visualization can overlap.

Increasing a running queue from **3 to 5** launches up to **two additional requests as soon as the setting is saved**, without waiting for the original three to finish, provided enough work is queued and the queue has not stopped on an account/provider error. Each active document uses its own limit. Completed visualizations and unstarted/stopped queues are not regenerated or restarted. These are concurrent requests, not subagent threads.

These are per-document limits, not an account-wide cap. Chat, knowledge-graph builds, manual revisions, and Step by Step requests use separate paths. Higher values can increase memory use, consumption rate, and provider throttling; they do not raise your provider quota or guarantee faster results. Try detection **4** and visualizations **8** first, then adjust for your provider and machine. No subagent delegation is enabled.

The settings API accepts optional integer fields `detectionConcurrency` and `vizConcurrency` in `POST /api/settings`; omitted fields stay unchanged and out-of-range values return HTTP 400. Regression checks: `npm run test:job-concurrency`, `npm run test:job-wakeup:http`, and `npm run test:viewer-settings`.

| Setting | Purpose |
| --- | --- |
| `GETIT_WEB=1` | Enable direct HTTP API calls for the local web version. |
| `GETIT_DEFAULT_PROVIDER=pi` | Use the Custom API (BYOK) provider by default. |
| `PI_URL` | API base URL, including `/v1` where required. |
| `PI_API_TYPE` | `openai-responses` or `openai-completions` for direct web requests. |
| `PI_API_KEY` | Server-side credential, stored only in your local configuration. |
| `PI_MODEL_FAST` / `PI_MODEL_SMART` | Models for generation tasks and conversations. |
| `GETIT_DATA_DIR` | Local storage directory; defaults here to `./data`. |

Documents, conversations, settings, and generated study material persist in `data/`. Back up that directory to preserve your work. `.env.local`, `data/`, dependencies, and build output are excluded from Git. The PDFs in `public/pdfs/` are upstream sample documents.

AI requests send the relevant document text and conversation to the API provider you configure. Environment-managed keys stay on the server and are hidden in the settings response. This version listens on localhost and is intended for one person on one computer; public hosting requires authentication and access controls.

## Web adaptation

- Direct server-side support for Responses and Chat Completions APIs, with JSON output and persisted multi-turn conversations.
- Configurable default provider and models, plus masked server-managed API settings.
- Local browser launch commands, an API connectivity check, and `/api/health`.
- Windows subprocess handling and Git exclusions for local documents and credentials.

The local version has been checked with a production build, TypeScript, browser upload/PDF rendering, document chat with follow-up context, and flashcard generation. Real API checks require your own credentials.

