import assert from "node:assert/strict";
import { test } from "node:test";
import { canManagePairing, extensionRouteAllowed, hashToken, matchesToken, validExtensionOrigin } from "../lib/extension-security";

const extensionId = "a".repeat(32);
const token = "b".repeat(64);

test("pairing requires an explicit same-origin localhost JSON request", () => {
  const headers = { origin: "http://127.0.0.1:3000", "sec-fetch-site": "same-origin", "content-type": "application/json" };
  assert.equal(canManagePairing(new Request("http://127.0.0.1:3000/api/extension/pair", { headers })), true);
  for (const origin of ["https://evil.example", `chrome-extension://${extensionId}`, "null", ""]) {
    assert.equal(canManagePairing(new Request("http://127.0.0.1:3000/api/extension/pair", { headers: { ...headers, origin } })), false);
  }
  assert.equal(canManagePairing(new Request("http://evil.example/api/extension/pair", { headers: { ...headers, origin: "http://evil.example" } })), false);
  assert.equal(canManagePairing(new Request("http://127.0.0.1:3000/api/extension/pair")), false);
  assert.equal(canManagePairing(new Request("http://localhost:3000/api/extension/pair", { headers: { ...headers, host: "127.0.0.1:3000" } })), true);
  assert.equal(canManagePairing(new Request("http://localhost:3000/api/extension/pair", { headers: { ...headers, host: "evil.example", origin: "http://evil.example" } })), false);
  assert.equal(canManagePairing(new Request("http://localhost:3000/api/extension/pair", { headers: { ...headers, host: "127.0.0.1:3001", origin: "http://127.0.0.1:3001" } })), false);
});

test("pairing credentials are hashed and compared without accepting malformed values", () => {
  assert.equal(matchesToken(token, hashToken(token)), true);
  assert.equal(matchesToken("c".repeat(64), hashToken(token)), false);
  assert.equal(matchesToken("", hashToken(token)), false);
  assert.equal(matchesToken(token, "bad"), false);
});

test("extension origins must match the paired identity when present", () => {
  const request = (origin?: string) => new Request("http://127.0.0.1:3000", { headers: origin ? { origin } : {} });
  assert.equal(validExtensionOrigin(request(`chrome-extension://${extensionId}`), extensionId), true);
  assert.equal(validExtensionOrigin(request(), extensionId), true);
  assert.equal(validExtensionOrigin(request("https://evil.example"), extensionId), false);
  assert.equal(validExtensionOrigin(request(), "../invalid"), false);
});

test("gateway permits study APIs only, with strict paths and methods", () => {
  for (const route of ["chat/doc-1", "flashcards/doc-1", "quizzes/doc-1", "kg/doc-1/build", "upload"]) {
    assert.equal(extensionRouteAllowed("POST", route.split("/")), true, route);
  }
  for (const route of ["settings", "provider/status", "pi-proxy/chat/completions", "chat/../settings", "chat/doc-1/extra", "kg/doc-1/unknown", "doc/%2e%2e", "chat/"]) {
    assert.equal(extensionRouteAllowed("POST", route.split("/")), false, route);
  }
  assert.equal(extensionRouteAllowed("DELETE", ["doc", "doc-1"]), false);
  assert.equal(extensionRouteAllowed("GET", ["upload"]), false);
  assert.equal(extensionRouteAllowed("GET", ["kg", "doc-1", "state"]), true);
});