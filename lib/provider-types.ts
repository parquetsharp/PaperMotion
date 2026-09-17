/**
 * Shared types for the multi-provider AI backend system.
 *
 * Every provider (Codex SDK, Gemini CLI, Claude Code) implements the
 * `AIProvider` interface. The router in codex.ts delegates to whichever
 * provider the user selected in Settings.
 */

/** The three supported AI backends. */
export type ProviderName = "codex" | "gemini" | "claude" | "pi" | "copilot";

/** Human-readable display names used in the UI. */
export const PROVIDER_LABELS: Record<ProviderName, string> = {
  codex: "Codex CLI",
  gemini: "Gemini CLI",
  claude: "Claude Code",
  pi: "Custom API (BYOK)",
  copilot: "GitHub Copilot",
};

/** CLI binary names used for PATH detection. */
export const PROVIDER_BINARIES: Record<ProviderName, string> = {
  codex: "codex",
  gemini: "gemini",
  claude: "claude",
  pi: "pi",
  copilot: "copilot",
};

/** npm package names for auto-install. */
export const PROVIDER_PACKAGES: Record<ProviderName, string> = {
  codex: "@openai/codex",
  gemini: "@google/gemini-cli",
  claude: "@anthropic-ai/claude-code",
  pi: "@earendil-works/pi-coding-agent",
  copilot: "@github/copilot",
};

/**
 * Primary auth model per provider, which drives the account UI:
 *   "account" → subscription/OAuth login; show plan + limits (Codex) or plan
 *               (Claude). May fall back to API-key mode at runtime.
 *   "apiKey"  → a key/endpoint the user pastes; show cumulative token usage.
 * The *effective* mode is computed at runtime from real auth data; this is the
 * default each provider is set up under.
 */
export const PROVIDER_AUTH_KIND: Record<ProviderName, "account" | "apiKey"> = {
  codex: "account",
  claude: "account",
  gemini: "apiKey",
  pi: "apiKey",
  copilot: "account",
};

/** Documentation URLs shown when auto-install fails. */
export const PROVIDER_DOCS: Record<ProviderName, string> = {
  codex: "https://github.com/openai/codex#login",
  gemini: "https://github.com/google-gemini/gemini-cli",
  claude: "https://docs.anthropic.com/en/docs/claude-code",
  pi: "https://github.com/beltromatti/get-it",
  copilot: "https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/install-copilot-cli",
};

export type RunOptions = {
  /** Defaults to "low" — fastest answer-only model setting. */
  reasoning?: "low" | "medium" | "high";
  /** Allow live web search for this call. */
  webSearch?: boolean;
  /** AbortSignal forwarded to the underlying process. */
  signal?: AbortSignal;
};

export type RunJsonResult<T> = {
  data: T;
  usage: unknown;
};

export type RunJsonInThreadResult<T> = RunJsonResult<T> & {
  threadId: string | null;
};

/**
 * Interface that every AI provider must implement.
 *
 * The router in codex.ts delegates to the active provider — all downstream
 * consumers (agents, API routes) call the same `runJson` / `runJsonInThread`
 * signatures and never know which backend is running.
 */
export interface AIProvider {
  readonly name: ProviderName;

  runJson<T>(
    prompt: string,
    outputSchema: object,
    opts?: RunOptions,
  ): Promise<RunJsonResult<T>>;

  runJsonInThread<T>(args: {
    outputSchema: object;
    opts?: RunOptions;
    resume?: { threadId: string; input: string };
    start?: { input: string };
  }): Promise<RunJsonInThreadResult<T>>;
}
