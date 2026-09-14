import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { expect } from "playwright/test";

export function visualizationFixture(schema, prompt) {
  const type = schema.properties?.type?.const;
  if (!type) return null;
  if (prompt.includes("FORCE_FAILURE")) throw new Error("Synthetic revision failure");
  const revised = prompt.includes("Use three values");
  if (type === "interactive") return {
    type, title: "Compare and swap", caption: "Trace a comparison through its successive states.", code: ["compare(values[0], values[1])", "swap if out of order", "return values"],
    steps: ["Compare", "Swap", "Complete"].map((title, index) => ({ title, explanation: `${title} the two values to put them in ascending order.`, line: index + 1, variables: [{ name: "index", value: String(index) }], items: [
      { id: "left", label: "First", value: index === 0 ? "2" : "1", column: 0, row: 0, state: index === 2 ? "complete" : "active" },
      { id: "right", label: "Second", value: index === 0 ? "1" : "2", column: 1, row: 0, state: "neutral" },
      ...(revised ? [{ id: "third", label: "Third", value: "3", column: 2, row: 0, state: "complete" }] : []),
    ], links: [{ from: "left", to: "right", label: "compare" }] })),
  };
  if (type === "2d-anim") return { type, title: "Moving value", caption: "A value moves across the diagram over time.", setup_code: "return { draw: function(ctx,width,height,time,dt) { ctx.fillStyle='#fafafa'; ctx.fillRect(0,0,width,height); ctx.fillStyle='#0284c7'; ctx.fillRect(20+(Math.sin(time*2)+1)*(width-100)/2,height/2,50,50); ctx.fillStyle='#222222'; ctx.font='16px sans-serif'; ctx.fillText('Moving value',20,35); } };" };
  if (type === "3d") return { type, title: "Rotating cube", caption: "Inspect the cube by dragging to rotate it.", setup_code: "camera.position.set(0,1,4); scene.add(new THREE.AmbientLight(0xffffff,2)); const mesh=new THREE.Mesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshStandardMaterial({color:0x0284c7})); group.add(mesh); return {update:function(t){mesh.rotation.x=t*0.4;}};" };
  if (type === "formula") return { type, title: "Momentum", caption: "Momentum equals mass multiplied by velocity.", main_latex: "p=mv", steps: [{ latex: "p=mv", explanation: "Multiply mass by velocity." }] };
  if (type === "graph") return { type, title: "Momentum plot", caption: "Momentum increases with velocity.", chart_type: "points", x_label: "velocity", y_label: "momentum", data_json: '{"points":[[0,0],[1,2],[2,4]]}' };
  return { type: "2d-text", title: "Momentum source", caption: "Definition from the source document.", body_markdown: "Momentum equals mass multiplied by velocity.", citations: [] };
}

export async function checkVisualizations({ context, origin, docId, dataDirectory, output }) {
  const spec = { type: "formula", title: "Momentum", caption: "Momentum equals mass times velocity.", main_latex: "p=mv", steps: [{ latex: "p=mv", explanation: "Multiply mass by velocity." }] };
  await writeFile(path.join(dataDirectory, "docs", docId, "tags.json"), JSON.stringify({ v: 1, docId, savedAt: Date.now(), activeTagId: "viz-test", pagesAnalyzed: [0], tags: [{ id: "viz-test", page: 0, endX: 120, endY: 130, fontHeight: 12, type: "formula", label: "Momentum", ready: true, generating: false, spec, concept: { type: "formula", label: "Momentum", context: "Momentum equals mass times velocity.", anchor: "Momentum is mass times velocity." } }] }));
  const viewer = await context.newPage();
  await viewer.setViewportSize({ width: 1440, height: 1000 });
  await viewer.goto(`${origin}/viewer/${docId}`);
  const revision = viewer.getByRole("region", { name: "Visualization revision" });
  await expect(revision).toBeVisible();
  await revision.getByLabel("Visualization format").selectOption("2d-anim");
  await revision.getByRole("button", { name: "Generate", exact: true }).click();
  await expect(viewer.getByRole("button", { name: "Pause animation" })).toBeVisible();
  const animation = viewer.getByRole("img", { name: "Animated visualization", exact: true });
  const hash = async () => createHash("sha256").update(await animation.screenshot()).digest("hex");
  const initial = await hash();
  await expect.poll(hash).not.toBe(initial);
  await viewer.getByRole("button", { name: "Pause animation" }).click();
  const paused = await hash();
  assert.equal(await hash(), paused, "Paused animation is stable.");
  await viewer.screenshot({ path: path.join(output, "animation-desktop.png") });

  await revision.getByLabel("Visualization format").selectOption("interactive");
  await revision.getByRole("button", { name: "Generate", exact: true }).click();
  await expect(viewer.getByTestId("step-title")).toHaveText("Compare");
  await viewer.getByRole("button", { name: "Next step", exact: true }).click();
  await expect(viewer.getByTestId("step-title")).toHaveText("Swap");
  await expect(viewer.locator('[aria-current="step"]')).toContainText("swap if out of order");
  await viewer.getByRole("button", { name: "Previous step", exact: true }).click();
  await expect(viewer.getByTestId("step-title")).toHaveText("Compare");
  await viewer.getByRole("slider", { name: "Lesson step" }).fill("2");
  await expect(viewer.getByRole("button", { name: "Next step", exact: true })).toBeDisabled();
  await viewer.getByRole("button", { name: "Inspect First" }).click();
  await expect(viewer.getByRole("status").filter({ hasText: "First: 1 (complete)" })).toBeVisible();
  await viewer.getByRole("button", { name: "First step", exact: true }).click();
  await viewer.getByLabel("Lesson playback speed").selectOption("2");
  await viewer.getByRole("button", { name: "Play lesson", exact: true }).click();
  await expect(viewer.getByTestId("step-title")).toHaveText("Complete");
  await viewer.getByRole("button", { name: "First step", exact: true }).click();
  await revision.getByRole("button", { name: "Discuss and revise visualization" }).click();
  await revision.getByLabel("Visualization feedback", { exact: true }).fill("Use three values");
  await revision.getByRole("button", { name: "Apply feedback" }).click();
  await expect(viewer.getByRole("button", { name: "Inspect Third" })).toBeVisible();
  await expect(revision.getByLabel("Visualization feedback history")).toContainText("Use three values");
  await viewer.screenshot({ path: path.join(output, "interactive-desktop.png") });
  await viewer.reload();
  await expect(viewer.getByRole("button", { name: "Inspect Third" })).toBeVisible();
  await revision.getByRole("button", { name: "Undo last revision" }).click();
  await expect(viewer.getByRole("button", { name: "Inspect Third" })).toHaveCount(0);
  await revision.getByRole("button", { name: "Discuss and revise visualization" }).click();
  await revision.getByLabel("Visualization feedback", { exact: true }).fill("FORCE_FAILURE");
  await revision.getByRole("button", { name: "Apply feedback" }).click();
  await expect(revision.getByRole("alert")).toBeVisible();
  await expect(viewer.getByTestId("interactive-lesson")).toBeVisible();
  await expect(revision.getByLabel("Visualization feedback history")).toContainText("FORCE_FAILURE");
  await revision.getByLabel("Visualization feedback", { exact: true }).fill("Use multiplication");
  await revision.getByLabel("Visualization format").selectOption("formula");
  await revision.getByRole("button", { name: "Apply feedback" }).click();
  await expect(viewer.locator('.katex').first()).toBeVisible();
  await expect(revision.getByLabel("Visualization feedback history")).toContainText("Use multiplication");
  await revision.getByRole("button", { name: "Discuss and revise visualization" }).click();
  await revision.getByLabel("Visualization format").selectOption("3d");
  await revision.getByRole("button", { name: "Generate", exact: true }).click();
  const scene = viewer.getByRole("img", { name: "3D visualization", exact: true });
  await expect(scene).toBeVisible();
  await expect(revision.getByRole("button", { name: "Generate", exact: true })).toBeEnabled();
  const pixelStats = await sharp(await scene.screenshot()).stats();
  assert.ok(pixelStats.channels.some(channel => channel.stdev > 10), "3D canvas contains visible geometry.");
  await viewer.screenshot({ path: path.join(output, "3d-desktop.png") });
  const bounds = await scene.boundingBox();
  await viewer.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await viewer.mouse.down(); await viewer.mouse.move(bounds.x + bounds.width / 2 + 60, bounds.y + bounds.height / 2 + 20, { steps: 5 }); await viewer.mouse.up();
  await viewer.setViewportSize({ width: 390, height: 900 });
  await viewer.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await viewer.screenshot({ path: path.join(output, "3d-mobile.png"), fullPage: true });
  const mobileCanvas = await scene.screenshot();
  const mobileCanvasStats = await sharp(mobileCanvas).stats();
  assert.ok(mobileCanvasStats.channels.some(channel => channel.stdev > 10), "Mobile 3D canvas is nonblank.");
  const dimensions = await sharp(mobileCanvas).metadata();
  for (const left of [0, dimensions.width - 4]) {
    const { data: pixels, info } = await sharp(mobileCanvas).extract({ left, top: 0, width: 4, height: dimensions.height }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    let geometryPixels = 0;
    for (let offset = 0; offset < pixels.length; offset += info.channels) {
      if (pixels[offset + 2] > pixels[offset] + 30 && pixels[offset + 1] > pixels[offset] + 30) geometryPixels++;
    }
    assert.equal(geometryPixels, 0, "Blue fixture geometry stays within the frame on mobile.");
  }
  await viewer.screenshot({ path: path.join(output, "3d-mobile.png"), fullPage: true });
  await revision.getByLabel("Visualization format").selectOption("interactive");
  await revision.getByRole("button", { name: "Generate", exact: true }).click();
  await expect(viewer.getByTestId("interactive-lesson")).toBeVisible();
  const controls = await revision.boundingBox();
  assert.ok(controls && controls.x >= 0 && controls.x + controls.width <= 390, "Revision controls fit the mobile viewport.");
  await viewer.getByRole("tab", { name: "Document", exact: true }).click();
  await expect(viewer.getByTestId("interactive-lesson")).not.toBeVisible();
  await viewer.getByRole("tab", { name: "Study", exact: true }).click();
  await expect(viewer.getByTestId("interactive-lesson")).toBeVisible();
  await viewer.screenshot({ path: path.join(output, "interactive-mobile.png"), fullPage: true });
  assert.equal(await viewer.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "Viewer has no horizontal overflow.");
  await viewer.close();
  console.log("Animation controls, interactive steps, feedback revision, undo, persistence, failed-revision preservation, and 3D rendering passed.");
}