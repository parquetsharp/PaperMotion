import fs from "node:fs";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { DATA_DIR } from "./paths";
import { EXTENSION_ID, hashToken, isLocalRequest, matchesToken, validExtensionOrigin } from "./extension-security";

function pairingPath(extensionId: string) {
  if (!EXTENSION_ID.test(extensionId)) throw new Error("Invalid extension ID");
  return path.join(DATA_DIR, "extension-pairings", `${extensionId}.json`);
}

export function createPairing(extensionId: string) {
  const file = pairingPath(extensionId);
  const token = randomBytes(32).toString("hex");
  const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify({ hash: hashToken(token), expiresAt }), { mode: 0o600 });
  fs.renameSync(temporary, file);
  return { token, expiresAt };
}

export function revokePairing(extensionId: string) {
  fs.rmSync(pairingPath(extensionId), { force: true });
}

export function authenticateExtension(request: Request): boolean {
  const extensionId = request.headers.get("x-papermotion-extension") ?? "";
  if (!isLocalRequest(request) || !validExtensionOrigin(request, extensionId)) return false;
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) return false;
  try {
    const pairing = JSON.parse(fs.readFileSync(pairingPath(extensionId), "utf8"));
    return typeof pairing.hash === "string" && typeof pairing.expiresAt === "number"
      && pairing.expiresAt > Date.now() && matchesToken(authorization.slice(7), pairing.hash);
  } catch {
    return false;
  }
}