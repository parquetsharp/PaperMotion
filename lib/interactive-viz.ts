import { z } from "zod";

const itemSchema = z.object({
  id: z.string().min(1).max(40),
  label: z.string().min(1).max(32),
  value: z.string().max(48),
  column: z.number().int().min(0).max(3),
  row: z.number().int().min(0).max(3),
  state: z.enum(["neutral", "active", "complete", "warning"]),
}).strict();

export const interactiveStepSchema = z.object({
  title: z.string().min(2).max(80),
  explanation: z.string().min(5).max(800),
  line: z.number().int().min(0).max(24),
  variables: z.array(z.object({ name: z.string().min(1).max(40), value: z.string().max(120) }).strict()).max(12),
  items: z.array(itemSchema).min(1).max(16),
  links: z.array(z.object({ from: z.string().min(1).max(40), to: z.string().min(1).max(40), label: z.string().max(24) }).strict()).max(24),
}).strict();

export const interactiveVizSchema = z.object({
  type: z.literal("interactive"),
  title: z.string().min(2).max(80),
  caption: z.string().min(5).max(280),
  code: z.array(z.string().max(160)).min(1).max(24),
  steps: z.array(interactiveStepSchema).min(1).max(500),
}).strict();

export type InteractiveSpec = z.infer<typeof interactiveVizSchema> & { evidence?: import("./evidence-types").VisualizationEvidence };

export const simulationSchema = z.object({
  type: z.literal("interactive"),
  mode: z.literal("simulation"),
  title: z.string().min(2).max(80),
  caption: z.string().min(5).max(280),
  code: z.array(z.string().max(160)).min(1).max(24),
  inputs: z.array(z.object({
    name: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,31}$/),
    label: z.string().min(1).max(60),
    kind: z.enum(["number", "number-array", "boolean", "choice"]),
    defaultValue: z.string().min(1).max(1000),
    minimum: z.number().min(-1000000).max(1000000),
    maximum: z.number().min(-1000000).max(1000000),
    integer: z.boolean(),
    minItems: z.number().int().min(0).max(64),
    maxItems: z.number().int().min(1).max(64),
    options: z.array(z.string().min(1).max(60)).max(12),
  }).strict()).min(1).max(8),
  simulation_code: z.string().min(20).max(32000),
}).strict();

export type SimulationSpec = z.infer<typeof simulationSchema> & { evidence?: import("./evidence-types").VisualizationEvidence };
export type SimulationInputs = Record<string, number | number[] | boolean | string>;

export function parseSimulationInputs(spec: SimulationSpec, drafts: Record<string, string>): SimulationInputs {
  const values: SimulationInputs = Object.create(null);
  for (const field of spec.inputs) {
    const text = drafts[field.name]?.trim() ?? "";
    const fail = (reason: string): never => { throw new Error(`${field.label}: ${reason}`); };
    if (field.kind === "boolean") {
      if (text !== "true" && text !== "false") fail("select true or false.");
      values[field.name] = text === "true";
    } else if (field.kind === "choice") {
      if (!field.options.includes(text)) fail("select an available option.");
      values[field.name] = text;
    } else {
      let value: unknown;
      try { value = JSON.parse(text); } catch { fail(field.kind === "number-array" ? "enter a JSON array, such as [3, 1, 2]." : "enter a number."); }
      const validNumber = (item: unknown): item is number => typeof item === "number" && Number.isFinite(item) && item >= field.minimum && item <= field.maximum && (!field.integer || Number.isInteger(item));
      if (field.kind === "number") {
        if (!validNumber(value)) fail(`enter ${field.integer ? "an integer" : "a number"} between ${field.minimum} and ${field.maximum}.`);
        values[field.name] = value as number;
      } else {
        if (!Array.isArray(value) || value.length < field.minItems || value.length > field.maxItems || !value.every(validNumber)) fail(`enter ${field.minItems}-${field.maxItems} ${field.integer ? "integers" : "numbers"} between ${field.minimum} and ${field.maximum}.`);
        values[field.name] = value as number[];
      }
    }
  }
  return values;
}

export function validateSimulationSpec(value: unknown): SimulationSpec {
  const spec = simulationSchema.parse(value);
  const names = new Set(spec.inputs.map(field => field.name));
  if (names.size !== spec.inputs.length || names.has("constructor") || names.has("prototype")) throw new Error("Simulator inputs must have unique safe names.");
  for (const field of spec.inputs) {
    if (field.minimum > field.maximum || field.minItems > field.maxItems) throw new Error("Simulator input bounds are reversed.");
    if (field.kind === "choice" && (!field.options.length || new Set(field.options).size !== field.options.length)) throw new Error("Simulator choices must be nonempty and unique.");
  }
  parseSimulationInputs(spec, Object.fromEntries(spec.inputs.map(field => [field.name, field.defaultValue])));
  return spec;
}

export function validateInteractiveSpec(value: unknown): InteractiveSpec {
  const spec = interactiveVizSchema.parse(value);
  for (const step of spec.steps) {
    if (step.line > spec.code.length) throw new Error("Interactive step references a missing code line.");
    const ids = new Set(step.items.map(item => item.id));
    const cells = new Set(step.items.map(item => `${item.row}:${item.column}`));
    if (ids.size !== step.items.length || cells.size !== step.items.length) throw new Error("Interactive diagram items must have unique IDs and grid positions.");
    if (step.links.some(link => !ids.has(link.from) || !ids.has(link.to))) throw new Error("Interactive diagram link references a missing item.");
  }
  return spec;
}

export function interactiveJsonSchema(): object {
  return z.toJSONSchema(simulationSchema);
}