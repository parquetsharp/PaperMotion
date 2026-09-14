import { z } from "zod";

const itemSchema = z.object({
  id: z.string().min(1).max(40),
  label: z.string().min(1).max(32),
  value: z.string().max(48),
  column: z.number().int().min(0).max(3),
  row: z.number().int().min(0).max(3),
  state: z.enum(["neutral", "active", "complete", "warning"]),
}).strict();

export const interactiveVizSchema = z.object({
  type: z.literal("interactive"),
  title: z.string().min(2).max(80),
  caption: z.string().min(5).max(280),
  code: z.array(z.string().max(160)).min(1).max(24),
  steps: z.array(z.object({
    title: z.string().min(2).max(80),
    explanation: z.string().min(5).max(800),
    line: z.number().int().min(0).max(24),
    variables: z.array(z.object({ name: z.string().min(1).max(40), value: z.string().max(120) }).strict()).max(12),
    items: z.array(itemSchema).min(1).max(16),
    links: z.array(z.object({ from: z.string().min(1).max(40), to: z.string().min(1).max(40), label: z.string().max(24) }).strict()).max(24),
  }).strict()).min(2).max(30),
}).strict();

export type InteractiveSpec = z.infer<typeof interactiveVizSchema>;

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
  return z.toJSONSchema(interactiveVizSchema);
}