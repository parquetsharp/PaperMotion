import fs from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import type { EvidenceSource } from "./evidence";
import { getDoc, listDocs, saveDoc } from "./store";
import { ensureDocDir, pdfPath } from "./paths";
import { assessPdfQuality, extractPdf, type ExtractedPdf } from "./pdf-extract";
import { isBibliographyPage, selectSourcePages } from "./source-retrieval";
import { normalizedTitle, publicPdfUrl, readPublicSource, referenceQuery, resolveReference, type ReferenceQuery } from "./source-fetch";

type SourceDocument = { id: string; filename: string; extracted: ExtractedPdf; sourceUrl?: string; uploadedAt?: number };
type SourceInput = { label: string; context: string; evidenceSource: EvidenceSource; allowExternal: boolean; sourceUrl?: string; signal?: AbortSignal };
type Dependencies = {
  document: (id: string) => SourceDocument | undefined;
  library: () => Array<{ id: string }>;
  request: typeof fetch;
  extract: typeof extractPdf;
  cache: (reference: ReferenceQuery & { url: string }, bytes: Uint8Array, extracted: ExtractedPdf) => SourceDocument;
};

function cacheReference(reference: ReferenceQuery & { url: string }, bytes: Uint8Array, extracted: ExtractedPdf): SourceDocument {
  const id = `ref-${createHash("sha256").update(bytes).digest("hex").slice(0, 40)}`;
  const existing = getDoc(id);
  if (existing) return existing;
  const entry = { id, filename: `${reference.title}.pdf`, sourceUrl: reference.url, uploadedAt: Date.now(), numPages: extracted.numPages, extracted, pdfUrl: `/api/pdf/${id}` };
  ensureDocDir(id);
  const temporary = `${pdfPath(id)}.${randomUUID()}.tmp`;
  try { fs.writeFileSync(temporary, bytes); fs.renameSync(temporary, pdfPath(id)); saveDoc(entry); }
  finally { fs.rmSync(temporary, { force: true }); }
  return entry;
}

export function documentMatchesReference(document: SourceDocument, query: ReferenceQuery): boolean {
  const page = document.extracted.pages[0];
  if (!page || isBibliographyPage(page.text)) return false;
  const text = normalizedTitle(page.text.slice(0, 18000));
  const position = text.indexOf(normalizedTitle(query.title));
  return position >= 0 && position < 700 && (!query.author || text.split(" ").includes(normalizedTitle(query.author)));
}

export async function retrieveSourceContext(input: SourceInput, dependencies: Dependencies = { document: getDoc, library: listDocs, request: fetch, extract: extractPdf, cache: cacheReference }): Promise<{ context: string; evidenceSource: EvidenceSource }> {
  input.signal?.throwIfAborted();
  const query = referenceQuery(input.label, input.context);
  const bibliography = input.evidenceSource.pages.some(page => isBibliographyPage(page.text));
  const reference = bibliography || !!input.sourceUrl;
  const current = dependencies.document(input.evidenceSource.docId);
  const originalRequest = input.context.split(/\n\nSOURCE PAGE /)[0];
  const selected = (document: SourceDocument) => {
    const evidenceSource = selectSourcePages({ docId: document.id, pages: document.extracted.pages }, `${query.title} ${originalRequest}`, input.evidenceSource.pages[0]?.pageIndex);
    evidenceSource.provenance = { title: document.filename.replace(/\.pdf$/i, ""), differentDocument: document.id !== input.evidenceSource.docId, ...(document.sourceUrl ? { url: document.sourceUrl, retrievedAt: document.uploadedAt } : {}) };
    return {
      context: `REQUESTED SUBJECT (not source evidence):\n${originalRequest}\n\nAPPLICATION-SUPPLIED SOURCE: ${document.filename}\n${document.sourceUrl ? `Public PDF URL: ${document.sourceUrl}\n` : ""}The application extracted the source pages below. Explain only what they support. The original bibliography is not evidence for this paper's methods or findings. Do not claim that you browsed or independently verified the paper.\n${evidenceSource.pages.map(page => `SOURCE PAGE ${page.pageIndex + 1}:\n${page.text}`).join("\n\n")}`,
      evidenceSource,
    };
  };
  if (current && !input.sourceUrl && (!reference || documentMatchesReference(current, query))) {
    const result = selected(current);
    if (result.evidenceSource.pages.length) return result;
  }
  if (current) {
    for (const item of dependencies.library()) {
      if (item.id === current.id) continue;
      const document = dependencies.document(item.id);
      if (input.sourceUrl) {
        try { if (document?.sourceUrl !== publicPdfUrl(input.sourceUrl).href) continue; }
        catch { continue; }
      }
      if (document && documentMatchesReference(document, query)) {
        const result = selected(document);
        if (result.evidenceSource.pages.length) return result;
      }
    }
  }
  const fallback = (message: string) => ({ context: `${input.context}\n\nAPPLICATION RETRIEVAL STATUS: ${message} Do not invent content of the referenced paper.`, evidenceSource: { ...input.evidenceSource, warnings: [...(input.evidenceSource.warnings ?? []), message] } });
  if (!reference) return { context: input.context, evidenceSource: input.evidenceSource };
  if (!input.allowExternal) return fallback("The referenced paper was not retrieved. Enable Public paper retrieval in Settings, or import the PDF and generate again. No external request was made.");
  try {
    const deadline = AbortSignal.timeout(60000);
    const signal = input.signal ? AbortSignal.any([input.signal, deadline]) : deadline;
    const resolved = await resolveReference(query, input.sourceUrl, signal, dependencies.request);
    const bytes = await readPublicSource(new URL(resolved.url), "pdf", signal, dependencies.request);
    const extracted = await dependencies.extract(bytes.slice());
    assessPdfQuality(extracted);
    if (!documentMatchesReference({ id: "candidate", filename: resolved.title, extracted }, query)) throw new Error("The downloaded PDF's opening page does not match the citation title and author. Import the intended PDF manually.");
    signal.throwIfAborted();
    const document = dependencies.cache(resolved, bytes, extracted);
    const result = selected(document);
    if (!result.evidenceSource.pages.length) return fallback("The paper was retrieved, but no relevant text pages were found. Import a text-readable version.");
    return result;
  } catch (error) {
    input.signal?.throwIfAborted();
    return fallback(`Reference retrieval unavailable: ${error instanceof Error ? error.message : "The public source could not be read."}`);
  }
}