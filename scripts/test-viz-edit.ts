import assert from "node:assert/strict";
import { test } from "node:test";
import { validateInteractiveSpec } from "../lib/interactive-viz";
import { vizSchemaFor } from "../lib/schemas";
import { buildVizPrompt } from "../lib/agents/viz";
import { editVisualization, VizEditError } from "../lib/viz-edit";
import type { PersistedTagsFile } from "../lib/tags-store";
import type { VizSpec } from "../lib/schemas";
import { beginVizEdit } from "../lib/viz-edit-lock";
import { fitSceneDistance } from "../lib/viz-framing";

const step = {
  title: "Compare values", explanation: "Compare the current value with the next value.", line: 1,
  variables: [{ name: "index", value: "0" }],
  items: [{ id: "left", label: "First", value: "2", column: 0, row: 0, state: "active" }, { id: "right", label: "Second", value: "1", column: 1, row: 0, state: "neutral" }],
  links: [{ from: "left", to: "right", label: "compare" }],
};
const lesson = { type: "interactive", title: "Compare and swap", caption: "Follow the values through a comparison.", code: ["compare(values[index], values[index + 1])"], steps: [step, { ...step, title: "Swap values" }] };

test("3D camera fitting accounts for the narrower horizontal field of view", () => {
  const desktop = fitSceneDistance(1, 50, 1.4);
  const mobile = fitSceneDistance(1, 50, 0.5);
  assert.ok(mobile > desktop);
  const horizontal = Math.atan(Math.tan(50 * Math.PI / 360) * 0.5);
  assert.ok(mobile * Math.sin(horizontal) > 1);
});

test("interactive lessons validate structured diagram and code references", () => {
  assert.equal(validateInteractiveSpec(lesson).steps.length, 2);
  assert.equal((vizSchemaFor("interactive") as { type: string }).type, "object");
  assert.throws(() => validateInteractiveSpec({ ...lesson, steps: [{ ...step, line: 3 }, step] }), /code line/);
  assert.throws(() => validateInteractiveSpec({ ...lesson, steps: [{ ...step, items: [step.items[0], step.items[0]] }, step] }), /unique/);
  assert.throws(() => validateInteractiveSpec({ ...lesson, steps: [{ ...step, links: [{ from: "missing", to: "right", label: "" }] }, step] }), /missing item/);
});

test("revision prompt contains source, current formula, and successive feedback", () => {
  const prompt = buildVizPrompt({ type: "formula", label: "Momentum", context: "Momentum equals mass times velocity.", revision: { spec: { type: "formula", title: "Momentum", caption: "An incorrect equation to revise.", main_latex: "p=m/v", steps: [] }, feedback: "Use multiplication, not division.", history: ["Explain the units too."] } });
  assert.match(prompt, /p=m\/v/);
  assert.match(prompt, /Use multiplication, not division/);
  assert.match(prompt, /Explain the units too/);
  assert.match(prompt, /Momentum equals mass times velocity/);
  assert.match(buildVizPrompt({ type: "interactive", label: "Sort", context: "Sort an array" }), /simulation_code/);
});

test("Source prompt permits grounded summaries without browsing or invented references", () => {
  const prompt = buildVizPrompt({ type: "2d-text", label: "Momentum", context: "Momentum equals mass times velocity." });
  assert.match(prompt, /without requesting tools/);
  assert.match(prompt, /Never reconstruct quotations from memory or invent URLs/);
  assert.match(prompt, /return citations: \[\]/);
  assert.match(prompt, /external\nsources were not verified/);
  assert.doesNotMatch(prompt, /best high-confidence quote/);
});

test("Source output stays English for foreign input, revisions, and repairs without changing other formats", () => {
  const source = { type: "2d-text" as const, title: "Quantita di moto", caption: "Una definizione dal documento.", body_markdown: "La quantita di moto e massa per velocita.", citations: [] };
  const base = { type: "2d-text" as const, label: "Quantita di moto", context: source.body_markdown };
  const prompts = [
    buildVizPrompt(base),
    buildVizPrompt({ ...base, revision: { spec: source, feedback: "Rispondi in italiano.", history: ["Solo italiano."] } }),
    buildVizPrompt({ ...base, previousAttempt: { spec: source, runtimeError: "Rendering failed" } }),
  ];
  for (const prompt of prompts) {
    assert.match(prompt, /Always write the Source response in English/);
    assert.match(prompt, /citation source\ndescription\) MUST be in English/);
    assert.match(prompt, /faithful English paraphrase/);
    assert.ok(prompt.endsWith("This English-only rule also applies to revisions and repair attempts."));
    assert.doesNotMatch(prompt, /MUST be in the same\nlanguage as the source/);
  }
  for (const type of ["3d", "2d-anim", "formula", "graph", "interactive"] as const) {
    const prompt = buildVizPrompt({ ...base, type });
    assert.match(prompt, /MUST be in the same\nlanguage as the source/);
    assert.doesNotMatch(prompt, /Always write the Source response in English/);
  }
});

test("visualization revisions preserve source, history, undo, and failed previous renders", async () => {
  const original: VizSpec = { type: "formula", title: "Momentum", caption: "Momentum from mass and velocity.", main_latex: "p=m/v", steps: [] };
  const corrected: VizSpec = { ...original, main_latex: "p=mv" };
  let file: PersistedTagsFile = { v: 1, docId: "test", savedAt: 0, tags: [{ id: "tag", page: 0, endX: 0, endY: 0, fontHeight: 12, type: "formula", label: "Momentum", ready: true, generating: false, spec: original, concept: { type: "formula", label: "Momentum", context: "Mass times velocity", anchor: "Momentum" } }], activeTagId: "tag", pagesAnalyzed: [0] };
  const dependencies = {
    load: () => structuredClone(file), save: (_id: string, next: Omit<PersistedTagsFile, "v" | "docId" | "savedAt">) => { file = { ...file, ...next }; },
    document: () => ({ filename: "source.pdf", extracted: { pages: [{ pageIndex: 0, text: "Original source page" }] } }),
    generate: async (args: Parameters<typeof buildVizPrompt>[0]) => { assert.match(args.context, /Original source page/); assert.equal(args.revision?.spec?.type, "formula"); return corrected; },
  };
  const updated = await editVisualization("test", "tag", { action: "generate", type: "formula", feedback: "Use multiplication", revision: 0 }, dependencies);
  assert.deepEqual(updated.spec, corrected);
  assert.equal(updated.versions?.length, 1);
  assert.equal(updated.feedback?.[0].message, "Use multiplication");
  await assert.rejects(editVisualization("test", "tag", { action: "undo", revision: 0 }, dependencies), (error: unknown) => error instanceof VizEditError && error.status === 409);
  const restored = await editVisualization("test", "tag", { action: "undo", revision: 1 }, dependencies);
  assert.deepEqual(restored.spec, original);
  await assert.rejects(editVisualization("test", "tag", { action: "generate", type: "interactive", revision: 2 }, { ...dependencies, generate: async () => { throw new Error("Provider offline"); } }), /Provider offline/);
  assert.deepEqual(file.tags[0].spec, original);
  assert.equal(file.tags[0].ready, true);
  assert.equal(file.tags[0].feedback?.at(-1)?.status, "failed");
  assert.deepEqual(file.pagesAnalyzed, [0]);
});

test("revision requests reject invalid payloads and simultaneous edits", async () => {
  await assert.rejects(editVisualization("test", "tag", { action: "generate", type: "invalid", revision: 0 }), (error: unknown) => error instanceof VizEditError && error.status === 400);
  const release = beginVizEdit("test", "locked");
  assert.ok(release);
  try {
    await assert.rejects(editVisualization("test", "locked", { action: "undo", revision: 0 }), (error: unknown) => error instanceof VizEditError && error.status === 409);
  } finally { release(); }
});

test("revision completion preserves unrelated updates and rejects changed base specs", async () => {
  const spec: VizSpec = { type: "formula", title: "Momentum", caption: "Momentum equals mass times velocity.", main_latex: "p=mv", steps: [] };
  let file: PersistedTagsFile = { v: 1, docId: "race", savedAt: 0, activeTagId: "tag", pagesAnalyzed: [0], tags: [{ id: "tag", page: 0, endX: 0, endY: 0, fontHeight: 12, type: "formula", label: "Momentum", ready: true, generating: false, spec, concept: { type: "formula", label: "Momentum", context: "Mass times velocity", anchor: "Momentum" } }] };
  const dependencies = {
    load: () => structuredClone(file), save: (_id: string, next: Omit<PersistedTagsFile, "v" | "docId" | "savedAt">) => { file = { ...file, ...next }; },
    document: () => ({ filename: "source.pdf", extracted: { pages: [] } }),
    generate: async () => { file.pagesAnalyzed = [0, 1]; file.activeTagId = null; return spec; },
  };
  await editVisualization("race", "tag", { action: "generate", type: "formula", revision: 0 }, dependencies);
  assert.deepEqual(file.pagesAnalyzed, [0, 1]);
  assert.equal(file.activeTagId, null);
  await assert.rejects(editVisualization("race", "tag", { action: "generate", type: "formula", revision: 1 }, { ...dependencies, generate: async () => { file.tags[0].spec = { ...spec, title: "Changed elsewhere" }; return spec; } }), (error: unknown) => error instanceof VizEditError && error.status === 409);
  assert.equal(file.tags[0].spec?.title, "Changed elsewhere");
});