import { NextResponse } from "next/server";
import { deleteVisualization, editVisualization, VizEditError } from "@/lib/viz-edit";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function DELETE(req: Request, ctx: { params: Promise<{ docId: string; tagId: string }> }) {
  let body: unknown;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON." }, { status: 400 }); }
  const { docId, tagId } = await ctx.params;
  if (!/^[a-z0-9-]{1,64}$/.test(docId) || !tagId || tagId.length > 200) return NextResponse.json({ error: "Invalid visualization ID." }, { status: 400 });
  try { return NextResponse.json(deleteVisualization(docId, tagId, body), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return NextResponse.json({ error: error instanceof VizEditError ? error.message : "Could not delete the visualization." }, { status: error instanceof VizEditError ? error.status : 500 }); }
}

export async function POST(req: Request, ctx: { params: Promise<{ docId: string; tagId: string }> }) {
  let body: unknown;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON." }, { status: 400 }); }
  const { docId, tagId } = await ctx.params;
  if (!/^[a-z0-9-]{1,64}$/.test(docId) || !tagId || tagId.length > 200) return NextResponse.json({ error: "Invalid visualization ID." }, { status: 400 });
  try {
    const tag = await editVisualization(docId, tagId, body);
    return NextResponse.json({ tag }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not revise the visualization." }, { status: error instanceof VizEditError ? error.status : 502 });
  }
}