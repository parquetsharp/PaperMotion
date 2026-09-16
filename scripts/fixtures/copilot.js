async function main() {
  const { default: assert } = await import("node:assert/strict");
  const fs = await import("node:fs/promises");
  const args = process.argv.slice(2);
  if (args.includes("--headless")) {
    await import("./copilot-models.mjs");
    return;
  }
  assert.ok(!args.some(value => value === "-p" || value === "--prompt" || value.startsWith("--prompt=")), "Copilot ignores stdin when an explicit prompt is present.");
  assert.ok(args.includes("--available-tools="));
  assert.ok(args.includes("--no-auto-update"));
  assert.ok(args.includes("--no-custom-instructions"));
  assert.equal(args[args.indexOf("--output-format") + 1], "json");
  assert.ok(!args.includes("--allow-all-tools"));
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const prompt = Buffer.concat(chunks).toString("utf8");
  const schema = JSON.parse(prompt.split("\n")[1]);
  let history = [];
  if (args.some(value => value.startsWith("--resume="))) history = JSON.parse(await fs.readFile("fixture-session.json", "utf8"));
  history.push(prompt);
  if (schema.properties?.type?.const === "2d-text") {
    assert.match(prompt, /No tools are available/);
    assert.match(prompt, /Web search is unavailable/);
    if (history.length === 1) {
      assert.match(prompt, /SOURCE PAGE 1:/);
      assert.match(prompt, /Mass measures inertia/);
      await fs.writeFile("fixture-session.json", JSON.stringify(history));
      process.stdout.write(JSON.stringify({ type: "assistant.message", data: { content: "", toolRequests: [{ name: "web_search", arguments: {} }] } }) + "\n");
      process.stdout.write(JSON.stringify({ type: "result" }) + "\n");
      return;
    }
    assert.equal(history.length, 2);
    assert.match(prompt, /Answer from the supplied context without tools/);
  }
  const endpoint = new URL(process.env.PAPERMOTION_COPILOT_FIXTURE_URL);
  assert.equal(endpoint.hostname, "127.0.0.1");
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input: [{ content: `Schema\n${JSON.stringify(schema)}` }, { content: history.join("\n") }] }),
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  await fs.writeFile("fixture-session.json", JSON.stringify(history));
  let content = result.output[0].content[0].text;
  if (schema.properties?.nodes) {
    if (history.length === 1) {
      content = JSON.stringify({ ...JSON.parse(content), globalNote: "An overlong graph overview that needs shortening. ".repeat(20) });
    } else {
      assert.match(prompt, /globalNote: too_big \(maximum 600\)/);
    }
  }
  process.stdout.write(JSON.stringify({ type: "assistant.message", data: { content, toolRequests: [] } }) + "\n");
  process.stdout.write(JSON.stringify({ type: "result" }) + "\n");
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });