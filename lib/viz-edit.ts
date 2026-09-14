import { randomUUID } from "node:crypto";
import { z } from "zod";
import { VIZ_TYPES, type VizSpec } from "./schemas";
import { loadTags, saveTags, type PersistedTagServer } from "./tags-store";
import { getDoc } from "./store";
import { generateVizSpec } from "./agents/viz";
import { beginVizEdit } from "./viz-edit-lock";

export const vizEditRequest = z.discriminatedUnion("action", [
  z.object({ action: z.literal("generate"), type: z.enum([...VIZ_TYPES, "interactive"]), feedback: z.string().trim().max(2000).default(""), revision: z.number().int().nonnegative() }).strict(),
  z.object({ action: z.literal("undo"), revision: z.number().int().nonnegative() }).strict(),
]);

export class VizEditError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

type Dependencies = {
  load: typeof loadTags;
  save: typeof saveTags;
  document: (id: string) => { filename: string; extracted: { pages: Array<{ pageIndex: number; text: string }> } } | undefined;
  generate: typeof generateVizSpec;
};

export async function editVisualization(docId: string, tagId: string, input: unknown, dependencies: Dependencies = { load: loadTags, save: saveTags, document: getDoc, generate: generateVizSpec }) {
  const parsed = vizEditRequest.safeParse(input);
  if (!parsed.success) throw new VizEditError(400, "Invalid visualization request.");
  const request = parsed.data;
  const release = beginVizEdit(docId, tagId);
  if (!release) throw new VizEditError(409, "This visualization is already being revised. Please wait.");
  try {
    const doc = dependencies.document(docId);
    const file = dependencies.load(docId);
    const tag = file?.tags.find(item => item.id === tagId);
    if (!doc || !file || !tag) throw new VizEditError(404, "Visualization not found.");
    if (tag.generating || (tag.revision ?? 0) !== request.revision) throw new VizEditError(409, "The visualization changed or is still generating. Wait for it to finish, then retry.");

    const commit = (update: (current: PersistedTagServer) => PersistedTagServer) => {
      const current = dependencies.load(docId);
      const selected = current?.tags.find(item => item.id === tagId);
      if (!current || !selected || selected.generating || (selected.revision ?? 0) !== request.revision || JSON.stringify(selected.spec) !== JSON.stringify(tag.spec)) {
        throw new VizEditError(409, "The visualization changed while this request ran. Your current result was preserved.");
      }
      const updated = update(selected);
      dependencies.save(docId, { tags: current.tags.map(item => item.id === tagId ? updated : item), activeTagId: current.activeTagId, pagesAnalyzed: current.pagesAnalyzed });
      return updated;
    };

    if (request.action === "undo") {
      const previous = tag.versions?.at(-1);
      if (!previous) throw new VizEditError(409, "There is no previous version to restore.");
      return commit(current => ({ ...current, spec: previous.spec, type: previous.spec.type, ready: true, error: undefined, lastRuntimeError: undefined, revision: request.revision + 1, versions: current.versions?.slice(0, -1), feedback: [...(current.feedback ?? []), { id: randomUUID(), message: "Undo last revision", reply: "Restored the previous version.", status: "applied" as const, at: Date.now() }].slice(-20) }));
    }

    const message = request.feedback || `Generate ${request.type === "interactive" ? "a step-by-step interactive lesson" : request.type === "2d-anim" ? "an animation" : request.type} for this concept.`;
    let spec: VizSpec;
    try {
      const source = doc.extracted.pages.find(page => page.pageIndex === tag.page)?.text ?? "";
      spec = await dependencies.generate({ type: request.type, label: tag.concept.label, context: `${tag.concept.context}\n\nSOURCE PAGE ${tag.page + 1}:\n${source}`, docTitle: doc.filename, revision: { spec: tag.spec, feedback: message, history: (tag.feedback ?? []).filter(entry => entry.status === "applied").slice(-8).map(entry => entry.message) } });
    } catch (error) {
      const reply = error instanceof Error ? error.message : "Generation failed. Your previous result was preserved.";
      commit(current => ({ ...current, revision: request.revision + 1, feedback: [...(current.feedback ?? []), { id: randomUUID(), message, reply, status: "failed" as const, at: Date.now() }].slice(-20) }));
      throw error;
    }
    return commit(current => ({ ...current, spec, type: spec.type, ready: true, error: undefined, lastRuntimeError: undefined, attempts: 0, revision: request.revision + 1, versions: [...(current.versions ?? []), ...(current.spec ? [{ spec: current.spec, at: Date.now() }] : [])].slice(-5), feedback: [...(current.feedback ?? []), { id: randomUUID(), message, reply: `Updated: ${spec.title}`, status: "applied" as const, at: Date.now() }].slice(-20) }));
  } finally { release(); }
}