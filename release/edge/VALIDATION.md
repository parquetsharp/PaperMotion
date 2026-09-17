# Candidate Validation Record

Recorded 2026-09-15 on Windows with locally installed Node.js 24.20.0, npm dependencies, Microsoft Edge, and Playwright. No package-registry changes, package downloads, external uploads, account login, or publication were performed for these checks. An upstream MIT license text was retrieved from its documented GitHub source for notice inclusion.

## Passed

- Clean extension build after removing `activeTab`.
- License collection for 69 packages present in the extension's esbuild input graph. Included notices for the two remark-math packages whose npm packages omit standalone license files, with source references and their packaged README attribution.
- Twelve focused release, extension-client, and extension-security tests.
- ZIP path validation and per-entry content hash verification for extension and companion-source packages.
- Extracted companion package version/lockfile consistency. Its check command runs without dependencies; normal start refuses missing dependencies without invoking an install.
- PowerShell launcher syntax parsing. No execution-policy override or elevation is used.
- ESLint on release tooling, launcher, and changed tests.
- Installed Edge, temporary-profile workflow: pairing, unauthorized access rejection, HTTPS PDF detection before host permission, PDF import, chat follow-up and reload, flashcards, quizzes, concepts, file-picker fallback, tab isolation, viewer handoff, and pairing revocation.
- Chromium temporary-profile workflow also covered file-access permission off/on.
- Three 1280x800 PNG captures of the real extension UI with synthetic study content; captured in Edge with the extension page opened in a tab. Reviewed for content and absence of private user documents or tokens.
- The ready-submission command refuses incomplete publisher metadata and approvals.

## Not established

- Clean-machine dependency download/build, including availability of organization-feed lockfile URLs and Google Fonts.
- Signed/native companion installer or runtime distribution.
- Edge's native file-access toggle automation; this is a manual Edge release gate.
- Store-signed package ID, installation, update, and reconnect behavior.
- Live production provider access for Microsoft reviewers. Browser tests use a synthetic provider; they are not evidence of live AI service certification.
- Resolved global consent withdrawal/cancellation, secure-transport policy acceptance, independent generated-code security assessment, or legal/licensing approval.
- Publisher identity, support operation, public privacy/companion URLs, Microsoft certification, or actual publication.

Use the generated readiness-report.json and SHA256SUMS.txt to identify the exact candidate. This record does not authorize changing approval flags in release.json.