# PaperMotion Local Engine 0.1.0

This is a source distribution, not a signed or self-contained desktop installer. It requires an approved installation of Node.js 22 or newer, npm dependencies, and your own supported AI account. The Edge extension does not install these prerequisites.

## Windows setup

1. Extract the entire engine ZIP into a new folder. Keep LICENSE, NOTICE.txt, MODIFICATIONS.md, and the source files together.
2. In that folder, open PowerShell and run `./Start-PaperMotion.ps1 -Check`. If needed, pass `-NodePath 'C:/path/to/node.exe'` to choose an installed Node.js 22+ runtime.
3. Explicitly authorize dependency installation with `./Start-PaperMotion.ps1 -Install`. This runs `npm ci` using your existing registry configuration and dependency lifecycle scripts. It does not change your registry, bypass certificate checks, elevate privileges, or modify PowerShell execution policy. Ask IT if installation or scripts are blocked.
4. Install GitHub Copilot CLI through your approved software source if absent, and run `copilot login` yourself. PaperMotion does not supply a Copilot subscription or extract VS Code credentials. Alternatively configure another supported provider in the app's Settings.
5. Run `./Start-PaperMotion.ps1`. The first run builds the web app, which may download Google Fonts, then starts it on `http://127.0.0.1:3000`. Leave the terminal open. Subsequent runs reuse the production build; use `-Rebuild` after changing source.
6. Install PaperMotion Study Companion from its approved Edge listing, open the sidebar, connect to the local engine, and approve pairing on the localhost page. For development only, an unpacked extension may be loaded if organization policy permits it.

If PowerShell scripts are disallowed but Node is approved, run `node scripts/start-companion.mjs --check`, `npm ci`, and `node scripts/start-companion.mjs` directly. Do not bypass administrative controls.

## Data, updates, and removal

- Windows storage defaults to `%APPDATA%/get-it` unless `GETIT_DATA_DIR` is configured. Without this launcher, example environment settings can select a different location. Keep a backup while the engine is stopped.
- Stop the engine with Ctrl+C before upgrading. Extract a new version to a new folder, install its locked dependencies, and use the same data-directory setting. Do not run concurrent engines against the same writable library.
- `-Port 3002` selects another loopback port; update the extension connection and pair again. Do not use this to run two instances against the same library.
- Copilot CLI manages its own account and session storage separately. Its data is not removed by deleting the engine folder.
- Removing the extension does not remove engine documents. Use Library to delete documents; stop the engine before deleting its data directory yourself. Remove the extracted engine folder to uninstall the source package. Nothing is registered as a service or scheduled task.

## Other platforms

The Node launcher can be invoked as `node scripts/start-companion.mjs`. macOS/Linux end-to-end installation of this release still requires validation before advertising support. Default data paths are documented in the main README and upstream documentation.

## Review limitations

This candidate is not yet approved for store submission. See `release/edge/READINESS.md` for required publisher decisions, public URLs, clean-machine testing, reviewer AI access, privacy/consent work, and policy-review items. A source launcher reduces setup steps but does not replace a signed installer or remove network prerequisites.