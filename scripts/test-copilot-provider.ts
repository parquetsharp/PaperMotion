import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { CopilotFormatError, copilotArguments, copilotFailure, parseCopilotOutput, parseCopilotResponse, resolveCopilotBinary } from "../lib/providers/copilot-cli";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { CopilotProvider } from "../lib/providers/copilot-provider";
import type { runCliBinary } from "../lib/providers/cli-runner";
import { classifyCodexError } from "../lib/codex-errors";
import { kgBuildSchema, flashcardsGenerateSchema } from "../lib/schemas-kg";
import { detectionBatchSchema, vizSchemaFor } from "../lib/schemas";
import { buildVizPrompt } from "../lib/agents/viz";

function cliOutput(content: string) {
  return [
    JSON.stringify({ type: "assistant.message", data: { content, toolRequests: [] } }),
    JSON.stringify({ type: "result" }),
  ].join("\n");
}

test("Copilot invocation disables tools and updates and keeps document text out of arguments", () => {
  const sessionId = randomUUID();
  const args = copilotArguments("auto", sessionId);
  assert.ok(args.includes("--available-tools="));
  assert.ok(args.includes("--no-auto-update"));
  assert.ok(args.includes("--disable-builtin-mcps"));
  assert.ok(args.includes("--no-remote-export"));
  assert.equal(args[args.indexOf("--output-format") + 1], "json");
  assert.ok(!args.includes("--allow-all-tools"));
  assert.ok(!args.some(value => value === "-p" || value === "--prompt" || value.startsWith("--prompt=")));
  assert.ok(args.includes(`--session-id=${sessionId}`));
  assert.ok(copilotArguments("gpt-5.4", sessionId, true).includes(`--resume=${sessionId}`));
  assert.throws(() => copilotArguments("auto", "../../other-session"));
});

test("Copilot JSON responses accept fences but reject empty, truncated, or non-object output", () => {
  assert.deepEqual(parseCopilotResponse('```json\n{"reply":"Hello"}\n```'), { reply: "Hello" });
  for (const text of ["", "null", "[]", '{"reply":', "Please log in"]) assert.throws(() => parseCopilotResponse(text));
});

test("Copilot setup errors are classified without echoing raw credentials or document text", () => {
  assert.equal(copilotFailure("401 unauthorized private-token").kind, "auth_lost");
  assert.equal(classifyCodexError(copilotFailure("401 unauthorized")).kind, "auth_lost");
  assert.equal(copilotFailure("429 quota").kind, "rate_limit");
  assert.match(copilotFailure("403 organization policy").message, /administrator/);
  assert.ok(!copilotFailure("401 private-token").message.includes("private-token"));
  assert.match(copilotFailure("unknown option --silent").message, /version/);
});

test("Copilot resolver never runs install bootstrappers", () => {
  assert.equal(resolveCopilotBinary({ COPILOT_CLI_PATH: "C:/VSCode/github.copilot-chat/copilotCli/copilot.ps1" }), null);
  assert.equal(resolveCopilotBinary({ COPILOT_CLI_PATH: "C:/missing/copilot.exe", PATH: process.env.PATH }), null);
  assert.equal(resolveCopilotBinary({ PATH: "" }), null);
});

test("Copilot generation uses stdin, selected models, and owned resumable sessions", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "copilot-provider-test-"));
  const calls: Parameters<typeof runCliBinary>[] = [];
  const options = {
    directory,
    resolveBinary: () => "fixture-copilot",
    settings: () => ({ copilotModelFast: "fast", copilotModelSmart: "smart" }),
    run: async (...args: Parameters<typeof runCliBinary>) => {
      calls.push(args);
      return { stdout: cliOutput('{"reply":"ok"}'), stderr: "", exitCode: 0 };
    },
  };
  try {
    const provider = new CopilotProvider(options);
    const prompt = "Document content ".repeat(10000);
    assert.deepEqual((await provider.runJson(prompt, { type: "object" })).data, { reply: "ok" });
    assert.ok(calls[0][2]?.stdin?.includes(prompt));
    assert.ok(!calls[0][1].join(" ").includes(prompt));
    assert.ok(calls[0][1].includes("fast"));
    const start = await provider.runJsonInThread({ start: { input: "Remember momentum" }, outputSchema: {} });
    assert.ok(calls[1][1].includes("smart"));
    const reloaded = new CopilotProvider(options);
    await reloaded.runJsonInThread({ resume: { threadId: start.threadId!, input: "Explain it" }, outputSchema: {} });
    assert.ok(calls[2][1].includes(`--resume=${start.threadId!.slice(8)}`));
    assert.equal(calls[1][2]?.cwd, calls[2][2]?.cwd);
    await assert.rejects(provider.runJsonInThread({ resume: { threadId: `copilot-${randomUUID()}`, input: "x" }, outputSchema: {} }), /unavailable/);
    await assert.rejects(provider.runJsonInThread({ resume: { threadId: "../../secret", input: "x" }, outputSchema: {} }), /another provider/);
    assert.equal(calls.length, 3);
    assert.equal((await readdir(directory)).filter(name => name.endsWith(".json")).length, 1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("model changes apply to new requests while in-flight generation keeps its selected model", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "copilot-model-change-"));
  let model = "old-model";
  const selected: string[] = [];
  let finishFirst = () => {};
  let firstStarted = () => {};
  const firstGate = new Promise<void>(resolve => { finishFirst = resolve; });
  const started = new Promise<void>(resolve => { firstStarted = resolve; });
  const provider = new CopilotProvider({
    directory, resolveBinary: () => "fixture", settings: () => ({ copilotModelFast: model }),
    run: async (_binary, args) => {
      selected.push(args[args.indexOf("--model") + 1]);
      if (selected.length === 1) { firstStarted(); await firstGate; }
      return { stdout: cliOutput('{"reply":"ok"}'), stderr: "", exitCode: 0 };
    },
  });
  try {
    const first = provider.runJson("First", { type: "object" });
    await started;
    model = "new-model";
    await provider.runJson("Second", { type: "object" });
    assert.deepEqual(selected, ["old-model", "new-model"]);
    finishFirst();
    await first;
    assert.deepEqual(selected, ["old-model", "new-model"]);
  } finally { finishFirst(); await rm(directory, { recursive: true, force: true }); }
});

test("Copilot failure and cancellation do not persist a successful chat", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "copilot-failure-test-"));
  try {
    const provider = new CopilotProvider({ directory, resolveBinary: () => "fixture", run: async () => ({ stdout: "", stderr: "401 not authenticated", exitCode: 1 }) });
    await assert.rejects(provider.runJsonInThread({ start: { input: "Hello" }, outputSchema: {} }), { kind: "auth_lost" });
    assert.equal((await readdir(directory)).filter(name => name.endsWith(".json")).length, 0);
    await assert.rejects(provider.runJson("Hello", {}, { signal: AbortSignal.abort() }), { name: "AbortError" });
    const missing = new CopilotProvider({ resolveBinary: () => null });
    await assert.rejects(missing.runJson("Hello", {}), { kind: "binary_missing" });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("Copilot rejects missing and malformed study arrays before downstream iteration", () => {
  assert.throws(() => parseCopilotResponse('{"error":"No document study request was supplied on standard input."}', detectionBatchSchema), /requested study format/);
  assert.throws(() => parseCopilotResponse('{"concepts":{}}', detectionBatchSchema), /requested study format/);
  assert.deepEqual(parseCopilotResponse('{"concepts":[]}', detectionBatchSchema), { concepts: [] });
  for (const response of ['{}', '{"reply":"No document provided"}', '{"nodes":null,"edges":[],"globalNote":"Missing graph"}']) {
    assert.throws(() => parseCopilotResponse(response, kgBuildSchema), /requested study format/);
  }
  assert.throws(() => parseCopilotResponse('{"cards":[{"q":"Recall momentum","a":null}]}', flashcardsGenerateSchema), /requested study format/);
  const valid = { cards: Array.from({ length: 4 }, () => ({ q: "What is momentum?", a: "Mass times velocity." })) };
  assert.deepEqual(parseCopilotResponse(JSON.stringify(valid), flashcardsGenerateSchema), valid);
});

test("Copilot rejects wrong-shaped output from a successful CLI exit without saving a chat", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "copilot-schema-test-"));
  try {
    const provider = new CopilotProvider({ directory, resolveBinary: () => "fixture", run: async () => ({ stdout: cliOutput('{"error":"No document supplied"}'), stderr: "", exitCode: 0 }) });
    await assert.rejects(provider.runJson("Detect concepts", detectionBatchSchema), /requested study format/);
    await assert.rejects(provider.runJsonInThread({ start: { input: "Build graph" }, outputSchema: kgBuildSchema }), /requested study format/);
    assert.equal((await readdir(directory)).filter(name => name.endsWith(".json")).length, 0);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("Copilot schema errors identify failed bounds without exposing response text", () => {
  const privateText = "PRIVATE_DOCUMENT_CONTENT".repeat(30);
  const response = { nodes: [], edges: [], globalNote: privateText };
  assert.throws(() => parseCopilotResponse(JSON.stringify(response), kgBuildSchema), (error: unknown) => {
    assert.ok(error instanceof CopilotFormatError);
    assert.match(error.message, /nodes: too_small.*minimum 4/);
    assert.match(error.message, /globalNote: too_big.*maximum 600/);
    assert.ok(!error.message.includes("PRIVATE_DOCUMENT_CONTENT"));
    return true;
  });
});

test("Copilot corrects an oversized graph note once in the same session", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "copilot-repair-test-"));
  const calls: Parameters<typeof runCliBinary>[] = [];
  const graph = {
    nodes: ["Momentum", "Mass", "Velocity", "Force"].map(label => ({ id: label.toLowerCase(), label, summary: `${label} is part of the mechanics model.`, pageHints: [1] })),
    edges: [{ source: "mass", target: "momentum", relation: "determines" }],
    globalNote: "Momentum relates mass and velocity; force changes momentum.",
  };
  try {
    const provider = new CopilotProvider({
      directory, resolveBinary: () => "fixture", settings: () => ({ copilotModelSmart: "smart" }),
      run: async (...args) => {
        calls.push(args);
        return { stdout: cliOutput(JSON.stringify({ ...graph, globalNote: calls.length === 1 ? "Long graph description. ".repeat(35) : graph.globalNote })), stderr: "", exitCode: 0 };
      },
    });
    const result = await provider.runJsonInThread({ start: { input: "PRIVATE_DOCUMENT_INPUT" }, outputSchema: kgBuildSchema });
    assert.deepEqual(result.data, graph);
    assert.equal(calls.length, 2);
    assert.ok(calls[1][1].includes(`--resume=${result.threadId!.slice(8)}`));
    assert.ok(calls[1][1].includes("smart"));
    assert.equal(calls[0][2]?.cwd, calls[1][2]?.cwd);
    assert.match(calls[1][2]?.stdin ?? "", /globalNote: too_big \(maximum 600\)/);
    assert.ok(!calls[1][2]?.stdin?.includes("PRIVATE_DOCUMENT_INPUT"));
    assert.equal((await readdir(directory)).filter(name => name.endsWith(".json")).length, 1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("Copilot bounds schema correction and does not retry auth failures or cancellation", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "copilot-repair-limit-"));
  try {
    let calls = 0;
    const provider = new CopilotProvider({ directory, resolveBinary: () => "fixture", run: async () => {
      calls++;
      return { stdout: cliOutput('{}'), stderr: "", exitCode: 0 };
    } });
    await assert.rejects(provider.runJsonInThread({ start: { input: "Build graph" }, outputSchema: kgBuildSchema }), CopilotFormatError);
    assert.equal(calls, 2);
    assert.equal((await readdir(directory)).filter(name => name.endsWith(".json")).length, 0);
    calls = 0;
    const controller = new AbortController();
    const cancelled = new CopilotProvider({ directory, resolveBinary: () => "fixture", run: async () => {
      calls++;
      controller.abort();
      return { stdout: cliOutput('{}'), stderr: "", exitCode: 0 };
    } });
    await assert.rejects(cancelled.runJson("Build graph", kgBuildSchema, { signal: controller.signal }), { name: "AbortError" });
    assert.equal(calls, 1);
    calls = 0;
    const unauthorized = new CopilotProvider({ directory, resolveBinary: () => "fixture", run: async () => {
      calls++;
      return { stdout: "", stderr: "401 not logged in", exitCode: 1 };
    } });
    await assert.rejects(unauthorized.runJson("Build graph", kgBuildSchema), { kind: "auth_lost" });
    assert.equal(calls, 1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("Copilot JSONL preserves long strings and rejects truncated or failed streams", () => {
  const reply = "A long sentence without terminal wrapping. ".repeat(20) + "\nA real newline.";
  assert.deepEqual(parseCopilotOutput(cliOutput(JSON.stringify({ reply })), { type: "object" }), { reply });
  assert.throws(() => parseCopilotOutput(JSON.stringify({ type: "assistant.message", data: { content: '{"concepts":[]}' } }), detectionBatchSchema), /did not complete/);
  assert.throws(() => parseCopilotOutput(cliOutput('{"concepts":[]}') + '\n{"type":"session.error"}', detectionBatchSchema), /reported an error/);
  assert.throws(() => parseCopilotOutput('not JSONL', {}), /unreadable response stream/);
  assert.throws(() => parseCopilotOutput('{"type":"assistant.message","data":{"content":"{}","toolRequests":[{}]}}\n{"type":"result"}', {}), /requested tools/);
});

test("Source generation corrects a tool request once without enabling tools or inventing citations", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "copilot-source-tools-"));
  const calls: Parameters<typeof runCliBinary>[] = [];
  const toolOutput = JSON.stringify({ type: "assistant.message", data: { content: "", toolRequests: [{ name: "web_search", arguments: { query: "PRIVATE_QUERY" } }] } }) + '\n{"type":"result"}';
  const source = { type: "2d-text", title: "Momentum source", caption: "A summary of the supplied document.", body_markdown: "The supplied context describes momentum as mass times velocity. External sources were not verified.", citations: [] };
  const schema = vizSchemaFor("2d-text");
  const prompt = buildVizPrompt({ type: "2d-text", label: "Momentum", context: "Momentum equals mass times velocity." });
  try {
    const provider = new CopilotProvider({ directory, resolveBinary: () => "fixture", settings: () => ({ copilotModelFast: "chosen-model" }), run: async (...args) => {
      calls.push(args);
      assert.ok(args[1].includes("--available-tools="));
      assert.ok(args[1].includes("--deny-tool=read,write,shell,url,memory"));
      assert.match(args[2]?.stdin ?? "", /No tools are available/);
      assert.match(args[2]?.stdin ?? "", /Web search is unavailable/);
      assert.match(args[2]?.stdin ?? "", /leave citations empty/);
      return { stdout: calls.length === 1 ? toolOutput : cliOutput(JSON.stringify(source)), stderr: "", exitCode: 0 };
    } });
    assert.deepEqual((await provider.runJson(prompt, schema, { webSearch: true })).data, source);
    assert.equal(calls.length, 2);
    const sessionId = calls[0][1].find(arg => arg.startsWith("--session-id="))!.split("=")[1];
    assert.ok(calls[1][1].includes(`--resume=${sessionId}`));
    assert.ok(calls[1][1].includes("chosen-model"));
    assert.equal(calls[1][2]?.cwd, calls[0][2]?.cwd);
    assert.match(calls[1][2]?.stdin ?? "", /Answer from the supplied context without tools/);
    assert.doesNotMatch(calls[1][2]?.stdin ?? "", /PRIVATE_QUERY/);
    assert.equal((await readdir(path.join(directory, "work"))).length, 0);
    let attempts = 0;
    const persistent = new CopilotProvider({ directory, resolveBinary: () => "fixture", run: async () => { attempts++; return { stdout: toolOutput, stderr: "", exitCode: 0 }; } });
    await assert.rejects(persistent.runJson(prompt, schema, { webSearch: true }), /requested tools/);
    assert.equal(attempts, 2);
    attempts = 0;
    const mixed = new CopilotProvider({ directory, resolveBinary: () => "fixture", run: async () => { attempts++; return { stdout: attempts === 1 ? toolOutput : cliOutput('{}'), stderr: "", exitCode: 0 }; } });
    await assert.rejects(mixed.runJson(prompt, schema, { webSearch: true }), CopilotFormatError);
    assert.equal(attempts, 2, "Tool and schema corrections share one retry budget");
  } finally { await rm(directory, { recursive: true, force: true }); }
});