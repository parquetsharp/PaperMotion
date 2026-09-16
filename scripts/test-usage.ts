import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { parseCopilotUsageReport, parseCopilotUsageOutput, copilotUsageDifference, EMPTY_COPILOT_USAGE } from "../lib/providers/copilot-usage";

const report = (input = 100, output = 20, nano = 500000000, premium = 1) => ({
  totalNanoAiu: nano, totalPremiumRequestCost: premium,
  modelMetrics: { model: { usage: { inputTokens: input, outputTokens: output, cacheReadTokens: 30, cacheWriteTokens: 50, reasoningTokens: 5 }, requests: { cost: 100 } } },
  agentMetrics: { main: { modelMetrics: { model: { usage: { inputTokens: input, outputTokens: output } } } } },
  lastCallInputTokens: input,
});

test("Copilot usage sums only model totals, preserving unknown metrics and not double-counting caches or reasoning", () => {
  assert.deepEqual(parseCopilotUsageReport(report()), { inputTokens: 100, outputTokens: 20, cacheReadTokens: 30, cacheWriteTokens: 50, nanoAiu: 500000000, premiumRequests: 1 });
  for (const raw of [null, {}, [], { totalNanoAiu: NaN, totalPremiumRequestCost: -1, modelMetrics: {} }]) assert.deepEqual(parseCopilotUsageReport(raw), EMPTY_COPILOT_USAGE);
  assert.equal(parseCopilotUsageReport({ totalPremiumRequestCost: 0 }).premiumRequests, 0);
  assert.deepEqual(parseCopilotUsageOutput('invalid\n{"type":"result","usage":{"premiumRequests":2}}\n{"type":"session.usage_checkpoint","data":{"totalNanoAiu":123}}'), { ...EMPTY_COPILOT_USAGE, premiumRequests: 2, nanoAiu: 123 });
  const multi = report();
  assert.equal(parseCopilotUsageReport({ ...multi, modelMetrics: { ...multi.modelMetrics, second: multi.modelMetrics.model } }).inputTokens, 200);
  assert.equal(parseCopilotUsageReport({ modelMetrics: { incomplete: { usage: { inputTokens: Infinity, outputTokens: -1 } } } }).inputTokens, null);
  const before = parseCopilotUsageReport(report());
  const after = parseCopilotUsageReport(report(180, 45, 600000000, 1.5));
  assert.deepEqual(copilotUsageDifference(after, before, false), { inputTokens: 80, outputTokens: 25, cacheReadTokens: 0, cacheWriteTokens: 0, nanoAiu: 100000000, premiumRequests: .5 });
  assert.deepEqual(copilotUsageDifference(after, undefined, false), EMPTY_COPILOT_USAGE);
  assert.deepEqual(copilotUsageDifference(before, after, false), { ...EMPTY_COPILOT_USAGE, cacheReadTokens: 0, cacheWriteTokens: 0 });
});

test("daily Copilot totals persist checkpoints, retries, unknown reports, and resumed sessions across midnight", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "papermotion-usage-test-"));
  const oldDirectory = process.env.GETIT_DATA_DIR;
  process.env.GETIT_DATA_DIR = directory;
  try {
    const { readUsage, recordCopilotUsage, recordUsage, normalizeUsage } = await import("../lib/usage-store");
    recordUsage("pi", normalizeUsage("pi", { input: 3, output: 4, cost: { total: .1 } }));
    recordCopilotUsage("first", parseCopilotUsageReport(report()), true);
    recordCopilotUsage("first", parseCopilotUsageReport(report(180, 45, 600000000, 1.5)), false);
    assert.equal(readUsage("copilot").totalTokens, 225);
    assert.equal(readUsage("copilot").copilot?.totals.premiumRequests, 1.5);
    assert.equal(readUsage("copilot").copilot?.attempts, 2);
    recordCopilotUsage("old-chat", parseCopilotUsageReport(report(900, 90)), false);
    assert.equal(readUsage("copilot").totalTokens, 225);
    assert.equal(readUsage("copilot").copilot?.reported.inputTokens, 2);
    recordCopilotUsage("missing", EMPTY_COPILOT_USAGE, true);
    assert.equal(readUsage("copilot").copilot?.attempts, 4);
    assert.equal(readUsage("copilot").copilot?.reported.inputTokens, 2);
    const file = path.join(directory, "usage.json");
    const saved = JSON.parse(await readFile(file, "utf8"));
    saved.copilot.day = "2000-01-01";
    await writeFile(file, JSON.stringify(saved));
    assert.equal(readUsage("copilot").totalTokens, 0);
    recordCopilotUsage("first", parseCopilotUsageReport(report(200, 50, 650000000, 2)), false);
    assert.equal(readUsage("copilot").totalTokens, 25);
    assert.equal(readUsage("copilot").copilot?.totals.nanoAiu, 50000000);
    assert.equal(readUsage("copilot").copilot?.totals.premiumRequests, .5);
    assert.equal(readUsage("pi").totalTokens, 7);
    assert.equal((await readFile(file, "utf8")).includes("prompt"), false);
  } finally {
    if (oldDirectory === undefined) delete process.env.GETIT_DATA_DIR;
    else process.env.GETIT_DATA_DIR = oldDirectory;
    await rm(directory, { recursive: true, force: true });
  }
});