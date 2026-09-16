import assert from "node:assert/strict";
import { build } from "esbuild";

export async function checkSimulationSandbox(context, origin) {
  const compiled = await build({ stdin: { contents: 'import {runSimulation} from "./lib/simulation-runtime"; window.testSimulation=runSimulation;', resolveDir: process.cwd(), loader: "ts" }, bundle: true, write: false, format: "iife", platform: "browser" });
  const page = await context.newPage();
  await page.goto(origin);
  await page.addScriptTag({ content: compiled.outputFiles[0].text });
  const step = { title: "Result", explanation: "Computed execution state.", line: 1, variables: [], items: [{ id: "result", label: "Result", value: "1", row: 0, column: 0, state: "complete" }], links: [] };
  const definition = { type: "interactive", mode: "simulation", title: "Test algorithm", caption: "Execute in an isolated worker.", code: ["compute(input)"], inputs: [], simulation_code: "" };
  const execute = (code, cancel = false) => page.evaluate(async ({ definition, code, cancel }) => {
    const controller = new AbortController();
    const result = window.testSimulation({ ...definition, simulation_code: code }, {}, controller.signal);
    if (cancel) controller.abort();
    try { return { ok: true, trace: await result }; }
    catch (error) { return { ok: false, error: error.message }; }
  }, { definition, code, cancel });

  assert.match((await execute("while(true){}" )).error, /time limit/);
  assert.match((await execute("while(true){}", true)).error, /cancelled/);
  assert.equal((await execute(`emit(${JSON.stringify(step)});`)).ok, true, "A valid run succeeds after timeout and cancellation.");
  assert.match((await execute('emit({title:"Broken"});')).error, /invalid diagram/);
  const forbiddenUrl = "https://simulation-network-test.invalid/probe";
  let networkRequests = 0;
  await context.route(forbiddenUrl, route => { networkRequests++; return route.fulfill({ body: "blocked test" }); });
  const noNetwork = await execute(`try { importScripts(${JSON.stringify(forbiddenUrl)}); } catch {} emit(${JSON.stringify(step)});`);
  assert.equal(noNetwork.ok, true);
  assert.equal(networkRequests, 0, "CSP blocks worker network imports before any request.");
  await page.evaluate(() => localStorage.setItem("simulation-isolation-marker", "private"));
  const isolation = await execute(`const step=${JSON.stringify(step)}; step.items[0].value=typeof document+','+typeof localStorage+','+typeof parent; emit(step);`);
  assert.equal(isolation.trace.steps[0].items[0].value, "undefined,undefined,undefined");
  const indexed = await execute(`const step=${JSON.stringify(step)}; try{indexedDB.open('simulation-storage-test');step.items[0].value='opened';}catch(error){step.items[0].value=error.name;}emit(step);`);
  assert.equal(indexed.trace.steps[0].items[0].value, "SecurityError", "Opaque worker origin cannot access browser storage.");
  assert.equal(await page.locator('iframe[sandbox]').count(), 0, "All run frames are cleaned up.");
  await page.close();
  console.log("Simulator timeout, cancellation, recovery, trace validation, network blocking, and storage isolation passed.");
}