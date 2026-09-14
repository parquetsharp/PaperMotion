import fs from "node:fs";
import path from "node:path";
import { fromJSONSchema } from "zod";
import { CodexError } from "../codex-errors";

export const COPILOT_SETUP_URL = "https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/install-copilot-cli";

export function resolveCopilotBinary(env: Record<string, string | undefined> = process.env): string | null {
  const usable = (candidate: string) => {
    if (/[\\/]github\.copilot-chat[\\/]copilotCli[\\/]/i.test(candidate) || /\.(ps1|cmd|bat)$/i.test(candidate)) return false;
    try { return fs.statSync(candidate).isFile(); } catch { return false; }
  };
  if (env.COPILOT_CLI_PATH) return usable(env.COPILOT_CLI_PATH) ? env.COPILOT_CLI_PATH : null;
  for (const directory of (env.PATH ?? env.Path ?? "").split(path.delimiter).filter(Boolean)) {
    const executable = path.join(directory.replace(/^"|"$/g, ""), process.platform === "win32" ? "copilot.exe" : "copilot");
    if (usable(executable)) return executable;
    const packageDir = path.join(directory, "node_modules", "@github", "copilot");
    try {
      const manifest = JSON.parse(fs.readFileSync(path.join(packageDir, "package.json"), "utf8"));
      const entry = typeof manifest.bin === "string" ? manifest.bin : manifest.bin?.copilot;
      if (manifest.name === "@github/copilot" && typeof entry === "string") {
        const candidate = path.resolve(packageDir, entry);
        if (usable(candidate)) return candidate;
      }
    } catch {}
  }
  return null;
}

export function copilotArguments(model: string, sessionId: string, resume = false): string[] {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(sessionId)) throw new Error("Invalid Copilot session ID.");
  return [
    "--model", model || "auto",
    resume ? `--resume=${sessionId}` : `--session-id=${sessionId}`,
    "--output-format", "json", "--silent", "--stream", "off", "--no-color", "--no-auto-update",
    "--available-tools=", "--deny-tool=read,write,shell,url,memory",
    "--disable-builtin-mcps", "--no-ask-user", "--no-custom-instructions",
    "--no-remote-export", "--log-level", "none",
  ];
}

export function copilotFailure(message: string): CodexError {
  if (/not logged|not authenticated|authentication|unauthorized|\b401\b|login required|sign.?in/i.test(message)) {
    return new CodexError("auth_lost", "GitHub Copilot is not logged in. Run copilot login in your terminal, then retry. Your GitHub account must have Copilot CLI access.");
  }
  if (/rate.limit|quota|\b429\b|premium requests|credits.*exhaust/i.test(message)) return new CodexError("rate_limit", "GitHub Copilot's usage limit was reached. Check your Copilot plan and retry when capacity is available.");
  if (/policy|organization|forbidden|\b403\b|subscription|entitlement/i.test(message)) return new CodexError("generic", "GitHub Copilot access was denied. Check your subscription and organization policy; contact your administrator if access is managed.");
  if (/unknown option|unrecognized option/i.test(message)) return new CodexError("generic", "This Copilot CLI version does not support the required options. Update it through your organization's approved installation process.");
  return new CodexError("generic", "GitHub Copilot could not complete the request. Check your CLI connection and selected model, then retry.");
}

export class CopilotFormatError extends CodexError {
  constructor(readonly issues: string[]) {
    super("generic", `GitHub Copilot returned JSON that does not match the requested study format: ${issues.join("; ")}. Retry the study request.`);
  }
}

export function parseCopilotResponse<T>(text: string, schema?: object): T {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let result: unknown;
  try {
    result = JSON.parse(cleaned);
    if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error("Not an object");
  } catch {
    throw new CodexError("generic", "GitHub Copilot returned invalid or incomplete JSON. Retry the study request.");
  }
  if (schema) {
    const validated = fromJSONSchema(schema as Parameters<typeof fromJSONSchema>[0]).safeParse(result);
    if (!validated.success) {
      const issues = validated.error.issues.slice(0, 8).map(issue => {
        const field = issue.path.map(part => String(part).replace(/[^a-z0-9_-]/gi, "").slice(0, 60)).join(".") || "response";
        const bound = "maximum" in issue ? ` (maximum ${issue.maximum})`
          : "minimum" in issue ? ` (minimum ${issue.minimum})` : "";
        return `${field}: ${issue.code}${bound}`;
      });
      throw new CopilotFormatError(issues);
    }
  }
  return result as T;
}

export function parseCopilotOutput<T>(stdout: string, schema: object): T {
  type Event = {
    type?: string;
    is_error?: boolean;
    isError?: boolean;
    subtype?: string;
    data?: { content?: string; toolRequests?: unknown[] };
  };
  let events: Event[];
  try {
    events = stdout.split(/\r?\n/).filter(line => line.trim()).map(line => JSON.parse(line));
    if (events.some(event => !event || typeof event !== "object")) throw new Error("Invalid event");
  } catch {
    throw new CodexError("generic", "GitHub Copilot returned an unreadable response stream. Retry the study request.");
  }
  if (events.some(event => event.type === "session.error" || event.type === "error" || event.is_error || event.isError || event.subtype?.startsWith("error"))) {
    throw new CodexError("generic", "GitHub Copilot reported an error while generating the study response. Retry the study request.");
  }
  const messages = events.filter(event => event.type === "assistant.message");
  if (messages.some(event => event.data?.toolRequests?.length)) {
    throw new CodexError("generic", "GitHub Copilot requested tools instead of returning the study response. Retry the study request.");
  }
  const content = messages.at(-1)?.data?.content;
  if (!events.some(event => event.type === "result") || typeof content !== "string") {
    throw new CodexError("generic", "GitHub Copilot did not complete the study response. Retry the study request.");
  }
  return parseCopilotResponse<T>(content, schema);
}