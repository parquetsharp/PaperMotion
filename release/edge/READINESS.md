# Edge Add-ons Release Readiness

Status: **candidate preparation only; do not submit yet**. Publication and certification are not completed by packaging a ZIP. Missing metadata and approvals in `release.json` fail the `--require-ready` gate. Never mark a gate complete solely to make the command pass.

## Prepared locally

- A clean Manifest V3 bundle with the redundant `activeTab` permission removed; per-site HTTP/HTTPS access remains optional.
- Automated PDF detection/import, pairing, persistence, and study tests; this is not a substitute for a store-signed build in Edge.
- Bundled third-party license inventory and verbatim license texts; upstream license, attribution, and modification inventory.
- Versioned ZIP packaging, path checks, per-file integrity verification, source fingerprints, and SHA-256 archive checksums.
- Draft store listing, permission justifications, privacy policy, review notes, release notes, and security assessment.
- A companion source ZIP with an explicit-install Windows PowerShell/Node launcher. It is not signed and does not contain Node.js, installed npm packages, or provider CLI binaries.

## Required owner decisions

1. Enter the actual publisher name, support contact, website, public HTTPS privacy-policy URL, and companion download URL in `release.json`. No account identity is inferred from repository authorship.
2. Register/verify the Edge developer account in Microsoft Partner Center. Complete the account agreement yourself; do not put login credentials in this repository or chat.
3. Approve and publicly host the privacy policy. Confirm the data controller, jurisdictions, retention practices, third-party provider relationships, and support procedures with the responsible publisher.
4. Choose Hidden or Public visibility. Hidden is the current recommendation and still requires certification. The store must not be used to distribute an unstable internal prototype.
5. Publish the versioned engine release only after its clean-machine setup path passes. Hosting/uploading a repository release is a separate external action and has not been performed.

## Required release gates

- **Consent and cancellation:** the current checkbox gates import but is not a complete global opt-out for all subsequent study calls. Disconnecting the extension does not cancel already-running engine jobs. Implement and validate a complete opt-out/cancellation design, or obtain a policy-compliant design decision before submission. Do not claim this is resolved in the privacy form.
- **Transport:** the current paired engine uses HTTP loopback and public HTTP PDF sources are permitted. Document the local threat model and obtain policy/security review of sensitive-data handling. Decide whether native messaging, local TLS, or restricting source transport is required. No broad TLS migration was attempted during release packaging.
- **Generated code:** the MV3 bundle runs packaged scripts and handles study data; generated animation and simulation code runs in the separate localhost web viewer. Disclose the full architecture. This separation is not evidence of automatic store-policy approval.
- **Reviewer access:** provide a permitted test account/access method or explain why credentials cannot be supplied, plus an executable companion setup path. Synthetic fixtures demonstrate UI behavior only; they must not impersonate working production AI for reviewers.
- **Store identity:** after Microsoft assigns the listing/extension ID, test installed-package pairing, local-file permission, optional-site prompts, restart/reconnect, and updates in Edge. Existing unpacked-install pairings do not transfer automatically to a new extension ID.
- **Edge local-file setting:** the automated Edge path covers core study/import, file-picker fallback and revocation, but does not manipulate Edge's file-access settings UI. Manually verify **Allow access to file URLs** off/on in Edge; the Chromium suite covers its corresponding control automatically.
- **Clean machine:** test Windows installation from the extracted source ZIP, missing Node/dependencies, blocked npm and font requests, missing CLI/auth, occupied port, upgrade, data preservation, and removal. A signed companion installer remains recommended for broad public release.
- **Package source portability:** this worktree's lockfile includes organization-feed download URLs alongside public npm URLs. Confirm they are accessible to the intended reviewer/customer environment, or regenerate the lockfile on an authorized release build system using the approved distribution configuration. The candidate builder reports the hosts; it does not rewrite registries or bypass the current machine's npm restrictions.
- **Licensing/branding:** approve upstream attribution, modification notices, bundled library notices, sample PDF redistribution, and use of product names. No claim of Microsoft or GitHub endorsement is allowed.
- **Final approval:** review the exact candidate hashes, complete Partner Center privacy and permission fields truthfully, and explicitly approve submission.

## Packaging commands

With installed dependencies, run `npm run release:edge`. It rebuilds the extension and writes candidate artifacts to `dist-release/edge/0.1.0`. It does not access Partner Center, publish a URL, upload packages, or sign binaries. Run `npm run release:edge:ready` only after completing all gates; unresolved gates cause a nonzero exit.

Use `npm run test:release` for archive and readiness tests, `npm run release:edge:verify` to check the generated ZIPs and extracted launcher, `npm run test:extension:browser` for synthetic browser checks, and `node scripts/test-extension-browser.mjs --edge --store-assets` to capture optional 1280x800 screenshots from the real packaged extension UI using synthetic data in an installed Edge browser. Screenshots are taken with the extension page opened in a browser tab for capture; the store description must still accurately identify it as sidebar UI.

Official references checked 2026-09-15:
- https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension
- https://learn.microsoft.com/en-us/legal/microsoft-edge/extensions/developer-policies

This checklist records engineering preparation, not a legal opinion or certification guarantee.