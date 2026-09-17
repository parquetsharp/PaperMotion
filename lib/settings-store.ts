/**
 * Persistent app settings.
 *
 * Source-of-truth for runtime knobs the user can toggle from the
 * Settings popover. Reads:
 *   1. Saved JSON at <DATA_DIR>/settings.json (if it exists — i.e. the
 *      user has touched the controls at some point).
 *   2. Otherwise, the build-time defaults from `.env` (NEXT_PUBLIC_*).
 *   3. Otherwise, hardcoded fallbacks.
 *
 * Saved settings survive app restarts, OS reboots, and (in the packaged
 * Electron app) the dynamic localhost port that changes between launches
 * — that's why we don't lean on localStorage here.
 */

import fs from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { DATA_DIR } from "./paths";
import { AUTO_GENERATE_VIZ, MAX_VIZ_GEN_RETRIES } from "./config";
import { normalizeConcurrency } from "./job-concurrency";

export type AppSettings = {
  autoGenerate: boolean;
  publicSourceRetrieval?: boolean;
  maxRetries: number;
  detectionConcurrency?: number;
  vizConcurrency?: number;
  provider: "codex" | "gemini" | "claude" | "pi" | "copilot";
  copilotModelFast?: string;
  copilotModelSmart?: string;
  codexModelFast?: string;
  codexModelSmart?: string;
  codexEffortFast?: string;
  codexEffortSmart?: string;
  geminiApiKey?: string;
  geminiModelFast?: string;
  geminiModelSmart?: string;
  claudeModelFast?: string;
  claudeModelSmart?: string;
  /** Separate thinking effort per tier (like Codex). Fast is kept snappy so
   *  one-shot tools (viz/detect/flashcards) don't spend minutes "thinking";
   *  smart can go high for quality. `claudeEffort` is the legacy single value,
   *  read only as a migration fallback. */
  claudeEffortFast?: string;
  claudeEffortSmart?: string;
  claudeEffort?: string;
  piUrl?: string;
  piApiKey?: string;
  piModelFast?: string;
  piModelSmart?: string;
  piProvider?: "ollama" | "gemini" | "openai" | "anthropic" | "custom";
  piApiType?: "openai-completions" | "openai-responses" | "google-generative-ai" | "anthropic-messages";
  /** Appearance: explicit "light"/"dark", or "system" to follow the OS.
   *  Defaults to "light" when unset. */
  theme?: "light" | "dark" | "system";
};

const VERSION = 2 as const; // Bumped to 2 for new settings structure
const SETTINGS_PATH = path.join(DATA_DIR, "settings.json");

function defaultsFromEnv(): AppSettings {
  const piUrl = process.env.PI_URL || "http://localhost:11434/v1";
  const piApiKey = process.env.PI_API_KEY || "";
  
  // Resolve default provider from the URL
  let piProvider: "ollama" | "gemini" | "openai" | "anthropic" | "custom" = "ollama";
  if (piUrl.includes("generativelanguage.googleapis.com")) piProvider = "gemini";
  else if (piUrl.includes("api.openai.com")) piProvider = "openai";
  else if (piUrl.includes("api.anthropic.com")) piProvider = "anthropic";
  else if (!piUrl.includes("localhost") && !piUrl.includes("127.0.0.1") && piUrl) piProvider = "custom";
  
  let piApiType: NonNullable<AppSettings["piApiType"]> = "openai-completions";
  if (piProvider === "gemini") piApiType = "google-generative-ai";
  else if (piProvider === "anthropic") piApiType = "anthropic-messages";
  if (process.env.PI_API_TYPE === "openai-responses") piApiType = "openai-responses";

  return {
    autoGenerate: AUTO_GENERATE_VIZ,
    publicSourceRetrieval: false,
    maxRetries: MAX_VIZ_GEN_RETRIES,
    detectionConcurrency: normalizeConcurrency(undefined, "detectionConcurrency"),
    vizConcurrency: normalizeConcurrency(undefined, "vizConcurrency"),
    theme: "light",
    provider: ["codex", "gemini", "claude", "pi", "copilot"].includes(process.env.GETIT_DEFAULT_PROVIDER ?? "")
      ? process.env.GETIT_DEFAULT_PROVIDER as AppSettings["provider"]
      : "codex",
    copilotModelFast: process.env.COPILOT_MODEL_FAST || "auto",
    copilotModelSmart: process.env.COPILOT_MODEL_SMART || "auto",
    codexModelFast: "gpt-5.5",
    codexModelSmart: "gpt-5.5",
    codexEffortFast: "low",
    codexEffortSmart: "high",
    geminiModelFast: "gemini-flash-latest",
    geminiModelSmart: "gemini-pro-latest",
    claudeModelFast: "sonnet",
    claudeModelSmart: "opus",
    claudeEffortFast: "medium",
    claudeEffortSmart: "high",
    geminiApiKey: process.env.GEMINI_API_KEY || "",
    piUrl,
    piApiKey,
    piModelFast: process.env.PI_MODEL_FAST || "llama3.2",
    piModelSmart: process.env.PI_MODEL_SMART || "llama3.2",
    piProvider,
    piApiType,
  };
}

export function loadSettings(): AppSettings {
  try {
    const raw = fs.readFileSync(SETTINGS_PATH, "utf-8");
    const parsed = JSON.parse(raw) as { v: number } & Partial<AppSettings>;
    // Accept version 1 or 2
    if (parsed && (parsed.v === 1 || parsed.v === VERSION)) {
      const env = defaultsFromEnv();

      const loadedProvider = ["codex", "gemini", "claude", "pi", "copilot"].includes(parsed.provider as string)
        ? (parsed.provider as AppSettings["provider"])
        : env.provider;
        
      const piUrl = typeof parsed.piUrl === "string" ? parsed.piUrl : env.piUrl;
      const piApiKey = process.env.PI_API_KEY || (typeof parsed.piApiKey === "string" ? parsed.piApiKey : env.piApiKey);
      
      let piProvider = parsed.piProvider;
      if (!piProvider && piUrl) {
        if (piUrl.includes("generativelanguage.googleapis.com")) piProvider = "gemini";
        else if (piUrl.includes("api.openai.com")) piProvider = "openai";
        else if (piUrl.includes("api.anthropic.com")) piProvider = "anthropic";
        else if (!piUrl.includes("localhost") && !piUrl.includes("127.0.0.1")) piProvider = "custom";
        else piProvider = "ollama";
      }
      
      let piApiType = parsed.piApiType;
      if (!piApiType) {
        if (piProvider === "gemini") piApiType = "google-generative-ai";
        else if (piProvider === "anthropic") piApiType = "anthropic-messages";
        else piApiType = env.piApiType;
      }

      const s: AppSettings = {
        publicSourceRetrieval: parsed.publicSourceRetrieval === true,
        autoGenerate:
          typeof parsed.autoGenerate === "boolean"
            ? parsed.autoGenerate
            : env.autoGenerate,
        maxRetries:
          typeof parsed.maxRetries === "number" && parsed.maxRetries >= 0
            ? Math.min(10, Math.floor(parsed.maxRetries))
            : env.maxRetries,
        detectionConcurrency: normalizeConcurrency(parsed.detectionConcurrency, "detectionConcurrency"),
        vizConcurrency: normalizeConcurrency(parsed.vizConcurrency, "vizConcurrency"),
        provider: loadedProvider,
        copilotModelFast: typeof parsed.copilotModelFast === "string" ? parsed.copilotModelFast : env.copilotModelFast,
        copilotModelSmart: typeof parsed.copilotModelSmart === "string" ? parsed.copilotModelSmart : env.copilotModelSmart,
        codexModelFast: typeof parsed.codexModelFast === "string" ? parsed.codexModelFast : env.codexModelFast,
        codexModelSmart: typeof parsed.codexModelSmart === "string" ? parsed.codexModelSmart : env.codexModelSmart,
        codexEffortFast: typeof parsed.codexEffortFast === "string" ? parsed.codexEffortFast : env.codexEffortFast,
        codexEffortSmart: typeof parsed.codexEffortSmart === "string" ? parsed.codexEffortSmart : env.codexEffortSmart,
        geminiApiKey: process.env.GEMINI_API_KEY || (typeof parsed.geminiApiKey === "string" ? parsed.geminiApiKey : env.geminiApiKey),
        geminiModelFast: typeof parsed.geminiModelFast === "string" ? parsed.geminiModelFast : env.geminiModelFast,
        geminiModelSmart: typeof parsed.geminiModelSmart === "string" ? parsed.geminiModelSmart : env.geminiModelSmart,
        claudeModelFast: typeof parsed.claudeModelFast === "string" ? parsed.claudeModelFast : env.claudeModelFast,
        claudeModelSmart: typeof parsed.claudeModelSmart === "string" ? parsed.claudeModelSmart : env.claudeModelSmart,
        // Fast stays snappy by default (ignore a legacy high value so viz no
        // longer hangs); a legacy single `claudeEffort` migrates to smart.
        claudeEffortFast:
          typeof parsed.claudeEffortFast === "string" ? parsed.claudeEffortFast : env.claudeEffortFast,
        claudeEffortSmart:
          typeof parsed.claudeEffortSmart === "string"
            ? parsed.claudeEffortSmart
            : typeof parsed.claudeEffort === "string"
              ? parsed.claudeEffort
              : env.claudeEffortSmart,
        piUrl,
        piApiKey,
        piModelFast:
          typeof parsed.piModelFast === "string"
            ? parsed.piModelFast
            : env.piModelFast,
        piModelSmart:
          typeof parsed.piModelSmart === "string"
            ? parsed.piModelSmart
            : env.piModelSmart,
        piProvider: piProvider as AppSettings["piProvider"],
        piApiType: piApiType as AppSettings["piApiType"],
      };
      s.theme =
        parsed.theme === "light" ||
        parsed.theme === "dark" ||
        parsed.theme === "system"
          ? parsed.theme
          : "light"; // default to light when unset/legacy
      return s;
    }
  } catch {
    /* file missing or malformed — fall through to env defaults */
  }
  return defaultsFromEnv();
}

export function saveSettings(s: AppSettings): void {
  const file: Record<string, unknown> = {
    v: VERSION,
    savedAt: Date.now(),
    autoGenerate: !!s.autoGenerate,
    publicSourceRetrieval: s.publicSourceRetrieval === true,
    maxRetries: Math.min(10, Math.max(0, Math.floor(s.maxRetries))),
    detectionConcurrency: normalizeConcurrency(s.detectionConcurrency, "detectionConcurrency"),
    vizConcurrency: normalizeConcurrency(s.vizConcurrency, "vizConcurrency"),
    provider: s.provider,
    copilotModelFast: s.copilotModelFast,
    copilotModelSmart: s.copilotModelSmart,
    codexModelFast: s.codexModelFast,
    codexModelSmart: s.codexModelSmart,
    codexEffortFast: s.codexEffortFast,
    codexEffortSmart: s.codexEffortSmart,
    geminiApiKey: process.env.GEMINI_API_KEY ? undefined : s.geminiApiKey,
    geminiModelFast: s.geminiModelFast,
    geminiModelSmart: s.geminiModelSmart,
    claudeModelFast: s.claudeModelFast,
    claudeModelSmart: s.claudeModelSmart,
    claudeEffortFast: s.claudeEffortFast,
    claudeEffortSmart: s.claudeEffortSmart,
    piUrl: s.piUrl,
    piApiKey: process.env.PI_API_KEY ? undefined : s.piApiKey,
    piModelFast: s.piModelFast,
    piModelSmart: s.piModelSmart,
    piProvider: s.piProvider,
    piApiType: s.piApiType,
  };
  if (s.theme === "light" || s.theme === "dark" || s.theme === "system") {
    file.theme = s.theme;
  }
  const tmp = `${SETTINGS_PATH}.${randomUUID()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(file, null, 2));
  fs.renameSync(tmp, SETTINGS_PATH);
}
