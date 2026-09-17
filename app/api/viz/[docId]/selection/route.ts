import { NextResponse } from "next/server";
import { createManualVisualization, ManualVizError } from "@/lib/manual-viz";
import { ensureVizQueue } from "@/lib/jobs";

export const runtime = "nodejs";

export async function POST(req: Request, ctx: { params: Promise<{ docId: string }> }) {
  const { docId } = await ctx.params;
  if (!/^[a-z0-9-]{1,64}$/.test(docId)) return NextResponse.json({ error: "Invalid document ID." }, { status: 400 });
  let body: unknown;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON." }, { status: 400 }); }
  try {
    const tag = createManualVisualization(docId, body);
    if (tag.generating) ensureVizQueue(docId);
    return NextResponse.json({ tag }, { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof ManualVizError ? error.message : "Could not save the selected passage." }, { status: error instanceof ManualVizError ? error.status : 500 });
  }
}