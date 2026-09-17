import { createHash, timingSafeEqual } from "node:crypto";

export const EXTENSION_ID = /^[a-p]{32}$/;
export const MAX_EXTENSION_PDF_BYTES = 20 * 1024 * 1024;

function localOrigin(request: Request): string | null {
  try {
    const url = new URL(request.url);
    const host = request.headers.get("host") ?? url.host;
    const external = new URL(`${url.protocol}//${host}`);
    const localHosts = ["127.0.0.1", "localhost", "[::1]"];
    if (url.protocol !== "http:" || !localHosts.includes(url.hostname)
      || !localHosts.includes(external.hostname) || external.host !== host || external.port !== url.port) return null;
    return external.origin;
  } catch {
    return null;
  }
}

export function isLocalRequest(request: Request): boolean {
  return localOrigin(request) !== null;
}

export function canManagePairing(request: Request): boolean {
  return isLocalRequest(request)
    && request.headers.get("origin") === localOrigin(request)
    && request.headers.get("sec-fetch-site") === "same-origin"
    && request.headers.get("content-type")?.split(";")[0] === "application/json";
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function matchesToken(token: string, expected: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(token) || !/^[a-f0-9]{64}$/.test(expected)) return false;
  return timingSafeEqual(Buffer.from(hashToken(token), "hex"), Buffer.from(expected, "hex"));
}

export function validExtensionOrigin(request: Request, extensionId: string): boolean {
  const origin = request.headers.get("origin");
  return EXTENSION_ID.test(extensionId)
    && (!origin || origin === `chrome-extension://${extensionId}`);
}

export function extensionRouteAllowed(method: string, segments: string[]): boolean {
  const route = segments.join("/");
  if (route === "status") return method === "GET";
  if (route === "upload") return method === "POST";
  if (!/^[a-z0-9-]{1,64}$/.test(segments[1] ?? "")) return false;
  if (segments.length === 2) {
    if (["chat", "flashcards", "quizzes"].includes(segments[0])) {
      return ["GET", "POST", "DELETE"].includes(method);
    }
    return ["doc", "tags"].includes(segments[0]) && method === "GET";
  }
  if (segments.length === 3 && segments[0] === "kg") {
    return segments[2] === "state" ? method === "GET"
      : ["build", "evaluate"].includes(segments[2]) && method === "POST";
  }
  return false;
}