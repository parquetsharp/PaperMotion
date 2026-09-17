import assert from "node:assert/strict";
import { test } from "node:test";
import { evidenceGenerationSchema, resolveEvidencePassage, validateVisualizationEvidence } from "../lib/evidence";
import { vizSchemaFor, type FormulaSpec } from "../lib/schemas";
import { fromJSONSchema } from "zod";
import { buildVizPrompt } from "../lib/agents/viz";
import { generatedVersion, visualizationVersions } from "../lib/viz-versions";

const text = "Momentum equals mass times velocity.\nAn isolated system conserves momentum.";
const source = { docId: "paper", pages: [{ pageIndex: 0, text, items: [{ str: "Momentum equals mass times velocity.", x: 10, y: 700, width: 250, height: 12, eol: true }] }] };
const spec: FormulaSpec = { type: "formula", title: "Momentum", caption: "Momentum formula", main_latex: "p=mv", steps: [{ latex: "p=6", explanation: "Multiply example inputs" }] };
const claim = { id: "definition", target: "main_latex", text: "Momentum equals mass times velocity.", kind: "stated", rationale: "Definition in the source.", dependencies: [], sources: [{ page: 1, quote: "Momentum equals mass times velocity." }] };

test("evidence schema and passage resolution use actual text offsets and server geometry", () => {
  const schema = evidenceGenerationSchema(vizSchemaFor("formula"));
  assert.equal(fromJSONSchema(schema as Parameters<typeof fromJSONSchema>[0]).safeParse({ ...spec, evidence: [claim] }).success, true);
  assert.equal(fromJSONSchema(schema as Parameters<typeof fromJSONSchema>[0]).safeParse({ ...spec, evidence: [{ ...claim, verification: "excerpt_matched" }] }).success, false);
  const result = validateVisualizationEvidence([claim], spec, source);
  const passage = result.claims[0].passages[0];
  assert.equal(result.claims[0].verification, "excerpt_matched");
  assert.equal(source.pages[0].text.slice(passage.start, passage.end), passage.quote);
  assert.equal(passage.page, 0);
  assert.equal(passage.pageHash.length, 64);
  assert.deepEqual(passage.rects, [{ x: 10, y: 700, width: 250, height: 12 }]);
  assert.ok(resolveEvidencePassage(source, 1, "velocity. An isolated system").passage);
  assert.ok(resolveEvidencePassage(source, 2, claim.text).issue);
});

test("unmatched and ambiguous claims are not presented as sourced statements", () => {
  const missing = validateVisualizationEvidence([{ ...claim, sources: [{ page: 1, quote: "A made up quotation from nowhere." }] }], spec, source).claims[0];
  assert.equal(missing.kind, "unsupported");
  assert.equal(missing.verification, "not_checked");
  assert.deepEqual(missing.passages, []);
  assert.ok(resolveEvidencePassage({ docId: "paper", pages: [{ pageIndex: 0, text: text + text }] }, 1, claim.text).issue?.includes("ambiguous"));
  const assumption = validateVisualizationEvidence([{ ...claim, kind: "assumption", sources: [] }], spec, source).claims[0];
  assert.equal(assumption.kind, "assumption");
  assert.equal(assumption.verification, "not_checked");
});

test("invalid targets are omitted with a warning while duplicate IDs and broken dependencies still fail", () => {
  const unavailable = validateVisualizationEvidence([{ ...claim, target: "step:9" }], spec, source);
  assert.deepEqual(unavailable.claims, []);
  assert.match(unavailable.warnings?.[0] ?? "", /1 evidence claim\(s\) omitted/);
  assert.throws(() => validateVisualizationEvidence([claim, claim], spec, source), /unique/);
  assert.throws(() => validateVisualizationEvidence([{ ...claim, dependencies: ["missing"] }], spec, source), /dependency/);
  assert.throws(() => validateVisualizationEvidence([{ ...claim, dependencies: ["other"] }, { ...claim, id: "other", dependencies: [claim.id] }], spec, source), /cycle/);
  const result = validateVisualizationEvidence([claim, { ...claim, id: "calculation", target: "step:1", kind: "derived", dependencies: [claim.id], sources: [] }], spec, source);
  assert.equal(result.claims[1].kind, "derived");
  assert.equal(result.claims[1].verification, "not_checked");
});

test("new evidence prompts include source pages and explicit limits on what is verified", () => {
  const prompt = buildVizPrompt({ type: "formula", label: "Momentum", context: "Mass times velocity", evidenceSource: source });
  assert.match(prompt, /===== EVIDENCE PAGE 1 =====/);
  assert.ok(prompt.includes(text));
  assert.match(prompt, /NEVER invent a quotation/);
  assert.match(prompt, /server, not you, computes offsets/);
  assert.doesNotMatch(buildVizPrompt({ type: "3d", label: "Momentum", context: text, evidenceSource: source }), /EVIDENCE MAP/);
});

test("saved versions retain their own evidence and legacy specifications need no migration", () => {
  const evidence = validateVisualizationEvidence([claim], spec, source);
  const tag = { id: "tag", page: 0, endX: 10, endY: 20, fontHeight: 12, type: "formula" as const, label: "Momentum", ready: true, generating: false, concept: { label: "Momentum", type: "formula" as const, context: text, anchor: claim.text }, spec };
  const updated = { ...tag, ...generatedVersion(tag, { ...spec, evidence }, "new", 100) };
  const versions = visualizationVersions(updated);
  assert.equal(versions.length, 2);
  assert.equal("evidence" in versions[0].spec, false);
  assert.deepEqual(versions[1].spec, { ...spec, evidence });
});

test("simulator evidence never attaches old formula targets or out-of-range lines to a different element", () => {
  const simulator = { type: "interactive" as const, title: "Algorithm", caption: "Algorithm execution", code: ["initialize", "compute", "return"], steps: [] };
  const result = validateVisualizationEvidence([
    { ...claim, target: "code:1" },
    { ...claim, id: "old-formula", target: "main_latex" },
    { ...claim, id: "runtime-step", target: "step:1" },
    { ...claim, id: "out-of-range", target: "code:4" },
    { ...claim, id: "dependent", target: "code:2", kind: "derived", dependencies: ["old-formula"] },
    { ...claim, id: "indirect", target: "code:3", kind: "derived", dependencies: ["dependent"] },
  ], simulator, source);
  assert.deepEqual(result.claims.map(item => item.id), ["definition"]);
  assert.equal(result.claims[0].verification, "excerpt_matched");
  assert.match(result.warnings?.[0] ?? "", /5 evidence claim\(s\) omitted/);
  const prompt = buildVizPrompt({ type: "interactive", label: "Algorithm", context: text, evidenceSource: source, revision: { spec, feedback: "Make this step by step", history: [] } });
  assert.match(prompt, /For THIS simulator, use only code:1 through code:N/);
  assert.match(prompt, /must exist in the NEW response/);
  assert.doesNotMatch(prompt, /formula headline = main_latex/);
});