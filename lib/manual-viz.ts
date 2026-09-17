import { z } from "zod";
import { VIZ_TYPES } from "./schemas";
import { getDoc } from "./store";
import { loadTags, saveTags, type PersistedTagServer } from "./tags-store";

const selectionRequest = z.object({
  requestId: z.string().uuid(),
  page: z.number().int().nonnegative(),
  text: z.string().trim().min(4).max(4000),
  label: z.string().trim().min(2).max(50).optional(),
  type: z.enum([...VIZ_TYPES, "interactive"]),
  endX: z.number().finite().nonnegative(),
  endY: z.number().finite().nonnegative(),
  fontHeight: z.number().finite().positive().max(200),
}).strict();

export class ManualVizError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

type Dependencies = { document: typeof getDoc; load: typeof loadTags; save: typeof saveTags };

export function createManualVisualization(docId: string, input: unknown, dependencies: Dependencies = { document: getDoc, load: loadTags, save: saveTags }): PersistedTagServer {
  const parsed = selectionRequest.safeParse(input);
  if (!parsed.success) throw new ManualVizError(400, "Select 4-4000 characters from one PDF page and choose a valid format.");
  const request = parsed.data;
  const doc = dependencies.document(docId);
  if (!doc) throw new ManualVizError(404, "Document not found.");
  const page = doc.extracted.pages.find(item => item.pageIndex === request.page);
  const compact = (value: string) => value.replace(/\s+/g, "");
  if (!page || !compact(page.text).includes(compact(request.text)) || request.endX > page.width || request.endY > page.height) {
    throw new ManualVizError(400, "The selection does not match this PDF page. Select the text again.");
  }
  const current = dependencies.load(docId);
  const id = `manual-${request.requestId}`;
  if (current?.deletedTagIds?.includes(id)) throw new ManualVizError(409, "This visualization was deleted. Select the passage again to create another.");
  const label = request.label ?? request.text.replace(/\s+/g, " ").slice(0, 40);
  const existing = current?.tags.find(tag => tag.id === id);
  if (existing) {
    if (existing.selection?.text !== request.text || existing.page !== request.page || existing.concept.type !== request.type || existing.concept.label !== label) throw new ManualVizError(409, "This selection request has already been used.");
    return existing;
  }
  const tag: PersistedTagServer = {
    id, page: request.page, endX: request.endX, endY: request.endY, fontHeight: request.fontHeight,
    label, type: request.type, ready: false, generating: true,
    selection: { text: request.text },
    concept: { label, type: request.type, anchor: request.text.slice(-200), context: `Visualize the reader-selected passage, not a different concept:\n${request.text}` },
  };
  dependencies.save(docId, { tags: [...(current?.tags ?? []), tag], activeTagId: tag.id, pagesAnalyzed: current?.pagesAnalyzed ?? [] });
  return tag;
}