import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { build } from "esbuild";
import { CopilotProvider } from "../lib/providers/copilot-provider";
import { buildVizPrompt } from "../lib/agents/viz";
import { interactiveJsonSchema, validateSimulationSpec, type InteractiveSpec, type SimulationSpec } from "../lib/interactive-viz";

async function main() {
  if (!process.argv.includes("--live")) throw new Error("Pass --live to authorize a synthetic request using your Copilot allowance.");
  const directory = await mkdtemp(path.join(tmpdir(), "papermotion-simulator-live-"));
  const browser = await chromium.launch({ headless: true });
  try {
    const prompt = buildVizPrompt({ type: "interactive", label: "Insertion sort", context: "Insertion sort maintains a sorted prefix, takes each next value and moves it left until the prefix is ordered. Expose a single input named values, kind number-array, defaultValue [3,1,2], range -100 to 100, integers, length 0 to 8. Compute ascending order for any valid array, including empty arrays and duplicates. The FINAL step must contain a variable with name result and value JSON.stringify(sortedValues). Do not mutate input.values. Do not add other inputs." });
    const generated = await new CopilotProvider({ directory }).runJson<SimulationSpec>(prompt, interactiveJsonSchema(), { signal: AbortSignal.timeout(180000) });
    const spec = validateSimulationSpec(generated.data);
    const compiled = await build({ stdin: { contents: 'import {runSimulation} from "./lib/simulation-runtime"; window.testSimulation=runSimulation;', resolveDir: process.cwd(), loader: "ts" }, bundle: true, write: false, format: "iife", platform: "browser" });
    const page = await browser.newPage();
    await page.route("https://simulation.example.test/", route => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Simulator test</title>" }));
    await page.goto("https://simulation.example.test/");
    await page.addScriptTag({ content: compiled.outputFiles[0].text });
    for (const values of [[4, 1, 3, 2], [2, 2, -1], [], [1, 2, 3]]) {
      const trace = await page.evaluate(({ spec, values }) => {
        const runner = window as unknown as { testSimulation: (spec: SimulationSpec, input: { values: number[] }) => Promise<InteractiveSpec> };
        return runner.testSimulation(spec, { values });
      }, { spec, values });
      const actual = JSON.parse(trace.steps.at(-1)!.variables.find(variable => variable.name === "result")!.value);
      assert.deepEqual(actual, [...values].sort((left, right) => left - right));
      console.log(`Generated simulator verified for ${JSON.stringify(values)}: ${trace.steps.length} computed steps.`);
    }
  } finally { await browser.close(); await rm(directory, { recursive: true, force: true }); }
}

main().catch(error => { console.error(error instanceof Error ? error.message : "Live simulation check failed."); process.exitCode = 1; });