import { z } from "zod";
import { authenticateExtension } from "@/lib/extension-pairing";
import { extensionRouteAllowed, MAX_EXTENSION_PDF_BYTES } from "@/lib/extension-security";
import { toCodexErrorPayload } from "@/lib/codex";
import * as chat from "@/app/api/chat/[docId]/route";
import * as flashcards from "@/app/api/flashcards/[docId]/route";
import * as quizzes from "@/app/api/quizzes/[docId]/route";
import { POST as upload } from "@/app/api/upload/route";
import { GET as document } from "@/app/api/doc/[docId]/route";
import { GET as tags } from "@/app/api/tags/[docId]/route";
import { GET as graph } from "@/app/api/kg/[docId]/state/route";
import { POST as buildGraph } from "@/app/api/kg/[docId]/build/route";
import { POST as evaluateGraph } from "@/app/api/kg/[docId]/evaluate/route";

export const runtime = "nodejs";
export const maxDuration = 300;

const id = z.string().regex(/^[a-z0-9-]{1,64}$/);
const generate = z.object({ action: z.literal("generate"), topic: z.string().max(500).optional() });
const end = z.object({ action: z.literal("end"), sessionId: id });
const bodies = {
  chat: z.discriminatedUnion("action", [
    z.object({ action: z.literal("create"), title: z.string().max(80).optional() }),
    z.object({ action: z.literal("send"), chatId: id, message: z.string().trim().min(1).max(16000) }),
  ]),
  flashcards: z.discriminatedUnion("action", [generate, end,
    z.object({ action: z.literal("rate"), sessionId: id, cardIndex: z.number().int().min(0).max(100), rating: z.number().int().min(1).max(4), userAnswer: z.string().max(1000).optional() }),
  ]),
  quizzes: z.discriminatedUnion("action", [generate, end,
    z.object({ action: z.literal("answer"), sessionId: id, questionIndex: z.number().int().min(0).max(100), chosenIndex: z.number().int().min(0).max(3) }),
  ]),
};

async function boundedBody(request: Request, limit: number) {
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader) {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      size += result.value.byteLength;
      if (size > limit) {
        await reader.cancel();
        return null;
      }
      chunks.push(result.value);
    }
  }
  return Buffer.concat(chunks);
}

async function handle(request: Request, context: { params: Promise<{ path: string[] }> }) {
  if (!authenticateExtension(request)) {
    return Response.json({ error: "Connection expired or revoked. Pair with the local engine again." }, { status: 401 });
  }
  const { path: segments } = await context.params;
  if (!extensionRouteAllowed(request.method, segments)) {
    return Response.json({ error: "This API is not available to extensions." }, { status: 403 });
  }
  const [tool, docId, operation] = segments;
  if (tool === "status") return Response.json({ ok: true, name: "PaperMotion", maxPdfBytes: MAX_EXTENSION_PDF_BYTES });
  const ctx = { params: Promise.resolve({ docId }) };
  try {
    if (request.method === "POST") {
      const buffer = await boundedBody(request, tool === "upload" ? MAX_EXTENSION_PDF_BYTES + 65536 : 65536);
      if (!buffer) return Response.json({ error: "Request is too large. PDFs must be 20 MB or smaller." }, { status: 413 });
      request = new Request(request.url, { method: "POST", headers: request.headers, body: buffer });
      if (tool === "upload") {
        const form = await request.formData();
        const file = form.get("file");
        if (!(file instanceof Blob) || file.size > MAX_EXTENSION_PDF_BYTES || form.has("sample")) {
          return Response.json({ error: "A PDF file of at most 20 MB is required." }, { status: 400 });
        }
        if (await file.slice(0, 5).text() !== "%PDF-") return Response.json({ error: "The response is not a PDF. Choose a PDF file instead." }, { status: 422 });
        const clean = new FormData();
        clean.set("file", file, "name" in file && typeof file.name === "string" ? file.name.replace(/\.[^.]*$/, "") + ".pdf" : "document.pdf");
        return await upload(new Request(request.url, { method: "POST", body: clean }));
      }
      if (tool in bodies) {
        const schema = bodies[tool as keyof typeof bodies];
        const parsed = schema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return Response.json({ error: "Invalid study request." }, { status: 400 });
        request = new Request(request.url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(parsed.data) });
      }
    }
    if (tool === "doc") return await document(request, ctx);
    if (tool === "tags") return await tags(request, ctx);
    if (tool === "kg") {
      if (operation === "state") return await graph(request, ctx);
      return operation === "build" ? await buildGraph(request, ctx) : await evaluateGraph(request, ctx);
    }
    const handlers = { chat, flashcards, quizzes }[tool as "chat" | "flashcards" | "quizzes"];
    if (request.method === "DELETE") {
      const key = tool === "chat" ? "chatId" : "sessionId";
      if (!id.safeParse(new URL(request.url).searchParams.get(key)).success) {
        return Response.json({ error: "Invalid session ID." }, { status: 400 });
      }
    }
    return await handlers[request.method as "GET" | "POST" | "DELETE"](request, ctx);
  } catch (error) {
    const payload = toCodexErrorPayload(error);
    return Response.json({ error: payload.message, kind: payload.kind }, { status: 503 });
  }
}

async function response(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const result = await handle(request, context);
  result.headers.set("Cache-Control", "no-store");
  return result;
}

export { response as GET, response as POST, response as DELETE };