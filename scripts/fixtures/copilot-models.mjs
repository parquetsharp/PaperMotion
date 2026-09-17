import assert from "node:assert/strict";

const scenario = process.env.COPILOT_MODELS_TEST;
assert.ok(process.argv.includes("--available-tools="));
assert.ok(process.argv.includes("--no-auto-update"));
assert.ok(process.argv.includes("--no-custom-instructions"));
assert.ok(process.argv.includes("--disable-builtin-mcps"));
assert.ok(process.cwd().includes("papermotion-models-"));
assert.equal(process.env.COPILOT_ALLOW_ALL, "false");
let buffer = Buffer.alloc(0);
const methods = [];
function reply(message) {
  const body = JSON.stringify(message);
  const packet = Buffer.from(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
  for (let offset = 0; offset < packet.length; offset += 7) process.stdout.write(packet.subarray(offset, offset + 7));
}
process.stdin.on("data", chunk => {
  buffer = Buffer.concat([buffer, chunk]);
  const end = buffer.indexOf("\r\n\r\n");
  if (end < 0) return;
  const length = Number(/Content-Length: (\d+)/i.exec(buffer.subarray(0, end).toString())[1]);
  if (buffer.length < end + 4 + length) return;
  const request = JSON.parse(buffer.subarray(end + 4, end + 4 + length).toString());
  buffer = buffer.subarray(end + 4 + length);
  methods.push(request.method);
  if (scenario === "timeout") return;
  if (scenario === "exit") process.exit(1);
  if (scenario === "unsupported") { process.stderr.write("unknown option --headless private-token"); process.exit(1); }
  if (scenario === "bad-header") { process.stdout.write("Content-Length: 999999999\r\n\r\n"); return; }
  if (scenario === "bad-json") { process.stdout.write("Content-Length: 1\r\n\r\n{"); return; }
  let result;
  if (request.method === "connect" && scenario === "legacy") {
    reply({ jsonrpc: "2.0", id: request.id, error: { code: -32601, message: "Method not found" } });
    return;
  }
  if (["connect", "ping"].includes(request.method)) result = { protocolVersion: 3 };
  else if (request.method === "auth.getStatus") result = { isAuthenticated: scenario !== "signed-out", token: "private-token" };
  else if (request.method === "models.list") {
    assert.deepEqual(methods, scenario === "legacy" ? ["connect", "ping", "auth.getStatus", "models.list"] : ["connect", "auth.getStatus", "models.list"]);
    if (scenario === "error") {
      reply({ jsonrpc: "2.0", id: request.id, error: { code: -32603, message: "403 private-token policy" } });
      return;
    }
    result = scenario === "invalid" ? { models: null } : { models: [
      { id: "auto", name: "Auto" },
      { id: "account-model", name: "Account model \u00e9", policy: { state: "enabled", terms: "private" }, token: "private-token" },
      { id: "blocked-model", name: "Blocked model", policy: { state: "disabled" } },
    ] };
  } else throw new Error("Unexpected method: " + request.method);
  reply({ jsonrpc: "2.0", id: request.id, result });
});