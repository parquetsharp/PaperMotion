import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { chromium } from "playwright";
import { expect } from "playwright/test";

const temporary = await mkdtemp(path.join(tmpdir(), "papermotion-settings-test-"));
const output = path.resolve("scripts/extension-out");
await mkdir(output, { recursive: true });
const reservation = createServer();
reservation.listen(0, "127.0.0.1");
await once(reservation, "listening");
const port = reservation.address().port;
await new Promise(resolve => reservation.close(resolve));
const origin = `http://127.0.0.1:${port}`;
let server;
let browser;
try {
  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "--port", String(port)], {
    env: { ...process.env, GETIT_WEB: "1", GETIT_DATA_DIR: temporary, NEXT_TELEMETRY_DISABLED: "1", GETIT_ISOLATED_BUILD: "0" }, stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise((resolve, reject) => {
    const deadline = setTimeout(() => reject(new Error("Test engine startup timed out.")), 120000);
    let logs = "";
    const capture = chunk => { logs += chunk; if (logs.includes("Ready in")) { clearTimeout(deadline); resolve(); } };
    server.stdout.on("data", capture); server.stderr.on("data", capture);
    server.once("exit", code => { clearTimeout(deadline); reject(new Error(`Test engine exited: ${code}`)); });
  });
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage();
  const settings = { provider: "copilot", copilotModelFast: "auto", copilotModelSmart: "auto", theme: "light", autoGenerate: false, maxRetries: 3 };
  let writes = 0;
  const usage = { inputTokens: 1234, outputTokens: 66, totalTokens: 1300, calls: 3, costUsd: 0, day: "2026-09-16", since: 1, updatedAt: 1,
    copilot: { attempts: 3, totals: { inputTokens: 1234, outputTokens: 66, cacheReadTokens: 100, cacheWriteTokens: 300, nanoAiu: 250000000, premiumRequests: 1.5 }, reported: { inputTokens: 2, outputTokens: 2, cacheReadTokens: 2, cacheWriteTokens: 2, nanoAiu: 2, premiumRequests: 2 } } };
  let modelRequests = 0;
  let modelStatus = 200;
  let modelReply = { models: [
    { id: "auto", name: "Auto", enabled: true },
    { id: "claude-haiku-4.5", name: "Fixture Haiku", enabled: true },
    { id: "gpt-5.4", name: "Fixture GPT", enabled: true },
    { id: "account-only-model", name: "Account-only model", enabled: true },
    { id: "blocked-model", name: "Blocked model", enabled: false },
  ] };
  await page.route("**/api/**", async route => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/provider/models") {
      modelRequests++;
      await route.fulfill({ status: modelStatus, json: modelReply });
      return;
    }
    let body = {};
    if (url.pathname === "/api/settings") {
      if (route.request().method() === "POST") { Object.assign(settings, route.request().postDataJSON()); writes++; }
      body = settings;
    } else if (url.pathname === "/api/codex/health") body = { ok: true, kind: null, serial: 0 };
    else if (url.pathname === "/api/doc/settings-test") body = { docId: "settings-test", filename: "A-long-algorithm-paper-name-for-navigation.pdf", pdfUrl: "/unused.pdf", numPages: 0, pages: [] };
    else if (url.pathname === "/api/tags/settings-test") body = { file: { v: 1, tags: [], pagesAnalyzed: [], activeTagId: null }, numPages: 0, detectionRunning: false, vizQueueRunning: false };
    else if (url.pathname === "/api/provider/status") body = { provider: "copilot", label: "GitHub Copilot", installed: true, authenticated: false, statusMessage: "CLI installed. Sign in to study.", docsUrl: "https://docs.github.com/en/copilot", exposesLimits: false, usage };
    await route.fulfill({ json: body });
  });
  for (const [width, height] of [[1440, 900], [768, 900], [390, 844]]) {
    await page.setViewportSize({ width, height });
    await page.goto(`${origin}/viewer/settings-test`);
    const header = page.locator(".tab-bar");
    await expect(header).toBeVisible();
    const headerHeight = await header.evaluate(element => element.getBoundingClientRect().height);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    const engine = page.getByLabel("Model Engine", { exact: true });
    await expect(engine).toHaveValue("copilot", { timeout: 15000 });
    const inspect = () => engine.evaluate(element => {
      const rect = element.getBoundingClientRect();
      const header = document.querySelector(".tab-bar");
      const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      return { clickable: element === hit || element.contains(hit), top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right, headerBottom: header.getBoundingClientRect().bottom, headerHeight: header.getBoundingClientRect().height, headerScrollTop: header.scrollTop, overflowY: getComputedStyle(header).overflowY };
    });
    await expect.poll(async () => (await inspect()).clickable).toBe(true);
    const state = await inspect();
    assert.ok(state.top > state.headerBottom, "Settings body extends over the viewer below the header.");
    assert.ok(state.left >= 0 && state.right <= width && state.bottom < height, "Settings controls fit the viewport.");
    assert.equal(state.headerScrollTop, 0);
    assert.equal(state.overflowY, "visible");
    assert.equal(state.headerHeight, headerHeight, "Opening Settings does not resize the header.");
    const generation = page.getByRole("combobox", { name: "Generation model", exact: true });
    const model = page.getByLabel("Conversation model", { exact: true });
    await expect(generation.locator('option[value="auto"]')).toHaveText("Auto (Copilot chooses)");
    await expect(generation.locator('option[value="account-only-model"]')).toHaveCount(1);
    await expect(generation.locator('option[value="blocked-model"]')).toBeDisabled();
    await expect(generation.locator('option[value="gemini-3.7-flash"]')).toHaveCount(0);
    await generation.selectOption("claude-haiku-4.5");
    await page.getByRole("combobox", { name: "Conversation model", exact: true }).selectOption("gpt-5.4");
    await expect.poll(() => [settings.copilotModelFast, settings.copilotModelSmart]).toEqual(["claude-haiku-4.5", "gpt-5.4"]);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(generation).toHaveValue("claude-haiku-4.5");
    await expect(model).toHaveValue("gpt-5.4");
    await expect(model.locator("xpath=ancestor::div[@style][1]")).toHaveCSS("opacity", "1");
    await page.screenshot({ path: path.join(output, `copilot-model-dropdowns-${width}.png`) });
    await page.getByRole("button", { name: "Enter custom model: Conversation model", exact: true }).click();
    await model.fill(`model-${width}`);
    await expect.poll(() => settings.copilotModelSmart).toBe(`model-${width}`);
    await page.screenshot({ path: path.join(output, `viewer-settings-${width}.png`) });
    await page.keyboard.press("Escape");
    await expect(engine).toHaveCount(0);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(model).toHaveValue(`model-${width}`);
    await page.reload();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(model).toHaveValue(`model-${width}`);
    await expect(generation).toHaveValue("claude-haiku-4.5");
    await page.getByRole("button", { name: "Select from list: Conversation model", exact: true }).click();
    await expect(page.getByRole("combobox", { name: "Conversation model", exact: true })).toHaveValue("auto");
    await expect.poll(() => settings.copilotModelSmart).toBe("auto");
    const detection = page.getByRole("spinbutton", { name: "Detection batches", exact: true });
    const visualizations = page.getByRole("spinbutton", { name: "Visualizations", exact: true });
    await expect(detection).toHaveValue("3");
    await expect(visualizations).toHaveValue("4");
    await detection.fill("6");
    await visualizations.fill("12");
    await expect.poll(() => [settings.detectionConcurrency, settings.vizConcurrency]).toEqual([6, 12]);
    await visualizations.fill("");
    await detection.click();
    await expect(visualizations).toHaveValue("12");
    await page.reload();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(detection).toHaveValue("6");
    await expect(visualizations).toHaveValue("12");
    await visualizations.click({ trial: true });
    const menu = visualizations.locator("xpath=ancestor::div[@style][1]");
    const menuBounds = await menu.boundingBox();
    await page.screenshot({ path: path.join(output, `parallelism-settings-${width}.png`) });
    const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, scrollX, scrollY, documentWidth: document.documentElement.scrollWidth }));
    const ancestors = await menu.evaluate(element => {
      const result = [];
      for (let parent = element; parent; parent = parent.parentElement) {
        result.push({ tag: parent.tagName, class: parent.className, left: parent.getBoundingClientRect().left, width: parent.getBoundingClientRect().width, scrollLeft: parent.scrollLeft, scrollTop: parent.scrollTop, right: parent.style.right });
      }
      return result;
    });
    assert.ok(menuBounds && menuBounds.x >= 0 && menuBounds.x + menuBounds.width <= width && menuBounds.y + menuBounds.height <= height, `The taller Settings menu stays inside the viewport: ${JSON.stringify({ menuBounds, viewport, ancestors })}`);
    await detection.fill("999");
    await visualizations.fill("0");
    await expect(detection).toHaveValue("8");
    await expect(visualizations).toHaveValue("1");
    await expect.poll(() => [settings.detectionConcurrency, settings.vizConcurrency]).toEqual([8, 1]);
    await page.getByRole("button", { name: "Reset parallelism to defaults", exact: true }).click();
    await expect.poll(() => [settings.detectionConcurrency, settings.vizConcurrency]).toEqual([3, 4]);
    await expect(generation).toHaveValue("claude-haiku-4.5");
    await page.mouse.click(width - 5, height - 15);
    await expect(engine).toHaveCount(0);
    await page.getByRole("button", { name: "Account", exact: true }).click();
    const consumption = page.getByRole("region", { name: "Copilot consumption" });
    await expect(consumption).toContainText("1,300 (partial)");
    await expect(consumption).toContainText(`${usage.copilot.totals.nanoAiu / 1e9} (partial)`);
    await expect(consumption.locator("div").filter({ has: page.locator("dt", { hasText: "Credits used" }) })).toContainText("Not reported");
    const accountMenu = consumption.locator("xpath=ancestor::div[@style][1]");
    await expect(accountMenu).toHaveCSS("opacity", "1");
    const accountBounds = await accountMenu.boundingBox();
    assert.ok(accountBounds.x >= 0 && accountBounds.x + accountBounds.width <= width && accountBounds.y + accountBounds.height <= height);
    await page.screenshot({ path: path.join(output, `copilot-usage-${width}.png`) });
    usage.copilot.totals.nanoAiu += 1000000000;
    await page.getByRole("button", { name: "Refresh account usage" }).click();
    await expect(consumption).toContainText(`${usage.copilot.totals.nanoAiu / 1e9} (partial)`);
    const savedAttempts = usage.copilot.attempts;
    const savedReports = { ...usage.copilot.reported };
    usage.copilot.attempts = 0;
    for (const field of Object.keys(usage.copilot.reported)) usage.copilot.reported[field] = 0;
    await page.getByRole("button", { name: "Refresh account usage" }).click();
    await expect(consumption).toContainText("No tracked attempts today");
    await expect(consumption.locator("div").filter({ has: page.locator("dt", { hasText: "Total tokens" }) })).toContainText("Not reported");
    usage.copilot.attempts = savedAttempts;
    usage.copilot.reported = savedReports;
    const help = page.getByRole("link", { name: "Help", exact: true });
    await help.click({ trial: true });
    await page.keyboard.press("Escape");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    console.log(`Edge ${width}x${height}: model choices and parallelism persist, numeric bounds/default reset work, and menus remain clickable without clipping.`);
  }
  assert.ok(writes >= 3);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const dynamicGeneration = page.getByLabel("Generation model", { exact: true });
  await page.getByRole("combobox", { name: "Generation model", exact: true }).selectOption("account-only-model");
  await expect.poll(() => settings.copilotModelFast).toBe("account-only-model");
  modelStatus = 503;
  modelReply = { error: "Sign in to Copilot, then refresh the model list." };
  await page.getByRole("button", { name: "Refresh Copilot models", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Sign in to Copilot" })).toBeVisible();
  await expect(dynamicGeneration).toHaveValue("account-only-model");
  assert.equal(settings.copilotModelFast, "account-only-model");
  modelStatus = 200;
  modelReply = { models: [{ id: "new-account-model", name: "New account model", enabled: true }] };
  await page.getByRole("button", { name: "Refresh Copilot models", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Conversation model", exact: true }).locator('option[value="new-account-model"]')).toHaveCount(1);
  await expect(dynamicGeneration).toHaveValue("account-only-model");
  await expect(page.getByRole("combobox", { name: "Conversation model", exact: true }).locator('option[value="gpt-5.4"]')).toHaveCount(0);
  assert.ok(modelRequests >= 5);
  console.log("Dynamic account catalog, disabled options, refresh recovery, and saved-model preservation passed.");
} finally {
  await browser?.close();
  if (server?.pid) {
    if (process.platform === "win32") { const kill = spawn("taskkill", ["/PID", String(server.pid), "/T", "/F"], { stdio: "ignore" }); await once(kill, "exit"); }
    else { server.kill("SIGTERM"); await once(server, "exit"); }
  }
  await rm(temporary, { recursive: true, force: true });
}