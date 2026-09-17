import { canManagePairing, EXTENSION_ID } from "@/lib/extension-security";
import { createPairing, revokePairing } from "@/lib/extension-pairing";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  if (!canManagePairing(request)) {
    return Response.json({ error: "Pairing must be confirmed on the local engine page." }, { status: 403, headers });
  }
  const body = await request.json().catch(() => null);
  if (!body || typeof body.extensionId !== "string" || !EXTENSION_ID.test(body.extensionId)) {
    return Response.json({ error: "Invalid extension ID." }, { status: 400, headers });
  }
  if (body.action === "revoke") {
    revokePairing(body.extensionId);
    return Response.json({ ok: true }, { headers });
  }
  if (body.action !== "pair") return Response.json({ error: "Unknown action." }, { status: 400, headers });
  return Response.json(createPairing(body.extensionId), { headers });
}