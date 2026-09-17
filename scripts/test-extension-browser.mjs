import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { chromium } from "playwright";
import { expect } from "playwright/test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { visualizationFixture, checkVisualizations } from "./viz-browser-checks.mjs";
import { checkSimulationSandbox } from "./simulation-browser-checks.mjs";
import { checkManualVisualizations } from "./manual-viz-browser-checks.mjs";
import { checkEvidence } from "./evidence-browser-checks.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const useCopilot = process.argv.includes("--copilot");
const useEdge = process.argv.includes("--edge");
const output = path.join(root, "scripts", "extension-out");
await mkdir(output, { recursive: true });
const temporary = await mkdtemp(path.join(tmpdir(), "papermotion-extension-"));
const dataDirectory = path.join(temporary, "data");
const pdf = await PDFDocument.create();
const page = pdf.addPage([595, 842]);
const font = await pdf.embedFont(StandardFonts.Helvetica);
page.drawText("Mechanics Study Guide", { x: 45, y: 770, size: 20, font });
page.drawText(Array.from({ length: 12 }, () => "Momentum is mass times velocity. Force changes momentum.\nEnergy is conserved in an isolated system. Mass measures inertia.").join("\n"), { x: 45, y: 730, size: 12, font, lineHeight: 22 });
page.drawText("The definition of momentum is mass multiplied by velocity.", { x: 45, y: 150, size: 12, font });
if (process.argv.includes("--manual-selection")) {
  const secondPage = pdf.addPage([595, 842]);
  secondPage.drawText("Additional mechanics", { x: 45, y: 770, size: 20, font });
  secondPage.drawText("A second page for selection boundary checks. Momentum is conserved in an isolated system.", { x: 45, y: 730, size: 12, font, maxWidth: 480 });
}
const pdfBytes = Buffer.from(await pdf.save());
let modelCalls = 0;
const fixture = createServer(async (request, response) => {
  if (request.url === "/lecture.pdf") {
    response.writeHead(200, { "Content-Type": "application/pdf", "Content-Length": pdfBytes.length });
    response.end(pdfBytes);
    return;
  }
  if (request.url === "/other") { response.end("Another browser tab"); return; }
  if (request.url !== "/v1/responses") { response.writeHead(404); response.end(); return; }
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString());
  const schema = JSON.parse(body.input[0].content.split("\n").at(-1));
  const properties = schema.properties;
  let result;
  if (properties.type?.const) {
    try { result = visualizationFixture(schema, body.input.at(-1).content); }
    catch { response.writeHead(503); response.end("Synthetic revision failure"); return; }
  }
  else if (properties.reply) result = { reply: "**Momentum** is mass times velocity: $p = mv$. See page 1." };
  else if (properties.cards) result = { cards: Array.from({ length: 4 }, (_, index) => ({ q: `Recall ${index + 1}: What is momentum?`, a: "Mass times velocity." })) };
  else if (properties.questions) result = { questions: Array.from({ length: 4 }, (_, index) => ({ stem: `Question ${index + 1}: What is momentum?`, options: ["Mass times velocity", "Mass divided by velocity", "Force times mass", "Energy divided by mass"], correctIndex: 0, explanation: "Momentum equals mass multiplied by velocity." })) };
  else if (properties.nodes) result = { nodes: ["Momentum", "Mass", "Velocity", "Force", "Energy", "Inertia"].map(label => ({ id: label.toLowerCase(), label, summary: `${label} is a central concept in mechanics.`, pageHints: [1] })), edges: [{ source: "mass", target: "momentum", relation: "determines" }], globalNote: "Foundations of mechanics." };
  else if (properties.updates) result = { updates: [], globalNote: "Study session recorded." };
  else result = { concepts: [] };
  modelCalls++;
  response.writeHead(200, { "Content-Type": "application/json" });
  response.end(JSON.stringify({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(result) }] }], usage: { input_tokens: 10, output_tokens: 10 } }));
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
let context;
let logs = "";
try {
  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: root,
    env: { ...process.env, GETIT_WEB: "1", GETIT_DATA_DIR: dataDirectory, GETIT_DEFAULT_PROVIDER: useCopilot ? "copilot" : "pi", COPILOT_CLI_PATH: path.join(root, "scripts", "fixtures", "copilot.js"), PAPERMOTION_COPILOT_FIXTURE_URL: `${fixtureOrigin}/v1/responses`, PI_URL: `${fixtureOrigin}/v1`, PI_API_TYPE: "openai-responses", PI_API_KEY: "synthetic-test-key", PI_MODEL_FAST: "fixture", PI_MODEL_SMART: "fixture", NEXT_TELEMETRY_DISABLED: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise((resolve, reject) => {
    const deadline = setTimeout(() => reject(new Error("Test engine did not start.")), 120000);
    const capture = chunk => {
      logs += chunk.toString();
      if (logs.includes("Ready in")) { clearTimeout(deadline); resolve(); }
    };
    server.stdout.on("data", capture);
    server.stderr.on("data", capture);
    server.once("exit", code => { clearTimeout(deadline); reject(new Error(`Test engine exited: ${code}`)); });
  });
  console.log("Test engine started with isolated storage and a synthetic provider.");
  const extension = path.join(root, "extension", "build");
  context = await chromium.launchPersistentContext(path.join(temporary, "profile"), {
    channel: useEdge ? "msedge" : "chromium",
    headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    viewport: { width: 380, height: 900 },
  });
  context.setDefaultTimeout(60000);
  const isPaperMotionWorker = worker => worker.url().endsWith("/background.js") && worker.url().startsWith("chrome-extension://");
  const worker = context.serviceWorkers().find(isPaperMotionWorker) ?? await context.waitForEvent("serviceworker", { predicate: isPaperMotionWorker });
  assert.equal(await worker.evaluate(() => chrome.runtime.getManifest().name), "PaperMotion Study Companion");
  const extensionId = new URL(worker.url()).hostname;
  const browserErrors = [];
  async function openPanel() {
    const nextPanel = await context.newPage();
    nextPanel.on("pageerror", error => browserErrors.push(error.message));
    await nextPanel.goto(`chrome-extension://${extensionId}/panel.html`);
    return nextPanel;
  }
  let panel = await openPanel();
  async function captureStoreAsset(name) {
    if (!process.argv.includes("--store-assets")) return;
    const viewport = panel.viewportSize();
    await panel.setViewportSize({ width: 1280, height: 800 });
    await panel.screenshot({ path: path.join(output, `store-${name}.png`) });
    await panel.setViewportSize(viewport);
  }
  await panel.getByLabel("Engine address").fill(origin);
  const pairingCreated = context.waitForEvent("page");
  await panel.getByRole("button", { name: "Connect", exact: true }).click();
  const pairing = await pairingCreated;
  await pairing.waitForLoadState("domcontentloaded");
  await pairing.getByRole("button", { name: "Approve Connection" }).click();
  await expect(pairing.getByRole("status")).not.toHaveText(/^(Connecting\.\.\.|)$/);
  assert.match(await pairing.getByRole("status").innerText(), /Connected for 30 days/);
  const connection = await worker.evaluate(async () => (await chrome.storage.local.get("connection")).connection);
  assert.equal(connection.origin, origin);
  const auth = { Authorization: `Bearer ${connection.token}`, "X-PaperMotion-Extension": extensionId };
  assert.equal((await fetch(`${origin}/api/extension/status`)).status, 401);
  assert.equal((await fetch(`${origin}/api/extension/settings`, { headers: auth })).status, 403);
  assert.equal((await fetch(`${origin}/api/settings`, { headers: { origin: "https://evil.example", "sec-fetch-site": "cross-site" } })).status, 403);
  assert.equal((await fetch(`${origin}/api/extension/pair`, { method: "POST", headers: { origin: `chrome-extension://${extensionId}`, "sec-fetch-site": "cross-site", "content-type": "application/json" }, body: JSON.stringify({ action: "pair", extensionId }) })).status, 403);
  const pairingOnDisk = JSON.parse(await readFile(path.join(dataDirectory, "extension-pairings", `${extensionId}.json`), "utf8"));
  assert.notEqual(pairingOnDisk.hash, connection.token);
  console.log("Pairing, token hashing, and unauthorized-access checks passed.");

  if (useCopilot) {
    const settingsPage = await context.newPage();
    await settingsPage.goto(origin);
    await settingsPage.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(settingsPage.getByLabel("Model Engine")).toHaveValue("copilot", { timeout: 30000 });
    await expect(settingsPage.getByRole("combobox", { name: "Generation model", exact: true }).locator('option[value="account-model"]')).toHaveCount(1);
    const catalogResponse = await fetch(`${origin}/api/provider/models`);
    assert.equal(catalogResponse.status, 200);
    assert.equal(catalogResponse.headers.get("cache-control"), "no-store");
    assert.equal((await catalogResponse.json()).models.length, 3);
    assert.equal((await fetch(`${origin}/api/provider/models`, { headers: { origin: "https://evil.example", "sec-fetch-site": "cross-site" } })).status, 403);
    await settingsPage.getByRole("button", { name: "Enter custom model: Generation model", exact: true }).click();
    await settingsPage.getByLabel("Generation model", { exact: true }).fill("fixture-fast");
    await settingsPage.getByRole("button", { name: "Enter custom model: Conversation model", exact: true }).click();
    await settingsPage.getByLabel("Conversation model", { exact: true }).fill("fixture-smart");
    await expect.poll(async () => (await (await fetch(`${origin}/api/settings`)).json()).copilotModelSmart).toBe("fixture-smart");
    await settingsPage.reload();
    await settingsPage.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(settingsPage.getByLabel("Conversation model", { exact: true })).toHaveValue("fixture-smart");
    const bounds = await settingsPage.getByLabel("Model Engine").boundingBox();
    assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 380, "Copilot settings fit the narrow viewport.");
    await settingsPage.screenshot({ path: path.join(output, "copilot-settings.png"), fullPage: true });
    await settingsPage.close();
    const status = await (await fetch(`${origin}/api/provider/status`)).json();
    assert.equal(status.provider, "copilot");
    assert.equal(status.installed, true);
    assert.equal(status.authenticated, false, "Installation alone is not proof of authentication.");
    console.log("Copilot selection, model persistence, and unverified account status passed.");
  }

  const source = await context.newPage();
  const remotePdfUrl = "https://papers.example.test/pdf/2309.06180";
  await context.route(remotePdfUrl, route => route.fulfill({ contentType: "application/pdf", body: pdfBytes }));
  assert.equal(await worker.evaluate(() => chrome.permissions.contains({ origins: ["https://papers.example.test/*"] })), false);
  await source.goto(remotePdfUrl);
  await source.bringToFront();
  await expect(panel.locator(".source-title")).toHaveAttribute("title", remotePdfUrl);
  await expect(panel.getByRole("button", { name: "Study This PDF" })).toBeDisabled();
  assert.equal(await worker.evaluate(() => chrome.permissions.contains({ origins: ["https://papers.example.test/*"] })), false);
  assert.equal(modelCalls, 0);
  console.log("HTTPS PDF tab detected without site access or a toolbar activeTab grant.");

  await source.goto(`${fixtureOrigin}/lecture.pdf`);
  await source.bringToFront();
  await expect(panel.locator(".source-title")).toContainText("lecture.pdf");
  await expect(panel.getByRole("button", { name: "Study This PDF" })).toBeDisabled();
  await panel.getByRole("checkbox").check();
  await panel.getByRole("button", { name: "Study This PDF" }).click();
  await expect(panel.locator(".document h2")).toHaveText("lecture.pdf", { timeout: 120000 });
  assert.equal(modelCalls, 0, "Import alone must not send text to the provider.");
  const initialCache = await worker.evaluate(async () => (await chrome.storage.local.get("documents")).documents);
  const document = Object.values(initialCache)[0];
  async function checkSourceRecovery() {
    const docId = document.docId;
    assert.ok(docId, "Imported document has an ID");
    await writeFile(path.join(dataDirectory, "docs", docId, "tags.json"), JSON.stringify({ v: 1, docId, savedAt: Date.now(), activeTagId: "source-test", pagesAnalyzed: [0], tags: [{ id: "source-test", page: 0, endX: 120, endY: 130, fontHeight: 12, type: "2d-text", label: "Momentum source", ready: false, generating: false, concept: { type: "2d-text", label: "Momentum source", context: "Momentum equals mass times velocity.", anchor: "Momentum is mass times velocity." } }] }));
    const generated = await fetch(`${origin}/api/jobs/viz/${docId}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tagId: "source-test" }) });
    assert.equal(generated.status, 200);
    await expect.poll(async () => {
      const state = await (await fetch(`${origin}/api/tags/${docId}`)).json();
      const tag = state.file.tags.find(item => item.id === "source-test");
      if (tag.error) throw new Error(tag.error);
      return tag.ready;
    }, { timeout: 120000 }).toBe(true);
    const sourceViewer = await context.newPage();
    await sourceViewer.setViewportSize({ width: 1440, height: 1000 });
    await sourceViewer.goto(`${origin}/viewer/${docId}`);
    await expect(sourceViewer.locator("article").filter({ hasText: "Momentum equals mass multiplied by velocity." })).toBeVisible();
    const revision = sourceViewer.getByRole("region", { name: "Visualization revision" });
    await revision.getByLabel("Visualization format").selectOption("2d-text");
    const before = modelCalls;
    await revision.getByRole("button", { name: "Generate", exact: true }).click();
    await expect.poll(() => modelCalls).toBeGreaterThan(before);
    await expect(revision.getByRole("button", { name: "Generate", exact: true })).toBeEnabled();
    await expect(sourceViewer.locator("article").filter({ hasText: "Momentum equals mass multiplied by velocity." })).toBeVisible();
    await sourceViewer.screenshot({ path: path.join(output, "copilot-source-recovery.png") });
    await sourceViewer.close();
    console.log("Source queue and manual generation recover from a tools-request response with original page context and tools still disabled.");
  }
  await panel.getByLabel("Message", { exact: true }).fill("What is momentum?");
  await panel.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(panel.locator(".message.assistant")).toContainText("mass times velocity", { timeout: 120000 });
  await panel.getByLabel("Message", { exact: true }).fill("And how is it calculated?");
  await panel.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(panel.locator(".message.assistant")).toHaveCount(2);
  await panel.screenshot({ path: path.join(output, "chat-380.png"), fullPage: true });
  await captureStoreAsset("chat");
  await panel.reload();
  await source.bringToFront();
  await expect(panel.locator(".message.assistant")).toHaveCount(2);
  await panel.getByRole("checkbox").check();
  await panel.getByRole("button", { name: "Study This PDF" }).click();
  await expect(panel.getByRole("checkbox")).toBeEnabled();
  assert.equal((await readdir(path.join(dataDirectory, "docs"))).length, 1, "Identical PDF should reuse the document.");
  console.log("PDF URL import, consent, deduplication, and multi-turn chat persistence passed.");

  await panel.getByRole("tab", { name: "Cards", exact: true }).click();
  await panel.getByRole("button", { name: "Generate Cards" }).click();
  for (let index = 0; index < 4; index++) {
    await panel.getByRole("button", { name: "Reveal Answer", exact: true }).click();
    await panel.getByRole("button", { name: "Good", exact: true }).click();
  }
  await expect(panel.locator(".completion")).toContainText("Session complete");
  await panel.getByRole("tab", { name: "Quiz", exact: true }).click();
  await panel.getByRole("button", { name: "Generate Quiz" }).click();
  for (let index = 0; index < 4; index++) {
    await panel.locator(".options button").filter({ hasText: "Mass times velocity" }).click();
    await expect(panel.locator(".answer strong")).toHaveText("Correct");
    if (index < 3) await panel.getByRole("button", { name: "Next", exact: true }).click();
  }
  await expect(panel.locator(".completion")).toContainText("4 / 4 correct");
  await panel.screenshot({ path: path.join(output, "quiz-380.png"), fullPage: true });
  await captureStoreAsset("quiz");
  await panel.getByRole("tab", { name: "Concepts", exact: true }).click();
  await panel.getByRole("button", { name: "Generate Concepts" }).click();
  await expect(panel.locator(".concept")).toHaveCount(6, { timeout: 120000 });
  await captureStoreAsset("concepts");
  for (const width of [280, 380, 720]) {
    await panel.setViewportSize({ width, height: 900 });
    await panel.screenshot({ path: path.join(output, `concepts-${width}.png`), fullPage: true });
    assert.equal(await panel.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, `No horizontal overflow at ${width}px`);
  }
  await panel.emulateMedia({ colorScheme: "dark" });
  await panel.reload();
  await source.bringToFront();
  await panel.getByRole("tab", { name: "Quiz", exact: true }).click();
  await expect(panel.locator(".completion")).toContainText("4 / 4 correct");
  await panel.setViewportSize({ width: 380, height: 900 });
  await panel.screenshot({ path: path.join(output, "quiz-dark-380.png"), fullPage: true });
  console.log("Flashcards, quiz scoring, concepts, reload persistence, and responsive screenshots passed.");

  if (useCopilot) await checkSourceRecovery();
  if (process.argv.includes("--evidence")) await checkEvidence({ context, origin, docId: document.docId, output, getModelCalls: () => modelCalls });
  if (useCopilot) {
    const status = await (await fetch(`${origin}/api/provider/status`)).json();
    const usage = status.usage;
    assert.ok(usage.copilot.attempts > modelCalls, "Usage includes correction attempts that returned no valid study result");
    assert.equal(usage.calls, usage.copilot.attempts, "The router must not count an attempt twice");
    assert.equal(usage.inputTokens, usage.copilot.attempts * 100);
    assert.equal(usage.outputTokens, usage.copilot.attempts * 20);
    assert.equal(usage.totalTokens, usage.copilot.attempts * 120);
    assert.equal(usage.copilot.totals.nanoAiu, usage.copilot.attempts * 500000000);
    assert.equal(usage.copilot.totals.premiumRequests, usage.copilot.attempts);
    assert.equal(usage.copilot.reported.inputTokens, usage.copilot.attempts);
    assert.equal(JSON.stringify(status).includes("copilotCheckpoints"), false);
    console.log("Usage API reports exact fixture tokens, AI units, and premium requests, including corrections without double counting.");
  }
  if (process.argv.includes("--manual-selection")) await checkManualVisualizations({ context, origin, docId: document.docId, output });

  if (!useEdge) {
  const localFile = path.join(temporary, "Local Mechanics.pdf");
  await writeFile(localFile, pdfBytes);
  const localUrl = pathToFileURL(localFile).href;
  const extensionSettings = await context.newPage();
  await extensionSettings.goto(`${useEdge ? "edge" : "chrome"}://extensions/?id=${extensionId}`);
  const developerMode = extensionSettings.locator("#devMode");
  await expect(developerMode).toBeVisible();
  if (await developerMode.getAttribute("aria-pressed") !== "true") await developerMode.click();
  await expect(developerMode).toHaveAttribute("aria-pressed", "true");
  const fileToggle = extensionSettings.locator("#allow-on-file-urls cr-toggle");
  await expect(fileToggle).toBeVisible();
  async function setFileAccess(allowed) {
    if (await fileToggle.getAttribute("aria-pressed") === String(allowed)) return;
    await fileToggle.click();
    await expect.poll(() => extensionSettings.evaluate(id => new Promise(resolve => {
      chrome.developerPrivate.getExtensionInfo(id, info => resolve(info.state));
    }), extensionId)).toBe("ENABLED");
    await expect(fileToggle).toHaveAttribute("aria-pressed", String(allowed));
  }
  await setFileAccess(false);
  await source.goto(localUrl);
  if (!panel.isClosed()) await panel.close();
  panel = await openPanel();
  await source.bringToFront();
  await expect.poll(() => panel.evaluate(() => chrome.extension.isAllowedFileSchemeAccess())).toBe(false);
  await panel.getByRole("checkbox").check();
  await panel.getByRole("button", { name: "Study This PDF" }).click();
  await expect(panel.getByRole("alert")).toContainText("Allow access to file URLs");
  const callsBeforeLocalImport = modelCalls;

  await extensionSettings.bringToFront();
  await setFileAccess(true);
  if (!panel.isClosed()) await panel.close();
  panel = await openPanel();
  await source.bringToFront();
  await expect.poll(() => panel.evaluate(() => chrome.extension.isAllowedFileSchemeAccess())).toBe(true);
  await expect(panel.locator(".source-title")).toHaveAttribute("title", localUrl);
  await panel.getByRole("checkbox").check();
  await panel.getByRole("button", { name: "Study This PDF" }).click();
  await expect(panel.locator(".document h2")).toHaveText("lecture.pdf");
  assert.equal(modelCalls, callsBeforeLocalImport, "Reading an open local PDF must not start an AI request.");
  assert.equal((await readdir(path.join(dataDirectory, "docs"))).length, 1, "An open local copy should reuse the imported document.");
  await panel.screenshot({ path: path.join(output, "local-pdf-380.png"), fullPage: true });
  await extensionSettings.close();
  console.log("Open local PDF import passed without a file picker; browser file-access permission is required.");
  } else {
    console.log("MANUAL EDGE GATE: verify Allow access to file URLs off/on; automated control selectors are Chromium-specific.");
  }

  await source.goto(`${fixtureOrigin}/other`);
  await expect(panel.getByRole("heading", { name: "No Document Selected" })).toBeVisible();
  await panel.getByRole("checkbox").check();
  await panel.locator('input[type="file"]').setInputFiles({ name: "local-copy.pdf", mimeType: "application/pdf", buffer: pdfBytes });
  await expect(panel.locator(".document h2")).toHaveText("lecture.pdf");
  const opened = context.waitForEvent("page");
  await panel.getByRole("button", { name: "Open interactive viewer", exact: true }).click();
  const viewer = await opened;
  await viewer.waitForURL(`${origin}/viewer/${document.docId}`);
  await viewer.close();
  if (process.argv.includes("--viz")) await checkVisualizations({ context, origin, docId: document.docId, dataDirectory, output, getModelCalls: () => modelCalls });
  if (process.argv.includes("--viz")) await checkSimulationSandbox(context, origin);
  await pairing.bringToFront();
  await pairing.getByRole("button", { name: "Revoke Access" }).click();
  await expect(pairing.getByRole("status")).toHaveText("Extension access revoked.");
  assert.equal((await fetch(`${origin}/api/extension/status`, { headers: auth })).status, 401);
  assert.deepEqual(browserErrors, []);
  console.log("Tab isolation, file-picker fallback, viewer handoff, and token revocation passed.");
  console.log(`All extension browser checks passed. Screenshots: ${output}`);
} finally {
  await context?.close();
  if (server?.pid) {
    if (process.platform === "win32") {
      const kill = spawn("taskkill", ["/PID", String(server.pid), "/T", "/F"], { stdio: "ignore" });
      await once(kill, "exit");
    } else {
      server.kill("SIGTERM");
      await once(server, "exit");
    }
  }
  fixture.closeAllConnections();
  await new Promise(resolve => fixture.close(resolve));
  await writeFile(path.join(output, "engine.log"), logs);
  await rm(temporary, { recursive: true, force: true });
}