import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { expect } from "playwright/test";

const directory = await mkdtemp(path.join(tmpdir(), "papermotion-wakeup-http-"));
const calls = [];
let releaseAutomatically = false;
let cancelled = 0;
const formula = { type: "formula", title: "Momentum", caption: "Momentum equals mass times velocity.", main_latex: "p=mv", steps: [] };
function complete(call) {
  if (call.completed) return;
  call.completed = true;
  call.response.writeHead(200, { "Content-Type": "application/json" });
  call.response.end(JSON.stringify({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(call.detection ? { concepts: [] } : formula) }] }], usage: { input_tokens: 1, output_tokens: 1 } }));
}
const fixture = createServer(async (request, response) => {
  if (request.url !== "/v1/responses") { response.writeHead(404); response.end(); return; }
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString());
  const prompt = body.input.at(-1).content;
  const schema = JSON.parse(body.input[0].content.split("\n").at(-1));
  const call = { response, prompt, detection: !!schema.properties.concepts, completed: false };
  calls.push(call);
  response.on("close", () => { if (!call.completed) cancelled++; });
  if (releaseAutomatically) complete(call);
});
fixture.listen(0, "127.0.0.1");
await once(fixture, "listening");
const fixtureOrigin = `http://127.0.0.1:${fixture.address().port}`;
const reservation = createServer();
reservation.listen(0, "127.0.0.1");
await once(reservation, "listening");
const port = reservation.address().port;
await new Promise(resolve => reservation.close(resolve));
const origin = `http://127.0.0.1:${port}`;
let server;
try {
  await writeFile(path.join(directory, "settings.json"), JSON.stringify({ v: 2, provider: "pi", autoGenerate: false, piUrl: `${fixtureOrigin}/v1`, piApiKey: "fixture", piApiType: "openai-responses", piProvider: "custom", piModelFast: "fixture", detectionConcurrency: 3, vizConcurrency: 3 }));
  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "--port", String(port)], {
    env: { ...process.env, GETIT_WEB: "1", GETIT_DATA_DIR: directory, GETIT_ISOLATED_BUILD: "0", PI_URL: `${fixtureOrigin}/v1`, PI_API_KEY: "fixture", PI_API_TYPE: "openai-responses", NEXT_TELEMETRY_DISABLED: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise((resolve, reject) => {
    const deadline = setTimeout(() => reject(new Error("Test server startup timed out.")), 120000);
    let logs = "";
    const capture = chunk => { logs += chunk.toString(); if (logs.includes("Ready in")) { clearTimeout(deadline); resolve(); } };
    server.stdout.on("data", capture);
    server.stderr.on("data", capture);
    server.once("exit", code => { clearTimeout(deadline); reject(new Error(`Test server exited: ${code}`)); });
  });
  const request = async (route, body) => {
    const response = await fetch(origin + route, { method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(45000) });
    assert.equal(response.status, 200, route);
    return response.json();
  };
  for (const mode of ["detection", "viz"]) {
    const field = mode === "detection" ? "detectionConcurrency" : "vizConcurrency";
    releaseAutomatically = false;
    calls.length = 0;
    await request("/api/settings", { [field]: 3 });
    const ids = [`${mode}-first`, `${mode}-second`, `${mode}-unstarted`];
    for (const docId of ids) {
      const folder = path.join(directory, "docs", docId);
      await mkdir(folder, { recursive: true });
      const numPages = mode === "detection" ? 30 : 1;
      await writeFile(path.join(folder, "meta.json"), JSON.stringify({ id: docId, filename: `${docId}.pdf`, uploadedAt: 0, numPages }));
      await writeFile(path.join(folder, "extracted.json"), JSON.stringify({ numPages, pages: Array.from({ length: numPages }, (_, pageIndex) => ({ pageIndex, width: 600, height: 800, items: [], text: `${docId} page ${pageIndex}. ` + "Momentum equals mass times velocity. ".repeat(20) })) }));
      const tags = mode === "detection" ? [] : Array.from({ length: 9 }, (_, index) => ({ id: `tag-${index}`, page: 0, endX: 0, endY: 0, fontHeight: 12, type: "formula", label: `Momentum ${index}`, ready: index === 8, generating: index !== 8, ...(index === 8 ? { spec: formula } : {}), concept: { label: `${docId} Momentum ${index}`, type: "formula", anchor: "Momentum", context: "Momentum equals mass times velocity." } }));
      await writeFile(path.join(folder, "tags.json"), JSON.stringify({ v: 1, docId, tags, activeTagId: null, pagesAnalyzed: [] }));
    }
    for (const docId of ids.slice(0, 2)) await request(`/api/jobs/${mode === "detection" ? "detect" : "viz"}/${docId}`, mode === "detection" ? {} : { tagId: "tag-0" });
    await expect.poll(() => calls.length, { timeout: 30000 }).toBe(6);
    const originals = [...calls];
    await request("/api/settings", { [field]: 5 });
    await expect.poll(() => calls.length, { timeout: 30000 }).toBe(10);
    assert.ok(originals.every(call => !call.completed));
    for (const docId of ids.slice(0, 2)) assert.equal(calls.filter(call => call.prompt.includes(docId)).length, 5);
    assert.equal(cancelled, 0);
    await request("/api/settings", { [field]: 5 });
    await request("/api/settings", { [field]: 1 });
    assert.equal(calls.length, 10);
    assert.equal(cancelled, 0);
    for (const docId of ids.slice(0, 2)) complete(calls.find(call => call.prompt.includes(docId)));
    await expect.poll(async () => {
      const states = await Promise.all(ids.slice(0, 2).map(docId => request(`/api/tags/${docId}`)));
      return states.every(state => mode === "detection" ? state.file.pagesAnalyzed.length >= 5 : state.file.tags.filter(tag => tag.ready).length >= 2);
    }, { timeout: 30000 }).toBe(true);
    assert.equal(calls.length, 10, "Lower limits do not replace a completed request while above the limit");
    releaseAutomatically = true;
    calls.forEach(complete);
    await expect.poll(async () => {
      const states = await Promise.all(ids.slice(0, 2).map(docId => request(`/api/tags/${docId}`)));
      return states.every(state => !state.detectionRunning && !state.vizQueueRunning);
    }, { timeout: 30000 }).toBe(true);
    const expectedCalls = mode === "detection" ? 12 : 16;
    assert.equal(calls.length, expectedCalls);
    assert.equal(new Set(calls.map(call => call.prompt)).size, expectedCalls);
    await request("/api/settings", { [field]: 6 });
    const dormant = await request(`/api/tags/${ids[2]}`);
    assert.equal(dormant.detectionRunning, false);
    assert.equal(dormant.vizQueueRunning, false);
    assert.equal(calls.length, expectedCalls);
    assert.equal(cancelled, 0);
    console.log(`${mode}: HTTP Settings save scales both active documents from 3 to 5 immediately, preserves running calls, and leaves finished/unstarted work alone.`);
  }
} finally {
  releaseAutomatically = true;
  calls.forEach(complete);
  if (server?.pid) {
    if (process.platform === "win32") { const kill = spawn("taskkill", ["/PID", String(server.pid), "/T", "/F"], { stdio: "ignore" }); await once(kill, "exit"); }
    else { server.kill("SIGTERM"); await once(server, "exit"); }
  }
  fixture.closeAllConnections();
  await new Promise(resolve => fixture.close(resolve));
  await rm(directory, { recursive: true, force: true });
}