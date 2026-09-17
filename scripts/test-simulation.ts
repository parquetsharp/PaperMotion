import assert from "node:assert/strict";
import { test } from "node:test";
import { parseSimulationInputs, validateSimulationSpec, type SimulationSpec } from "../lib/interactive-viz";
import { Worker } from "node:worker_threads";
import { SIMULATION_WORKER_SOURCE, SIMULATION_FRAME_HTML } from "../lib/simulation-runtime";

const field = { name: "values", label: "Values", kind: "number-array" as const, defaultValue: "[3,1,2]", minimum: -100, maximum: 100, integer: true, minItems: 0, maxItems: 16, options: [] };
const spec: SimulationSpec = { type: "interactive", mode: "simulation", title: "Sorting", caption: "Sort the supplied values in ascending order.", code: ["sort(values)"], inputs: [field], simulation_code: "const values = input.values.slice();" };

test("simulator inputs parse editable values and reject invalid or oversized data", () => {
  assert.deepEqual(parseSimulationInputs(spec, { values: "[9,0,-2]" }).values, [9, 0, -2]);
  assert.deepEqual(parseSimulationInputs(spec, { values: "[]" }).values, []);
  for (const values of ["", "1,2", "null", "[1.5]", "[101]", JSON.stringify(Array(17).fill(1))]) assert.throws(() => parseSimulationInputs(spec, { values }));
  assert.equal(validateSimulationSpec(spec).mode, "simulation");
  assert.throws(() => validateSimulationSpec({ ...spec, inputs: [field, field] }), /unique/);
  assert.throws(() => validateSimulationSpec({ ...spec, inputs: [{ ...field, defaultValue: "[200]" }] }));
});

test("simulators validate scalar, switch and choice controls", () => {
  const mixed: SimulationSpec = { ...spec, inputs: [
    { ...field, name: "target", kind: "number", defaultValue: "2" },
    { ...field, name: "descending", kind: "boolean", defaultValue: "false" },
    { ...field, name: "policy", kind: "choice", defaultValue: "fifo", options: ["fifo", "lru"] },
  ] };
  assert.equal(validateSimulationSpec(mixed).inputs.length, 3);
  assert.deepEqual({ ...parseSimulationInputs(mixed, { target: "8", descending: "true", policy: "lru" }) }, { target: 8, descending: true, policy: "lru" });
  assert.throws(() => parseSimulationInputs(mixed, { target: "8", descending: "false", policy: "random" }));
});

async function execute(code: string, input: object) {
  const worker = new Worker(`const {parentPort}=require('node:worker_threads');globalThis.self={postMessage:message=>parentPort.postMessage(message)};${SIMULATION_WORKER_SOURCE};parentPort.on('message',data=>self.onmessage({data}));`, { eval: true });
  try {
    return await new Promise<{ ok: boolean; steps?: Array<{ value: number[] }>; error?: string }>((resolve, reject) => {
      worker.once("message", resolve); worker.once("error", reject); worker.postMessage({ code, input });
    });
  } finally { await worker.terminate(); }
}

test("worker computes new states from inputs and snapshots mutable arrays", async () => {
  const code = "const values = input.values.slice(); emit({value:values}); for(let index=1;index<values.length;index++){let position=index;while(position>0 && values[position-1]>values[position]){[values[position-1],values[position]]=[values[position],values[position-1]];position--;emit({value:values});}}emit({value:values});";
  const first = await execute(code, { values: [3, 1, 2] });
  const second = await execute(code, { values: [8, 0] });
  assert.deepEqual(first.steps?.[0].value, [3, 1, 2]);
  assert.deepEqual(first.steps?.at(-1)?.value, [1, 2, 3]);
  assert.deepEqual(second.steps?.at(-1)?.value, [0, 8]);
  assert.notEqual(first.steps?.length, second.steps?.length);
});

test("worker fails closed for empty traces and exceeded output budgets", async () => {
  assert.equal((await execute("return;", {})).ok, false);
  assert.match((await execute("for(let index=0;index<501;index++)emit({value:index});", {})).error ?? "", /500 steps/);
  assert.equal((await execute("try{for(let index=0;index<501;index++)emit({});}catch{}", {})).ok, false);
  assert.equal((await execute("emit({value:'x'.repeat(20001)});", {})).ok, false);
  assert.match(SIMULATION_FRAME_HTML, /connect-src 'none'/);
  assert.match(SIMULATION_FRAME_HTML, /frame-src 'none'/);
});