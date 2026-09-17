import { NextResponse } from "next/server";
import { CopilotModelsError, listCopilotModels } from "@/lib/providers/copilot-models";

export const runtime = "nodejs";
export const maxDuration = 45;

export async function GET() {
  const headers = { "Cache-Control": "no-store" };
  try {
    const models = await listCopilotModels();
    return NextResponse.json({ provider: "copilot", models, fetchedAt: Date.now() }, { headers });
  } catch (error) {
    const safe = error instanceof CopilotModelsError ? error : new CopilotModelsError("unavailable");
    const status = safe.code === "unauthenticated" ? 401 : safe.code === "timeout" ? 504 : 503;
    return NextResponse.json({ provider: "copilot", code: safe.code, error: safe.message }, { status, headers });
  }
}