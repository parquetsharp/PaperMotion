# Release Security Assessment

Engineering assessment of the current code on 2026-09-15, not an independent penetration test or store-policy approval.

## Submission blockers

| Priority | Finding | Required disposition |
| --- | --- | --- |
| High | Consent checkbox gates import, but existing study tools can issue AI calls without a persistent global consent gate. Chat cleanup can evaluate progress. Disconnect/revocation does not cancel engine work already accepted. | Implement and test consent withdrawal across study actions, background evaluation and active requests. Update privacy disclosures to match. |
| High | Normal web-app APIs are unauthenticated for same-origin/local clients; only the extension gateway is paired. Requests with absent Origin headers are not general authentication. | Keep loopback-only binding and single-user scope. Assess local-process threats, malicious generated renderer behavior, and whether an authenticated companion transport/native messaging is required. Never publicly host as-is. |
| High | 2D/3D/plot renderers execute model-generated code in the companion viewer; constructor/global shadowing is not a complete security boundary. Simulators use stronger iframe/worker isolation but lack a hard memory quota. | Independent review of generated-code execution and store remote-code interpretation. Disclose the separate viewer. Do not claim that sandboxing proves safety. |
| Medium | PDF bytes and pairing credentials use HTTP loopback; optional public HTTP sources are allowed. | Review against Edge secure-transmission policy. Consider native messaging/local TLS or restricting source protocols; do not silently broaden endpoint access. |
| Medium | Pairing token has access to permitted study routes for the local library, not only the active document. It is stored in extension local storage. | Explain scope and retention; assess per-document authorization if the product promises narrower access. Test expiry, revocation, and signed-package IDs. |
| Medium | Current distribution requires Node/npm, a font-fetching build, provider CLI/auth setup, and is not signed/self-contained. | Test clean-machine setup and provide reviewer access. Do not claim one-click installation or offline AI functionality. |

## Existing protections checked

- Extension requests only sidebar/storage/tab metadata and necessary host access. `activeTab` was removed and import behavior was retested.
- Remote engine addresses and malformed loopback URLs are rejected by the client. Server gateway authenticates extension ID/token and validates allowed methods/routes.
- Pairing requires a same-origin localhost approval request, not an arbitrary website message. Server stores a hash of the token; extension listener verifies pending origin and page identity.
- PDF import validates a size bound and PDF signature before engine ingestion. Image-only/unsupported PDFs are rejected by the engine.
- Provider credentials are not packaged in the extension or returned as raw settings values.
- Extension uses packaged script sources and has `frame-src 'none'`; simulator/visualization execution remains in the companion app.
- Simulator browser tests cover cancellation, time limits, output validation, blocked network imports, storage isolation, and cleanup. These are not a substitute for full adversarial review.

## Packaging protections

Release ZIPs use explicit source lists and exclude local environments, data directories, dependency directories, credentials, logs, screenshots of user work, and build caches. Extension files are taken only from a clean build. Each entry is verified after ZIP creation; SHA-256 checksums and provenance identify the candidate. License texts are collected from the actual bundle input packages.

The ready gate checks required fields/confirmations, not their truth. A human owner must substantiate them. There is no automatic submission, remote-code exemption, account creation, signature, or legal certification.