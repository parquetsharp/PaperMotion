import assert from "node:assert/strict";
import { test } from "node:test";
import path from "node:path";
import { discoverCopilotModels, listCopilotModels, parseCopilotModels } from "../lib/providers/copilot-models";

const binary = path.resolve("scripts/fixtures/copilot-models.mjs");
const lookup = (scenario: string) => discoverCopilotModels({ binary, timeoutMs: scenario === "timeout" ? 250 : 5000, env: { ...process.env, COPILOT_MODELS_TEST: scenario } });

test("model catalog validates IDs, deduplicates conservatively, and strips unrelated data", () => {
  assert.deepEqual(parseCopilotModels({ models: [
    { id: "first", name: "First", policy: { state: "disabled" } },
    { id: "first", name: "First", policy: { state: "enabled" } },
    { id: "second", name: "Second", policy: { state: "unconfigured" } },
    { id: "third", name: "Third", secret: "never returned" },
  ] }), [
    { id: "first", name: "First", enabled: false },
    { id: "second", name: "Second", enabled: false },
    { id: "third", name: "Third", enabled: true },
  ]);
  assert.deepEqual(parseCopilotModels({ models: [] }), []);
  for (const value of [null, {}, { models: null }, { models: [{ id: "--bad model", name: "Bad" }] }]) assert.throws(() => parseCopilotModels(value), { code: "invalid_response" });
});

test("discovery uses authenticated metadata only, supports fragmented Unicode frames and legacy handshake", async () => {
  for (const scenario of ["success", "legacy"]) {
    assert.deepEqual(await lookup(scenario), [
      { id: "auto", name: "Auto", enabled: true },
      { id: "account-model", name: "Account model \u00e9", enabled: true },
      { id: "blocked-model", name: "Blocked model", enabled: false },
    ]);
  }
});

test("discovery times out, handles CLI failure, and returns only sanitized errors", async () => {
  for (const [scenario, code] of [["signed-out", "unauthenticated"], ["timeout", "timeout"], ["exit", "unavailable"], ["unsupported", "unsupported_cli"], ["bad-header", "invalid_response"], ["bad-json", "invalid_response"], ["invalid", "invalid_response"], ["error", "unavailable"]]) {
    await assert.rejects(lookup(scenario), (error: unknown) => {
      assert.equal((error as { code: string }).code, code);
      assert.doesNotMatch((error as Error).message, /private-token/);
      return true;
    });
  }
});

test("endpoint coalesces lookups, does not cache accounts, and keeps existing origin restrictions", async () => {
  const previousBinary = process.env.COPILOT_CLI_PATH;
  const previousScenario = process.env.COPILOT_MODELS_TEST;
  process.env.COPILOT_CLI_PATH = binary;
  process.env.COPILOT_MODELS_TEST = "success";
  try {
    const { GET } = await import("../app/api/provider/models/route");
    const first = listCopilotModels();
    assert.equal(listCopilotModels(), first);
    const response = await GET();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    const body = await response.json();
    assert.deepEqual(body.models, await first);
    assert.doesNotMatch(JSON.stringify(body), /private-token|terms|authType/);
    process.env.COPILOT_MODELS_TEST = "signed-out";
    const signedOut = await GET();
    assert.equal(signedOut.status, 401);
    assert.equal((await signedOut.json()).code, "unauthenticated");
    process.env.COPILOT_MODELS_TEST = "invalid";
    assert.equal((await GET()).status, 503);
    const { proxy } = await import("../proxy");
    const { NextRequest } = await import("next/server");
    assert.equal(proxy(new NextRequest("http://localhost/api/provider/models", { headers: { host: "localhost", origin: "https://evil.example", "sec-fetch-site": "cross-site" } })).status, 403);
    const { extensionRouteAllowed } = await import("../lib/extension-security");
    assert.equal(extensionRouteAllowed("GET", ["provider", "models"]), false);
  } finally {
    if (previousBinary === undefined) delete process.env.COPILOT_CLI_PATH;
    else process.env.COPILOT_CLI_PATH = previousBinary;
    if (previousScenario === undefined) delete process.env.COPILOT_MODELS_TEST;
    else process.env.COPILOT_MODELS_TEST = previousScenario;
  }
});