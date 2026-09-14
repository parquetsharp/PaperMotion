import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { AIProvider, RunOptions, RunJsonInThreadResult } from "../provider-types";
import { loadSettings } from "../settings-store";
import { DATA_DIR } from "../paths";
import { CodexError } from "../codex-errors";
import { runCliBinary } from "./cli-runner";
import { CopilotFormatError, copilotArguments, copilotFailure, parseCopilotOutput, resolveCopilotBinary } from "./copilot-cli";

type Options = {
  directory?: string;
  run?: typeof runCliBinary;
  resolveBinary?: typeof resolveCopilotBinary;
  settings?: () => { copilotModelFast?: string; copilotModelSmart?: string };
};

export class CopilotProvider implements AIProvider {
  readonly name = "copilot" as const;
  private readonly directory: string;
  private readonly run: typeof runCliBinary;
  private readonly resolveBinary: typeof resolveCopilotBinary;
  private readonly settings: NonNullable<Options["settings"]>;
  private readonly active = new Set<string>();

  constructor(options: Options = {}) {
    this.directory = options.directory ?? path.join(DATA_DIR, "copilot-sessions");
    this.run = options.run ?? runCliBinary;
    this.resolveBinary = options.resolveBinary ?? resolveCopilotBinary;
    this.settings = options.settings ?? loadSettings;
  }

  private async complete<T>(input: string, schema: object, sessionId: string, model: string, opts: RunOptions, resume = false, keepWorkspace = false) {
    opts.signal?.throwIfAborted();
    const binary = this.resolveBinary();
    if (!binary) throw new CodexError("binary_missing", "GitHub Copilot CLI not found. Install it through your approved software source, or set COPILOT_CLI_PATH to its executable. A VS Code installation launcher alone is not the CLI.");
    const cwd = path.join(this.directory, "work", sessionId);
    await fs.mkdir(cwd, { recursive: true });
    let succeeded = false;
    try {
      let request = `Return ONLY a JSON object matching this schema:\n${JSON.stringify(schema)}\n\nStudy request:\n${input}`;
      for (let attempt = 0; attempt < 2; attempt++) {
        opts.signal?.throwIfAborted();
        const result = await this.run(binary, copilotArguments(model, sessionId, resume || attempt > 0), {
          cwd,
          timeoutMs: 300000,
          signal: opts.signal,
          stdin: request,
          env: {
            COPILOT_AUTO_UPDATE: "false",
            COPILOT_ALLOW_ALL: "false",
            GITHUB_COPILOT_PROMPT_MODE_REPO_HOOKS: "false",
            GITHUB_COPILOT_PROMPT_MODE_WORKSPACE_MCP: "false",
            GITHUB_COPILOT_PROMPT_MODE_EXTENSIONS: "false",
          },
        });
        opts.signal?.throwIfAborted();
        if (result.exitCode !== 0) throw copilotFailure(result.stderr || result.stdout);
        try {
          const data = parseCopilotOutput<T>(result.stdout, schema);
          succeeded = true;
          return { data, usage: null };
        } catch (error) {
          if (!(error instanceof CopilotFormatError) || attempt > 0) throw error;
          request = `Return ONLY a JSON object matching this schema:\n${JSON.stringify(schema)}\n\nCorrect your previous response. Validation failures:\n${error.issues.join("\n")}\n\nReturn the complete corrected object, not a patch or an explanation. Preserve the graph and study facts. Shorten text where needed; string length limits count characters, not words. Check all required fields, types, array sizes, and length limits before responding.`;
        }
      }
      throw new CodexError("generic", "GitHub Copilot could not produce a valid study response.");
    } finally {
      if (!keepWorkspace || (!resume && !succeeded)) await fs.rm(cwd, { recursive: true, force: true });
    }
  }

  async runJson<T>(prompt: string, outputSchema: object, opts: RunOptions = {}) {
    return this.complete<T>(prompt, outputSchema, randomUUID(), this.settings().copilotModelFast || "auto", opts);
  }

  async runJsonInThread<T>(args: {
    outputSchema: object;
    opts?: RunOptions;
    resume?: { threadId: string; input: string };
    start?: { input: string };
  }): Promise<RunJsonInThreadResult<T>> {
    if (Boolean(args.start) === Boolean(args.resume)) throw new Error("Provide a new Copilot chat or a chat to resume.");
    const match = args.resume ? /^copilot-([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/.exec(args.resume.threadId) : null;
    if (args.resume && !match) throw new Error("This chat belongs to another provider. Start a new chat for GitHub Copilot.");
    const sessionId = match?.[1] ?? randomUUID();
    const marker = path.join(this.directory, `${sessionId}.json`);
    if (args.resume) {
      try {
        const record = JSON.parse(await fs.readFile(marker, "utf8"));
        if (record.sessionId !== sessionId) throw new Error("Invalid record");
      } catch {
        throw new Error("This Copilot chat is unavailable. Start a new chat.");
      }
    }
    if (this.active.has(sessionId)) throw new Error("This Copilot chat is already processing a message. Please wait and retry.");
    this.active.add(sessionId);
    try {
      const result = await this.complete<T>(args.resume?.input ?? args.start!.input, args.outputSchema, sessionId, this.settings().copilotModelSmart || "auto", args.opts ?? {}, !!args.resume, true);
      if (!args.resume) {
        await fs.mkdir(this.directory, { recursive: true });
        await fs.writeFile(marker, JSON.stringify({ sessionId }), { flag: "wx", mode: 0o600 });
      }
      return { ...result, threadId: `copilot-${sessionId}` };
    } finally {
      this.active.delete(sessionId);
    }
  }
}