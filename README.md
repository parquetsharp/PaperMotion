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

## GitHub Copilot

GitHub Copilot is available as a model engine for the browser app and its extension. No Codex account, custom API endpoint, or OpenAI API key is required for this option.

1. Install the official [GitHub Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/install-copilot-cli) using your organization's approved software source, if it is not already installed.
2. Run `copilot login` in your terminal and complete GitHub's sign-in flow. Your account and organization must allow Copilot CLI access; VS Code sign-in alone does not guarantee this.
3. Start the local engine, open **Settings**, and select **GitHub Copilot** under **Model Engine**. Leave the generation and conversation models at `auto`, or enter model IDs supported by your Copilot account.
4. Retry your study action. Start a new chat when switching from a different provider; existing documents and study materials remain saved.

The API-key setup and `check:api` command above apply to BYOK, not Copilot. The example's third-party API URL is not GitHub Copilot's authentication endpoint.

PaperMotion invokes the real CLI directly, skipping VS Code installation bootstrappers and disabling automatic CLI updates. If the engine cannot find it, set `COPILOT_CLI_PATH` to the real executable or the installed npm package's JavaScript entry point and restart the engine. `GETIT_DEFAULT_PROVIDER=copilot`, `COPILOT_MODEL_FAST`, and `COPILOT_MODEL_SMART` provide optional defaults; saved Settings take precedence.

Study requests send relevant document text to GitHub Copilot and consume your plan's allowance. Organization restrictions remain in effect. Model tools are disabled, built-in MCP servers are disabled, and prompts run outside your project working directory without project instructions. This is not an OS-level sandbox. Copilot CLI manages its own credentials and native session storage; PaperMotion never reads VS Code tokens. The Account panel verifies connectivity on successful study requests rather than assuming an installed CLI is signed in. Token/billing totals are not currently exposed for this provider.

Copilot responses are validated against each study tool's schema. A schema mismatch triggers at most one correction turn in the same session, with the failed fields and limits supplied to the model. This extra turn consumes Copilot allowance. Invalid corrected output is rejected with field-level diagnostics; authentication, policy, and network errors are not retried by this correction step.

Run `npm run test:copilot` for adapter checks and `npm run test:copilot:browser` for the extension workflow using a local CLI fixture, including correction of an oversized graph overview. The fixture tests do not authenticate your account or consume Copilot quota. Live use still requires `copilot login`.

## Configuration and saved work

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

