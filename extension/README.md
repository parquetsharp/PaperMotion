# PaperMotion Study Companion

A Manifest V3 extension for Edge and Chrome that connects to your locally running PaperMotion engine. It provides PDF import, persisted document chat, flashcards with ratings, quizzes with scoring, and a concept list. Full visualizations and the remaining study tools open in the existing web viewer.

## Install

1. Set up the local engine using the [repository instructions](../README.md). Use Node.js 22 or newer, configure your AI provider, and keep `npm run browser:start` or `npm run browser:dev` running.
2. Run `npm run extension:build` from the repository root. The bundled extension is written to `extension/build`.
3. Open `edge://extensions` or `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select `extension/build`.
4. Pin the extension and click its toolbar icon to open the sidebar.
5. Enter the engine address, normally `http://127.0.0.1:3000`, and click **Connect**.
6. On the local pairing page, click **Approve Connection**. Return to your PDF tab and open the sidebar again if necessary.

Chrome 116 or newer is required. Edge uses the same Side Panel API; browser-specific sidebar behavior may differ. The automated browser suite uses Chromium, not a managed Edge installation.

On a managed machine, use only your organization's approved package source. If package downloads are blocked, ask IT to approve the dependencies or supply them through its supported process. Do not switch registries to bypass a block. Once dependencies are installed, `npm run extension:build` bundles local files without downloading npm packages. Unpacked extensions may also be blocked by enterprise policy; ask IT for an approved installation method.

## Study a PDF

1. Open a text-based PDF in a browser tab.
2. Open the sidebar and confirm that you allow importing this document and sending relevant text to the configured AI provider when using study tools.
3. Click **Study This PDF**. Grant access to the PDF's site when prompted.
4. Use **Chat**, **Cards**, **Quiz**, or **Concepts**. Sessions are saved by the local engine. Identical PDF bytes reuse the imported document within the extension's cache.
5. Use **Open interactive viewer** for inline concept tags, animations, the full knowledge graph, and Feynman sessions.

Import alone does not initiate an AI request. Generating study material, chatting, or opening the full viewer can initiate requests. Switching tabs changes the selected document; previously imported documents and study sessions remain in the engine.

The built-in browser PDF viewer is not modified. Its text selection, scroll position, and current page are not synchronized with the sidebar.

## Access and privacy

- The engine must run on HTTP loopback (`127.0.0.1` or `localhost`). This extension does not turn the app into a publicly hosted service.
- Pairing requires approval on the local engine's page. The extension receives a 30-day token; the server stores its hash, and provider API keys remain on the server.
- The token permits a restricted set of study APIs, not settings, provider configuration, or arbitrary local files. Treat pairing as granting access to study data in this local engine, not just the active PDF.
- The `tabs` permission makes tab URLs and titles available so the persistent sidebar can identify the active PDF before site access is granted. The sidebar reads the active tab; this permission does not itself grant access to website content. Edge may describe it as access to browsing history in its permission prompt.
- Remote site access is requested when importing. PDF retrieval can use the browser's authenticated session where the site permits it; no universal authenticated-download support is assumed.
- Reopen the local pairing page at `/extension/pair?extensionId=YOUR_EXTENSION_ID` and choose **Revoke Access** to invalidate the token. The ID is visible on the browser's extension management page.
- Imported PDF files and study sessions persist in the engine's configured data directory. Removing the extension does not delete those documents; manage them through the app's Library.

## Limitations and troubleshooting

- **Engine unavailable:** Start the local engine and verify the address and port. The extension cannot launch Node.js on its own.
- **Access expired or revoked:** Connect again and approve pairing on localhost.
- **Current tab has no address:** After updating, go to `edge://extensions` (or `chrome://extensions`), reload PaperMotion, and approve the added tab-access permission if prompted. Close and reopen the sidebar on the PDF tab. Ask IT if permissions are managed.
- **Local PDF:** In the extension's Details page, enable **Allow access to file URLs**, then reopen the sidebar on the local PDF tab and click **Study This PDF**. No file picker is needed when the browser grants file access.
- **PDF cannot be fetched:** Use the sidebar file picker with a PDF you are authorized to access. `blob:` URLs, authenticated viewers, redirects, and expiring links may need this fallback.
- **Unsupported document:** The existing engine's PDF quality and page-count limits still apply. Scans without selectable text are not supported.
- **Extension update:** Rebuild with `npm run extension:build`, reload it on the browser's extensions page, and reopen the sidebar.
- **Visualizations:** Model-generated JavaScript is not executed inside the extension. Use the full web viewer; the extension retains the standard Manifest V3 script restrictions.

## Verification

Run from the repository root with dependencies and the Playwright Chromium browser already installed:

```sh
npm run test:extension
npm run extension:build
npm run test:extension:browser
```

The browser suite starts an isolated local engine and synthetic AI provider, uses temporary document storage, loads the real unpacked extension, and checks pairing, access restrictions, PDF import, saved chat, card ratings, quiz scoring, concepts, tab isolation, file fallback, viewer handoff, and revocation. It does not use your AI credentials or quota. Responsive screenshots and the test engine log are written to `scripts/extension-out`.