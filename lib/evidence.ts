import { createHash } from "node:crypto";
import { z } from "zod";
import type { PdfPage } from "./pdf-extract";
import type { VizSpec } from "./schemas";
import type { EvidenceClaim, EvidencePassage, VisualizationEvidence, SourceProvenance } from "./evidence-types";

export type EvidenceSource = { docId: string; pages: Array<Pick<PdfPage, "pageIndex" | "text"> & Partial<Pick<PdfPage, "items" | "width" | "height">>>; provenance?: SourceProvenance; warnings?: string[] };

const proposalSchema = z.array(z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,40}$/),
  target: z.string().min(1).max(40),
  text: z.string().min(1).max(600),
  kind: z.enum(["stated", "derived", "assumption", "unsupported"]),
  rationale: z.string().max(800),
  dependencies: z.array(z.string().max(40)).max(12),
  sources: z.array(z.object({ page: z.number().int().positive(), quote: z.string().min(12).max(1200) }).strict()).max(3),
}).strict()).max(24);

export function evidenceGenerationSchema(schema: object): object {
  const base = schema as { required: string[]; properties: Record<string, unknown> };
  return { ...base, required: [...base.required, "evidence"], properties: { ...base.properties, evidence: z.toJSONSchema(proposalSchema, { target: "draft-7" }) } };
}

function normalized(value: string) {
  let text = "";
  const offsets: number[] = [];
  for (let index = 0; index < value.length; index++) {
    const char = value[index];
    if (/\s/.test(char)) {
      if (!text || text.endsWith(" ")) continue;
      text += " ";
    } else text += char;
    offsets.push(index);
  }
  if (text.endsWith(" ")) { text = text.slice(0, -1); offsets.pop(); }
  return { text, offsets };
}

export function resolveEvidencePassage(source: EvidenceSource, pageNumber: number, quote: string): { passage?: EvidencePassage; issue?: string } {
  const page = source.pages.find(item => item.pageIndex === pageNumber - 1);
  if (!page) return { issue: "The cited page was not supplied." };
  const haystack = normalized(page.text);
  const needle = normalized(quote).text;
  const match = haystack.text.indexOf(needle);
  if (!needle || match < 0) return { issue: "The quotation was not found in the supplied PDF text." };
  if (haystack.text.indexOf(needle, match + 1) >= 0) return { issue: "The quotation occurs more than once; its location is ambiguous." };
  const start = haystack.offsets[match];
  const end = haystack.offsets[match + needle.length - 1] + 1;
  let itemText = "";
  const ranges = (page.items ?? []).map(item => {
    const start = itemText.length;
    itemText += item.str;
    const end = itemText.length;
    itemText += item.eol ? "\n" : item.str ? " " : "";
    return { start, end, item };
  });
  const itemHaystack = normalized(itemText);
  const itemMatch = itemHaystack.text.indexOf(needle);
  const unique = itemMatch >= 0 && itemHaystack.text.indexOf(needle, itemMatch + 1) < 0;
  const rects = unique ? ranges.filter(range => range.end > itemHaystack.offsets[itemMatch] && range.start <= itemHaystack.offsets[itemMatch + needle.length - 1]).map(({ item }) => ({ x: item.x, y: item.y, width: item.width, height: item.height })).filter(rect => Object.values(rect).every(Number.isFinite) && rect.width > 0 && rect.height > 0) : [];
  return { passage: { page: page.pageIndex, quote: page.text.slice(start, end), start, end, pageHash: createHash("sha256").update(page.text).digest("hex"), rects } };
}

export function evidenceTargets(spec: VizSpec): Set<string> {
  if (spec.type === "formula") return new Set(["main_latex", ...spec.steps.map((_, index) => `step:${index + 1}`)]);
  if (spec.type === "2d-text") return new Set(spec.body_markdown.split(/\n\s*\n/).map((_, index) => `paragraph:${index + 1}`));
  if (spec.type === "interactive") return new Set(spec.code.map((_, index) => `code:${index + 1}`));
  return new Set();
}

export function validateVisualizationEvidence(proposal: unknown, spec: VizSpec, source: EvidenceSource): VisualizationEvidence {
  const parsed = proposalSchema.safeParse(proposal);
  if (!parsed.success) throw new Error("Generated evidence does not match its required format.");
  const ids = new Set(parsed.data.map(claim => claim.id));
  if (ids.size !== parsed.data.length) throw new Error("Evidence claim IDs must be unique.");
  const targets = evidenceTargets(spec);
  const omitted = new Set(parsed.data.filter(claim => !targets.has(claim.target)).map(claim => claim.id));
  let changed = true;
  while (changed) {
    changed = false;
    for (const claim of parsed.data) {
      if (!omitted.has(claim.id) && claim.dependencies.some(id => omitted.has(id))) {
        omitted.add(claim.id);
        changed = true;
      }
    }
  }
  const claims: EvidenceClaim[] = parsed.data.filter(claim => !omitted.has(claim.id)).map(claim => {
    if (claim.dependencies.some(id => !ids.has(id) || id === claim.id)) throw new Error("Evidence has an invalid claim dependency.");
    const resolved = claim.sources.map(item => resolveEvidencePassage(source, item.page, item.quote));
    const passages = resolved.flatMap(item => item.passage ? [item.passage] : []);
    const issue = resolved.find(item => item.issue)?.issue ?? (claim.kind === "stated" && !passages.length ? "No matching source passage was supplied." : undefined);
    const kind = claim.kind === "stated" && issue ? "unsupported" : claim.kind;
    return { id: claim.id, target: claim.target, text: claim.text, kind, rationale: claim.rationale, dependencies: claim.dependencies, verification: passages.length && !issue ? "excerpt_matched" : "not_checked", ...(issue ? { issue } : {}), passages };
  });
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string) => {
    if (visiting.has(id)) throw new Error("Evidence claim dependencies contain a cycle.");
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of claims.find(claim => claim.id === id)!.dependencies) visit(dependency);
    visiting.delete(id); visited.add(id);
  };
  claims.forEach(claim => visit(claim.id));
  const warnings = [...(source.warnings ?? []), ...(omitted.size ? [`${omitted.size} evidence claim(s) omitted because their visualization target or a supporting claim is unavailable. No source links were inferred for them.`] : [])];
  return { version: 1, docId: source.docId, claims, ...(source.provenance ? { source: source.provenance } : {}), ...(warnings.length ? { warnings } : {}) };
}