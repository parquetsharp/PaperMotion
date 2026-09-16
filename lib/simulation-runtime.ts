import { validateInteractiveSpec, type InteractiveSpec, type SimulationInputs, type SimulationSpec } from "./interactive-viz";

export const SIMULATION_WORKER_SOURCE = `
"use strict";
self.onmessage = function(event) {
  const send = self.postMessage.bind(self);
  const encode = JSON.stringify;
  const decode = JSON.parse;
  const steps = [];
  let bytes = 0;
  let exceeded = false;
  const emit = function(step) {
    if (steps.length >= 500) { exceeded = true; throw new Error("Simulation exceeded 500 steps. Use smaller inputs."); }
    const snapshot = encode(step);
    if (typeof snapshot !== "string" || snapshot.length > 20000 || bytes + snapshot.length > 1000000) {
      exceeded = true;
      throw new Error("Simulation trace is too large. Use smaller inputs.");
    }
    bytes += snapshot.length;
    steps.push(decode(snapshot));
  };
  try {
    const run = new Function("input", "emit", '"use strict";\\n' + event.data.code);
    const result = run(event.data.input, emit);
    if (result && typeof result.then === "function") throw new Error("Simulation must run synchronously.");
    if (exceeded) throw new Error("Simulation exceeded its trace limit. Use smaller inputs.");
    if (!steps.length) throw new Error("Simulation produced no steps.");
    send({ ok: true, steps: steps });
  } catch (error) {
    send({ ok: false, error: String(error && error.message || "Simulation failed.").slice(0, 300) });
  }
};
`;

const FRAME_SCRIPT = `
"use strict";
let worker;
let timer;
addEventListener("message", function(event) {
  if (event.source !== parent || event.data.channel !== "papermotion-simulator") return;
  if (worker) worker.terminate();
  clearTimeout(timer);
  if (event.data.stop) return;
  const id = event.data.id;
  const send = function(result) {
    clearTimeout(timer);
    worker.terminate();
    parent.postMessage({ channel: "papermotion-simulator", id: id, result: result }, "*");
  };
  const url = URL.createObjectURL(new Blob([${JSON.stringify(SIMULATION_WORKER_SOURCE)}], {type: "text/javascript"}));
  worker = new Worker(url);
  URL.revokeObjectURL(url);
  worker.onmessage = function(reply) { send(reply.data); };
  worker.onerror = function() { send({ ok: false, error: "Simulation worker failed." }); };
  timer = setTimeout(function() { send({ ok: false, error: "Simulation exceeded its time limit. Use smaller inputs or revise the algorithm." }); }, 1500);
  worker.postMessage({code: event.data.code, input: event.data.input});
});
`;

export const SIMULATION_FRAME_HTML = `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; worker-src blob:; connect-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'"></head><body><script>${FRAME_SCRIPT.replace(/<\/script/gi, "<\\/script")}</script></body></html>`;

export async function runSimulation(spec: SimulationSpec, input: SimulationInputs, signal?: AbortSignal): Promise<InteractiveSpec> {
  signal?.throwIfAborted();
  const steps = await new Promise<unknown>((resolve, reject) => {
    const id = crypto.randomUUID();
    const frame = document.createElement("iframe");
    frame.setAttribute("sandbox", "allow-scripts");
    frame.setAttribute("aria-hidden", "true");
    frame.hidden = true;
    frame.srcdoc = SIMULATION_FRAME_HTML;
    const cleanup = () => {
      clearTimeout(timeout);
      window.removeEventListener("message", receive);
      signal?.removeEventListener("abort", abort);
      frame.contentWindow?.postMessage({ channel: "papermotion-simulator", stop: true }, "*");
      frame.remove();
    };
    const fail = (error: Error) => { cleanup(); reject(error); };
    const abort = () => fail(new DOMException("Simulation cancelled.", "AbortError"));
    const timeout = setTimeout(() => fail(new Error("Simulation exceeded its time limit. Use smaller inputs or revise the algorithm.")), 4000);
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.contentWindow || event.data?.channel !== "papermotion-simulator" || event.data?.id !== id) return;
      const result = event.data.result;
      cleanup();
      if (result?.ok === true) resolve(result.steps);
      else reject(new Error(typeof result?.error === "string" ? result.error.slice(0, 300) : "Simulation failed."));
    };
    window.addEventListener("message", receive);
    signal?.addEventListener("abort", abort, { once: true });
    frame.onload = () => frame.contentWindow?.postMessage({ channel: "papermotion-simulator", id, code: spec.simulation_code, input }, "*");
    document.body.appendChild(frame);
  });
  try {
    return validateInteractiveSpec({ type: "interactive", title: spec.title, caption: spec.caption, code: spec.code, steps });
  } catch {
    throw new Error("Simulation emitted an invalid diagram or code reference. Revise the simulator using feedback.");
  }
}