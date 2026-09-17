/**
 * GET  /api/settings    → current persisted AppSettings (or env defaults)
 * POST /api/settings    → merge body into persisted settings
 *
 * The viewer reads this once at mount and writes on every toggle. Settings
 * survive app restarts because they live at <DATA_DIR>/settings.json.
 */

import { NextResponse } from "next/server";
import { loadSettings, saveSettings, type AppSettings } from "@/lib/settings-store";
import { CONCURRENCY_LIMITS, normalizeConcurrency, type ConcurrencyField } from "@/lib/job-concurrency";
import { wakeJobQueues } from "@/lib/job-wakeups";

export const runtime = "nodejs";

function publicSettings(settings: AppSettings) {
  const { piApiKey, geminiApiKey, ...safe } = settings;
  return {
    ...safe,
    hasPiApiKey: !!piApiKey,
    hasGeminiApiKey: !!geminiApiKey,
    piApiKeyManaged: !!process.env.PI_API_KEY,
    geminiApiKeyManaged: !!process.env.GEMINI_API_KEY,
  };
}

export async function GET() {
  return NextResponse.json(publicSettings(loadSettings()), { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const b = (body && typeof body === "object" ? body : {}) as Partial<AppSettings>;
  for (const field of Object.keys(CONCURRENCY_LIMITS) as ConcurrencyField[]) {
    if (!(field in b)) continue;
    const value = b[field];
    const maximum = CONCURRENCY_LIMITS[field].max;
    if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > maximum) {
      return NextResponse.json({ error: `${field} must be an integer between 1 and ${maximum}.` }, { status: 400 });
    }
  }
  const current = loadSettings();
  const next: AppSettings = {
    detectionConcurrency: b.detectionConcurrency ?? current.detectionConcurrency,
    vizConcurrency: b.vizConcurrency ?? current.vizConcurrency,
    provider:
      ["codex", "gemini", "claude", "pi", "copilot"].includes(b.provider as string)
        ? b.provider!
        : current.provider,
    copilotModelFast: typeof b.copilotModelFast === "string" && b.copilotModelFast.trim() ? b.copilotModelFast.trim() : current.copilotModelFast,
    copilotModelSmart: typeof b.copilotModelSmart === "string" && b.copilotModelSmart.trim() ? b.copilotModelSmart.trim() : current.copilotModelSmart,
    codexModelFast: typeof b.codexModelFast === "string" ? b.codexModelFast : current.codexModelFast,
    codexModelSmart: typeof b.codexModelSmart === "string" ? b.codexModelSmart : current.codexModelSmart,
    codexEffortFast: typeof b.codexEffortFast === "string" ? b.codexEffortFast : current.codexEffortFast,
    codexEffortSmart: typeof b.codexEffortSmart === "string" ? b.codexEffortSmart : current.codexEffortSmart,
    geminiApiKey: process.env.GEMINI_API_KEY || (typeof b.geminiApiKey === "string" && b.geminiApiKey.trim() ? b.geminiApiKey.trim() : current.geminiApiKey),
    geminiModelFast: typeof b.geminiModelFast === "string" ? b.geminiModelFast : current.geminiModelFast,
    geminiModelSmart: typeof b.geminiModelSmart === "string" ? b.geminiModelSmart : current.geminiModelSmart,
    claudeModelFast: typeof b.claudeModelFast === "string" ? b.claudeModelFast : current.claudeModelFast,
    claudeModelSmart: typeof b.claudeModelSmart === "string" ? b.claudeModelSmart : current.claudeModelSmart,
    claudeEffortFast: typeof b.claudeEffortFast === "string" ? b.claudeEffortFast : current.claudeEffortFast,
    claudeEffortSmart: typeof b.claudeEffortSmart === "string" ? b.claudeEffortSmart : current.claudeEffortSmart,
    autoGenerate:
      typeof b.autoGenerate === "boolean" ? b.autoGenerate : current.autoGenerate,
    maxRetries:
      typeof b.maxRetries === "number" && b.maxRetries >= 0
        ? b.maxRetries
        : current.maxRetries,
    piUrl: typeof b.piUrl === "string" ? b.piUrl : current.piUrl,
    piApiKey: process.env.PI_API_KEY || (typeof b.piApiKey === "string" && b.piApiKey.trim() ? b.piApiKey.trim() : current.piApiKey),
    piModelFast:
      typeof b.piModelFast === "string" ? b.piModelFast : current.piModelFast,
    piModelSmart:
      typeof b.piModelSmart === "string" ? b.piModelSmart : current.piModelSmart,
    piProvider: typeof b.piProvider === "string" ? b.piProvider : current.piProvider,
    piApiType: typeof b.piApiType === "string" ? b.piApiType : current.piApiType,
  };
  next.theme =
    b.theme === "light" || b.theme === "dark" || b.theme === "system"
      ? b.theme
      : current.theme;
  saveSettings(next);
  for (const field of Object.keys(CONCURRENCY_LIMITS) as ConcurrencyField[]) {
    if (normalizeConcurrency(next[field], field) > normalizeConcurrency(current[field], field)) wakeJobQueues(field);
  }
  return NextResponse.json(publicSettings(next), { headers: { "Cache-Control": "no-store" } });
}
