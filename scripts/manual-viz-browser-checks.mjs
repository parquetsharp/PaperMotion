import assert from "node:assert/strict";
import { expect } from "playwright/test";

export async function checkManualVisualizations({ context, origin, docId, output }) {
  const viewer = await context.newPage();
  await viewer.setViewportSize({ width: 1440, height: 1000 });
  await viewer.goto(`${origin}/viewer/${docId}`);
  const text = viewer.locator('.textLayer [data-pdf-text]').filter({ hasText: "Momentum is mass times velocity." }).first();
  await expect(text).toBeVisible();
  await expect(text).toHaveCSS("color", "rgba(0, 0, 0, 0)");
  const bounds = await text.boundingBox();
  assert.ok(bounds && bounds.width > 100 && bounds.height > 5);
  await viewer.mouse.move(bounds.x + 1, bounds.y + bounds.height / 2);
  await viewer.mouse.down();
  await viewer.mouse.move(bounds.x + bounds.width - 1, bounds.y + bounds.height / 2, { steps: 12 });
  await viewer.mouse.up();
  const toolbar = viewer.getByRole("region", { name: "Selected passage", exact: true });
  await expect(toolbar).toBeVisible();
  await expect(toolbar.getByLabel("Selected PDF text", { exact: true })).toContainText("Momentum");
  await expect(toolbar.getByLabel("Selection visualization format")).toHaveValue("formula");
  const initialState = await (await fetch(`${origin}/api/tags/${docId}`)).json();
  await toolbar.getByLabel("Selection label").fill("Manual momentum");
  await toolbar.getByRole("button", { name: "Generate selection", exact: true }).click();
  await expect(toolbar).toHaveCount(0);
  const read = async () => (await (await fetch(`${origin}/api/tags/${docId}`)).json()).file;
  await expect.poll(async () => (await read()).tags.find(tag => tag.label === "Manual momentum")?.ready, { timeout: 120000 }).toBe(true);
  const file = await read();
  const manual = file.tags.find(tag => tag.label === "Manual momentum");
  assert.equal(file.tags.length, initialState.file.tags.length + 1);
  assert.ok(manual.id.startsWith("manual-"));
  assert.equal(manual.type, "formula");
  assert.ok(manual.selection.text.includes("Momentum"));
  assert.ok(manual.endX > 0 && manual.endY > 0);
  const originalSpecs = initialState.file.tags.filter(tag => tag.ready);
  for (const original of originalSpecs) assert.deepEqual(file.tags.find(tag => tag.id === original.id)?.spec, original.spec);
  await expect(viewer.getByRole("region", { name: "Visualization revision" })).toBeVisible();
  const revision = viewer.getByRole("region", { name: "Visualization revision" });
  await expect(revision.getByRole("button", { name: "Generate", exact: true })).toBeEnabled();
  await expect(viewer.locator(".katex").first()).toBeVisible();
  await viewer.screenshot({ path: `${output}/manual-selection-formula-desktop.png` });
  await viewer.reload();
  await expect(viewer.locator(`[data-page="0"] button[aria-label="Formula: Manual momentum"]`)).toBeVisible();
  await expect(viewer.getByRole("region", { name: "Visualization revision" }).getByLabel("Visualization format")).toHaveValue("formula");

  const secondPageText = viewer.locator('.textLayer[data-selection-page="1"] [data-pdf-text]').first();
  await expect(secondPageText).toBeAttached();
  await text.evaluate(element => {
    const last = document.querySelector('.textLayer[data-selection-page="1"] [data-pdf-text]');
    const range = document.createRange();
    range.setStart(element.firstChild, 0);
    range.setEnd(last.firstChild, last.textContent.length);
    window.getSelection().removeAllRanges(); window.getSelection().addRange(range);
  });
  await expect(toolbar.getByRole("alert")).toHaveText("Select text within a single PDF page.");
  await expect(toolbar.getByRole("button", { name: "Generate selection", exact: true })).toHaveCount(0);
  await toolbar.getByRole("button", { name: "Dismiss selection" }).click();

  const selectText = async () => {
    await expect(text).toBeVisible();
    await text.evaluate(element => {
      const range = document.createRange();
      range.selectNodeContents(element);
      const selection = window.getSelection();
      selection.removeAllRanges(); selection.addRange(range);
    });
    await expect(toolbar).toBeVisible();
  };
  await selectText();
  await toolbar.getByRole("button", { name: "Dismiss selection" }).click();
  await expect(toolbar).toHaveCount(0);
  assert.equal((await read()).tags.length, file.tags.length);
  await selectText();
  await viewer.route(`**/api/viz/${docId}/selection`, route => route.fulfill({ status: 503, json: { error: "Synthetic selection-save failure" } }), { times: 1 });
  await toolbar.getByRole("button", { name: "Generate selection", exact: true }).click();
  await expect(toolbar.getByRole("alert")).toHaveText("Synthetic selection-save failure");
  await expect(toolbar.getByLabel("Selected PDF text", { exact: true })).toContainText("Momentum");
  assert.equal((await read()).tags.length, file.tags.length);
  await toolbar.getByRole("button", { name: "Dismiss selection" }).click();

  for (const type of ["2d-anim", "interactive", "graph", "2d-text", "3d"]) {
    await selectText();
    await toolbar.getByLabel("Selection label").fill(`Manual ${type}`);
    await toolbar.getByLabel("Selection visualization format").selectOption(type);
    await toolbar.getByRole("button", { name: "Generate selection", exact: true }).click();
    await expect(toolbar).toHaveCount(0);
    await expect.poll(async () => (await read()).tags.find(tag => tag.label === `Manual ${type}`)?.ready, { timeout: 120000 }).toBe(true);
    const selected = (await read()).tags.find(tag => tag.label === `Manual ${type}`);
    assert.equal(selected.spec.type, type);
    await expect(revision.getByRole("button", { name: "Generate", exact: true })).toBeEnabled();
    await expect(revision.getByLabel("Visualization format")).toHaveValue(type);
  }

  await viewer.setViewportSize({ width: 390, height: 844 });
  await viewer.getByRole("tab", { name: "Document", exact: true }).click();
  await viewer.getByRole("button", { name: "Zoom in", exact: true }).click();
  await expect(text).toBeVisible();
  await selectText();
  await toolbar.getByLabel("Selection label").fill("Mobile selected source");
  await toolbar.getByLabel("Selection visualization format").selectOption("2d-text");
  const panel = await toolbar.boundingBox();
  assert.ok(panel.x >= 0 && panel.x + panel.width <= 390 && panel.y >= 0 && panel.y + panel.height <= 844);
  await viewer.screenshot({ path: `${output}/manual-selection-mobile.png` });
  await toolbar.getByRole("button", { name: "Generate selection", exact: true }).click();
  await expect(viewer.getByRole("tab", { name: "Study", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect.poll(async () => (await read()).tags.find(tag => tag.label === "Mobile selected source")?.ready, { timeout: 120000 }).toBe(true);
  await expect(viewer.locator("article").filter({ hasText: "Momentum equals mass multiplied by velocity." })).toBeVisible();
  await viewer.screenshot({ path: `${output}/manual-selection-result-mobile.png` });
  assert.equal(await viewer.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);

  const invalid = { requestId: crypto.randomUUID(), page: 0, text: "This text does not exist in the document.", type: "formula", endX: 10, endY: 10, fontHeight: 12 };
  assert.equal((await fetch(`${origin}/api/viz/${docId}/selection`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(invalid) })).status, 400);
  assert.equal((await fetch(`${origin}/api/viz/${docId}/selection`, { method: "POST", headers: { "content-type": "application/json", origin: "https://evil.example", "sec-fetch-site": "cross-site" }, body: JSON.stringify(invalid) })).status, 403);
  const duplicate = { requestId: manual.id.slice("manual-".length), page: manual.page, text: manual.selection.text, type: manual.concept.type, label: manual.concept.label, endX: manual.endX, endY: manual.endY, fontHeight: manual.fontHeight };
  const beforeRetry = await read();
  const repeated = await fetch(`${origin}/api/viz/${docId}/selection`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(duplicate) });
  assert.equal(repeated.status, 200);
  assert.equal((await repeated.json()).tag.ready, true);
  assert.deepEqual(await read(), beforeRetry, "A retried completed create request does not regenerate or change saved state");
  await viewer.close();
  console.log("Manual PDF selection: native drag, all formats, reload persistence, cross-page rejection, zoom, dismiss/failure recovery, mobile handoff, and server validation passed.");
}