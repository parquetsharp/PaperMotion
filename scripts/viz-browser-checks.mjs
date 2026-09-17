import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { expect } from "playwright/test";

export function visualizationFixture(schema, prompt) {
  const spec = visualizationContent(schema, prompt);
  if (!spec || !schema.properties?.evidence) return spec;
  const target = spec.type === "formula" ? "main_latex" : spec.type === "interactive" ? "code:1" : "paragraph:1";
  const page = Number(/===== EVIDENCE PAGE (\d+) =====/.exec(prompt)?.[1] ?? 1);
  return { ...spec, evidence: [
    { id: "definition", target, text: "Momentum equals mass multiplied by velocity.", kind: "stated", rationale: "The supplied passage defines momentum.", dependencies: [], sources: [{ page, quote: "The definition of momentum is mass multiplied by velocity." }] },
    { id: "example", target: spec.type === "formula" ? "step:1" : target, text: "The example uses mass 2 and velocity 3.", kind: "assumption", rationale: "These example inputs are chosen for illustration, not from the paper.", dependencies: [], sources: [] },
    { id: "result", target: spec.type === "formula" ? "step:1" : target, text: "Example momentum is 6.", kind: "derived", rationale: "Multiply the example mass 2 by velocity 3 using the definition.", dependencies: ["definition", "example"], sources: [] },
    { id: "unmatched", target, text: "An unsupported fixture statement.", kind: "stated", rationale: "This quotation is intentionally absent.", dependencies: [], sources: [{ page, quote: "This exact sentence does not occur in the source PDF." }] },
    ...(spec.type === "interactive" ? [
      { id: "stale-formula", target: "main_latex", text: "A claim left over from the formula.", kind: "stated", rationale: "This target is invalid in a simulator.", dependencies: [], sources: [{ page, quote: "The definition of momentum is mass multiplied by velocity." }] },
      { id: "bad-line", target: "code:24", text: "A missing code line.", kind: "derived", rationale: "The simulator has only three display lines.", dependencies: [], sources: [] },
    ] : []),
  ] };
}

function visualizationContent(schema, prompt) {
  const type = schema.properties?.type?.const;
  if (!type) return null;
  if (prompt.includes("FORCE_FAILURE")) throw new Error("Synthetic revision failure");
  const revised = prompt.includes("Use three values");
  if (type === "interactive") return {
    type, mode: "simulation", title: "Compare and swap", caption: "Execute insertion sort with the supplied values.", code: ["compare adjacent values", "swap if out of order", "return values"],
    inputs: [
      { name: "values", label: "Values", kind: "number-array", defaultValue: revised ? "[2,1,3]" : "[2,1]", minimum: -100, maximum: 100, integer: true, minItems: 0, maxItems: 16, options: [] },
      { name: "descending", label: "Descending", kind: "boolean", defaultValue: "false", minimum: 0, maximum: 1, integer: true, minItems: 0, maxItems: 1, options: [] },
    ],
    simulation_code: `const values = input.values.slice();
      function snapshot(title, line) {
        emit({title, explanation: title + ' the values using adjacent comparisons and swaps.', line,
          variables: [{name:'result',value:JSON.stringify(values)}],
          items: values.length ? values.map((value,index)=>({id:'value'+index,label:['First','Second','Third'][index] || 'Value '+index,value:String(value),column:index%4,row:Math.floor(index/4),state:title==='Complete'?'complete':'active'})) : [{id:'empty',label:'Empty input',value:'[]',column:0,row:0,state:'complete'}], links:[]});
      }
      snapshot('Compare',1);
      for(let index=1;index<values.length;index++){
        let position=index;
        while(position>0 && (input.descending ? values[position-1]<values[position] : values[position-1]>values[position])) {
          [values[position-1],values[position]]=[values[position],values[position-1]];
          position--; snapshot('Swap',2);
        }
      }
      snapshot('Complete',3);`,
  };
  if (type === "2d-anim") return { type, title: "Moving value", caption: "A value moves across the diagram over time.", setup_code: "return { draw: function(ctx,width,height,time,dt) { ctx.fillStyle='#fafafa'; ctx.fillRect(0,0,width,height); ctx.fillStyle='#0284c7'; ctx.fillRect(20+(Math.sin(time*2)+1)*(width-100)/2,height/2,50,50); ctx.fillStyle='#222222'; ctx.font='16px sans-serif'; ctx.fillText('Moving value',20,35); } };" };
  if (type === "3d") return { type, title: "Rotating cube", caption: "Inspect the cube by dragging to rotate it.", setup_code: "camera.position.set(0,1,4); scene.add(new THREE.AmbientLight(0xffffff,2)); const mesh=new THREE.Mesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshStandardMaterial({color:0x0284c7})); group.add(mesh); return {update:function(t){mesh.rotation.x=t*0.4;}};" };
  if (type === "formula") return { type, title: "Momentum", caption: "Momentum equals mass multiplied by velocity.", main_latex: "M_{2048}=2048(2\\times5120\\times40\\times2)=1{,}677{,}721{,}600\\;\\mathrm{bytes}", steps: [{ latex: "p=mv", explanation: "Multiply mass by velocity." }, { latex: "M=" + "2048+".repeat(45) + "0", explanation: "LongToken".repeat(30) }] };
  if (type === "graph") return { type, title: "Momentum plot", caption: "Momentum increases with velocity.", chart_type: "points", x_label: "velocity", y_label: "momentum", data_json: '{"points":[[0,0],[1,2],[2,4]]}' };
  return { type: "2d-text", title: "Momentum source", caption: "Definition from the source document.", body_markdown: "Momentum equals mass multiplied by velocity.", citations: [] };
}

export async function checkVisualizations({ context, origin, docId, dataDirectory, output, getModelCalls }) {
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
  await expect(viewer.getByLabel("Values", { exact: true })).toHaveValue("[2,1]");
  const requestsBeforeRun = getModelCalls();
  await viewer.getByLabel("Values", { exact: true }).fill("[4,1,3,2]");
  await viewer.getByRole("button", { name: "Run simulation", exact: true }).click();
  await expect(viewer.getByRole("button", { name: "Inspect Value 3" })).toBeVisible();
  await viewer.getByRole("slider", { name: "Lesson step" }).press("End");
  await expect(viewer.getByTestId("step-title")).toHaveText("Complete");
  await viewer.getByRole("button", { name: "Inspect First" }).click();
  await expect(viewer.getByRole("status").filter({ hasText: "First: 1 (complete)" })).toBeVisible();
  await viewer.getByLabel("Descending", { exact: true }).check();
  await viewer.getByRole("button", { name: "Run simulation", exact: true }).click();
  await expect(viewer.getByRole("button", { name: "Run simulation", exact: true })).toBeEnabled();
  await viewer.getByRole("slider", { name: "Lesson step" }).press("End");
  await viewer.getByRole("button", { name: "Inspect First" }).click();
  await expect(viewer.getByRole("status").filter({ hasText: "First: 4 (complete)" })).toBeVisible();
  await viewer.getByLabel("Values", { exact: true }).fill("not an array");
  await viewer.getByRole("button", { name: "Run simulation", exact: true }).click();
  await expect(viewer.getByRole("alert").filter({ hasText: "Values:" })).toBeVisible();
  await expect(viewer.getByTestId("step-title")).toHaveText("Complete");
  assert.equal(getModelCalls(), requestsBeforeRun, "Changing inputs reruns locally without AI calls.");
  await viewer.getByRole("button", { name: "Reset inputs", exact: true }).click();
  await expect(viewer.getByLabel("Values", { exact: true })).toHaveValue("[2,1]");
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
  const versions = revision.getByRole("combobox", { name: "Saved visualization version", exact: true });
  const choices = await versions.locator("option").evaluateAll(options => options.map(option => ({ id: option.value, label: option.textContent })));
  assert.ok(choices.length >= 3 && choices.length <= 6);
  const latestVersion = await versions.inputValue();
  const callsBeforeSwitch = getModelCalls();
  const firstVersion = choices.find(choice => choice.id !== latestVersion);
  await versions.selectOption(firstVersion.id);
  await expect(versions).toHaveValue(firstVersion.id);
  await expect(revision.getByRole("button", { name: "Generate", exact: true })).toBeEnabled();
  await viewer.reload();
  await expect(versions).toHaveValue(firstVersion.id);
  await versions.selectOption(latestVersion);
  await expect(viewer.getByTestId("interactive-lesson")).toBeVisible();
  await expect(revision.getByRole("button", { name: "Generate", exact: true })).toBeEnabled();
  assert.deepEqual(await versions.locator("option").evaluateAll(options => options.map(option => option.value)), choices.map(choice => choice.id));
  assert.equal(getModelCalls(), callsBeforeSwitch, "Switching versions and reopening them makes no model calls");
  await viewer.screenshot({ path: path.join(output, "visualization-versions-mobile.png"), fullPage: true });

  const tagsPath = path.join(dataDirectory, "docs", docId, "tags.json");
  const currentFile = JSON.parse(await readFile(tagsPath, "utf8"));
  const target = currentFile.tags.find(tag => tag.id === "viz-test");
  const remaining = { ...target, id: "keep-test", label: "Keep this concept", spec, type: "formula", versions: [], revision: 0, versionId: "kept" };
  await writeFile(tagsPath, JSON.stringify({ ...currentFile, tags: [...currentFile.tags, remaining], savedAt: Date.now() }));
  await viewer.reload();
  await revision.getByRole("button", { name: "Delete visualization", exact: true }).click();
  const dialog = viewer.getByRole("alertdialog", { name: "Confirm visualization deletion", exact: true });
  await expect(dialog).toContainText("cannot be undone");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  assert.equal(JSON.parse(await readFile(tagsPath, "utf8")).tags.length, 2);
  await viewer.route(`**/api/viz/${docId}/viz-test`, async route => {
    if (route.request().method() === "DELETE") await route.fulfill({ status: 409, json: { error: "Synthetic revision conflict" } });
    else await route.continue();
  }, { times: 1 });
  await revision.getByRole("button", { name: "Delete visualization", exact: true }).click();
  await dialog.getByRole("button", { name: "Delete permanently", exact: true }).click();
  await expect(revision.getByRole("alert")).toHaveText("Synthetic revision conflict");
  assert.equal(JSON.parse(await readFile(tagsPath, "utf8")).tags.length, 2);
  await viewer.screenshot({ path: path.join(output, "visualization-delete-mobile.png"), fullPage: true });
  await dialog.getByRole("button", { name: "Delete permanently", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(async () => JSON.parse(await readFile(tagsPath, "utf8")).tags.length).toBe(1);
  await viewer.reload();
  await expect(revision).toBeVisible();
  const afterDelete = JSON.parse(await readFile(tagsPath, "utf8"));
  assert.deepEqual(afterDelete.tags[0].spec, spec);
  assert.equal(afterDelete.tags[0].id, "keep-test");
  assert.ok(afterDelete.deletedTagIds.includes("viz-test"));
  await viewer.getByRole("tab", { name: "Document", exact: true }).click();
  await expect(viewer.locator('[data-page] button').filter({ hasText: "Momentum" })).toHaveCount(0);
  await expect(viewer.getByRole("button", { name: "Formula: Keep this concept", exact: true })).toBeVisible();
  assert.equal(getModelCalls(), callsBeforeSwitch);
  await viewer.getByRole("tab", { name: "Study", exact: true }).click();
  await revision.getByRole("button", { name: "Delete visualization", exact: true }).click();
  await dialog.getByRole("button", { name: "Delete permanently", exact: true }).click();
  await expect(revision).toHaveCount(0);
  await expect(viewer.getByText("No visualizations selected.", { exact: true })).toBeVisible();
  await viewer.reload();
  await expect(viewer.getByText("No visualizations selected.", { exact: true })).toBeVisible();
  const emptyFile = JSON.parse(await readFile(tagsPath, "utf8"));
  assert.equal(emptyFile.tags.length, 0);
  assert.equal(emptyFile.activeTagId, null);
  assert.equal(getModelCalls(), callsBeforeSwitch);
  await viewer.close();
  console.log("Visualization playback, version switching without AI calls, persisted deletion, conflict recovery, and responsive 3D rendering passed.");
}