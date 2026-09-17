import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
import { augmentedPath } from "./cli-runner";
import { copilotFailure, resolveCopilotBinary } from "./copilot-cli";

export type CopilotModel = { id: string; name: string; enabled: boolean };
type ErrorCode = "not_installed" | "unauthenticated" | "unsupported_cli" | "unavailable" | "timeout" | "invalid_response";
const messages: Record<ErrorCode, string> = {
  not_installed: "GitHub Copilot CLI not found. Install it through your approved software source or set COPILOT_CLI_PATH.",
  unauthenticated: "GitHub Copilot is not signed in. Run copilot login, then refresh the model list.",
  unsupported_cli: "This Copilot CLI does not support model discovery. Update it through your approved software source.",
  unavailable: "Copilot model discovery failed. Check your CLI connection and account access, then refresh.",
  timeout: "Copilot model discovery timed out. Refresh to try again.",
  invalid_response: "Copilot returned an invalid model list. Refresh or update your CLI through your approved software source.",
};

export class CopilotModelsError extends Error {
  constructor(readonly code: ErrorCode) { super(messages[code]); }
}

const catalogSchema = z.object({ models: z.array(z.object({
  id: z.string().min(1).max(128).regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/),
  name: z.string().min(1).max(200),
  policy: z.object({ state: z.string().min(1).max(40) }).optional(),
})).max(256) });

export function parseCopilotModels(value: unknown): CopilotModel[] {
  const parsed = catalogSchema.safeParse(value);
  if (!parsed.success) throw new CopilotModelsError("invalid_response");
  const models = new Map<string, CopilotModel>();
  for (const model of parsed.data.models) {
    const enabled = model.policy === undefined || model.policy.state === "enabled";
    models.set(model.id, { id: model.id, name: model.name, enabled: enabled && models.get(model.id)?.enabled !== false });
  }
  return [...models.values()];
}

class RpcError extends Error {
  constructor(readonly code: number, readonly detail: string) { super("Copilot metadata RPC failed."); }
}

type Options = { binary?: string; timeoutMs?: number; env?: NodeJS.ProcessEnv };

export async function discoverCopilotModels(options: Options = {}): Promise<CopilotModel[]> {
  const env = { ...(options.env ?? process.env), PATH: augmentedPath(), COPILOT_AUTO_UPDATE: "false", COPILOT_ALLOW_ALL: "false", GITHUB_COPILOT_PROMPT_MODE_REPO_HOOKS: "false", GITHUB_COPILOT_PROMPT_MODE_WORKSPACE_MCP: "false", GITHUB_COPILOT_PROMPT_MODE_EXTENSIONS: "false" };
  delete (env as NodeJS.ProcessEnv).NODE_DEBUG;
  const binary = options.binary ?? resolveCopilotBinary(env);
  if (!binary) throw new CopilotModelsError("not_installed");
  const directory = await mkdtemp(path.join(tmpdir(), "papermotion-models-"));
  const isScript = /\.[cm]?js$/i.test(binary);
  const args = ["--headless", "--stdio", "--no-auto-update", "--log-level", "none", "--available-tools=", "--deny-tool=read,write,shell,url,memory", "--disable-builtin-mcps", "--no-custom-instructions", "--no-remote-export"];
  const child = spawn(isScript ? process.execPath : binary, isScript ? [binary, ...args] : args, {
    cwd: directory, windowsHide: true, shell: false, stdio: ["pipe", "pipe", "pipe"],
    env: { ...env, ...(isScript ? { ELECTRON_RUN_AS_NODE: "1" } : {}) },
  });
  const closed = new Promise<void>(resolve => child.once("close", () => resolve()));
  const pending = new Map<number, { resolve: (result: unknown) => void; reject: (error: Error) => void }>();
  let sequence = 0;
  let buffer: Buffer = Buffer.alloc(0);
  let stderr = "";
  let failure: Error | undefined;
  const fail = (error: Error) => {
    failure ??= error;
    for (const request of pending.values()) request.reject(failure);
    pending.clear();
  };
  const send = (message: object) => {
    const body = JSON.stringify(message);
    child.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
  };
  const request = (method: string): Promise<unknown> => new Promise((resolve, reject) => {
    if (failure) { reject(failure); return; }
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    send({ jsonrpc: "2.0", id, method, params: {} });
  });
  const deadline = setTimeout(() => { fail(new CopilotModelsError("timeout")); child.kill(); }, options.timeoutMs ?? 30000);
  child.on("error", () => fail(new CopilotModelsError("unavailable")));
  child.on("close", () => fail(new CopilotModelsError(/unknown option|unrecognized option/i.test(stderr) ? "unsupported_cli" : "unavailable")));
  child.stdin.on("error", () => fail(new CopilotModelsError("unavailable")));
  child.stderr.on("data", chunk => { stderr = (stderr + chunk.toString()).slice(-8192); });
  child.stdout.on("data", chunk => {
    try {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length > 4_000_000) throw new CopilotModelsError("invalid_response");
      while (buffer.length) {
        const end = buffer.indexOf("\r\n\r\n");
        if (end < 0) {
          if (buffer.length > 8192) throw new CopilotModelsError("invalid_response");
          return;
        }
        const lengths = [...buffer.subarray(0, end).toString().matchAll(/^Content-Length: *(\d+)\r?$/gim)];
        if (lengths.length !== 1) throw new CopilotModelsError("invalid_response");
        const length = Number(lengths[0][1]);
        if (!Number.isSafeInteger(length) || length < 1 || length > 4_000_000) throw new CopilotModelsError("invalid_response");
        if (buffer.length < end + 4 + length) return;
        const message = JSON.parse(buffer.subarray(end + 4, end + 4 + length).toString());
        buffer = buffer.subarray(end + 4 + length);
        if (!message || typeof message !== "object" || message.jsonrpc !== "2.0") throw new CopilotModelsError("invalid_response");
        if (typeof message.method === "string") {
          if (message.id !== undefined) send({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Metadata-only client does not execute tools." } });
          continue;
        }
        const waiting = pending.get(message.id);
        if (!waiting) continue;
        pending.delete(message.id);
        if (message.error) waiting.reject(new RpcError(Number(message.error.code), typeof message.error.message === "string" ? message.error.message : ""));
        else waiting.resolve(message.result);
      }
    } catch {
      fail(new CopilotModelsError("invalid_response"));
      child.kill();
    }
  });
  try {
    let handshake: unknown;
    try { handshake = await request("connect"); }
    catch (error) {
      if (!(error instanceof RpcError) || error.code !== -32601) throw error;
      handshake = await request("ping");
    }
    if (!z.object({ protocolVersion: z.number().int().min(3) }).safeParse(handshake).success) throw new CopilotModelsError("unsupported_cli");
    const auth = z.object({ isAuthenticated: z.boolean() }).safeParse(await request("auth.getStatus"));
    if (!auth.success) throw new CopilotModelsError("invalid_response");
    if (!auth.data.isAuthenticated) throw new CopilotModelsError("unauthenticated");
    return parseCopilotModels(await request("models.list"));
  } catch (error) {
    if (error instanceof CopilotModelsError) throw error;
    if (error instanceof RpcError) {
      if (error.code === -32601) throw new CopilotModelsError("unsupported_cli");
      if (copilotFailure(error.detail).kind === "auth_lost") throw new CopilotModelsError("unauthenticated");
    }
    throw new CopilotModelsError("unavailable");
  } finally {
    clearTimeout(deadline);
    child.stdin.end();
    child.kill();
    await closed;
    await rm(directory, { recursive: true, force: true });
  }
}

let inFlight: Promise<CopilotModel[]> | undefined;
export function listCopilotModels(): Promise<CopilotModel[]> {
  inFlight ??= discoverCopilotModels().finally(() => { inFlight = undefined; });
  return inFlight;
}