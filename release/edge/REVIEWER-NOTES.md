# Certification Notes Draft

This is a companion extension, not a standalone AI service. Do not submit these notes without filling in the real companion download and review-access instructions. Do not include personal credentials in the repository or release archives.

## Prerequisites

- Companion version: 0.1.0 source package at [APPROVED DOWNLOAD URL], checksum [FROM SHA256SUMS.txt].
- Node.js 22+ and npm dependencies are required for this source distribution. Follow START-HERE.md; a signed standalone installer is not supplied.
- A working, permitted AI provider is required. [PUBLISHER: supply authorized review access privately in Partner Center, or explain why account credentials cannot be provided and supply a reasonable test procedure.] Do not ask reviewers to use the publisher's personal Copilot account.
- The engine must remain running on the review machine, bound to loopback. Default: http://127.0.0.1:3000.

## Test sequence

1. Install the submitted extension package in Microsoft Edge and pin its toolbar action. Confirm the dependency is visible in the listing/setup instructions.
2. Start the local engine. Open the extension sidebar, enter the engine URL, click Connect, and approve connection on the localhost page. The store-signed extension ID is used at runtime; no developer ID is hardcoded.
3. Return to a public text-based PDF tab. Check the consent box, choose Study This PDF, and approve that site's permission. Confirm import without manually selecting the file.
4. Ask a question and follow up. Reload and confirm the saved chat reappears. Generate flashcards and rate them; generate a quiz and submit answers; generate concepts.
5. Open the interactive viewer. Generate an animation or simulator. Change simulator inputs and run locally, then apply a render correction through its feedback panel. AI-generated code runs in that separate web app, not inside the extension page. Rendering correctness is not guaranteed by schema validation.
6. Test local-file permission disabled/enabled and the file-picker fallback. Check error states for scans, oversized files, unreachable engine, missing provider login, and denied website access.
7. On the pairing page, revoke access. Subsequent extension gateway requests must fail. Review the consent/cancellation limitations documented in SECURITY-REVIEW.md; these must be resolved before submission approval.
8. Test a new store package version against existing saved data and pairing. Never silently delete the Library when upgrading.

## Architecture

- Manifest V3 sidebar with packaged scripts, CSS, icons, and font assets.
- Extension imports PDF bytes to a scoped, bearer-token-protected localhost gateway.
- Local Next.js engine performs extraction, persistence, AI requests, and generation. It is intentionally single-user and not a public hosting service.
- Full generated visualizations run in a normal localhost browser tab. The extension CSP uses packaged scripts only and disallows frames. Generated simulator code uses an opaque sandbox frame and a bounded worker in the companion web app.
- No extension self-update downloader: store package updates must be delivered through Edge Add-ons. Updating the separate companion source package is a distinct user action.

## Evidence boundaries

The automated extension tests use an isolated library and deterministic AI fixture. They verify UI, APIs, permission handling, persistence, and error states without spending AI quota. They are not live-service certification. Optional store screenshots show real extension UI with synthetic content, captured from the extension page opened in a tab; do not imply these are screenshots of completed live-provider certification.

Reviewers must have a functional production service path; do not hide missing AI access behind a fixture or demo mode.