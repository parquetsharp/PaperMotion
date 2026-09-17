import assert from "node:assert/strict";
import test from "node:test";
import { isBibliographyPage, selectSourcePages } from "../lib/source-retrieval";
import { matchReference, MAX_SOURCE_PDF_BYTES, publicPdfUrl, readPublicSource, referenceQuery, resolveReference } from "../lib/source-fetch";
import { retrieveSourceContext } from "../lib/source-context";
import type { ExtractedPdf } from "../lib/pdf-extract";

test("Source retrieval finds explanation pages instead of bibliography-only matches", () => {
  const source = { docId: "paper", pages: [
    { pageIndex: 0, text: "An introduction to memory allocation." },
    { pageIndex: 1, text: "The Transformer architecture uses multi-head attention and feed-forward layers." },
    { pageIndex: 2, text: "References\nVaswani et al. 2017. Attention Is All You Need. Transformer architecture." },
  ] };
  assert.deepEqual(selectSourcePages(source, "Transformer architecture attention", 2).pages.map(page => page.pageIndex), [1]);
  assert.equal(isBibliographyPage(source.pages[2].text), true);
  assert.deepEqual(selectSourcePages(source, "photosynthesis").pages, []);
});

test("Source retrieval bounds the evidence context and preserves original page numbers and text", () => {
  const source = { docId: "paper", pages: Array.from({ length: 20 }, (_, index) => ({ pageIndex: index, text: `Attention layer ${index}. ${"text ".repeat(1800)}` })) };
  const selected = selectSourcePages(source, "attention layer", 12);
  assert.equal(selected.pages.length, 4);
  assert.ok(selected.pages.some(page => page.pageIndex === 12));
  assert.ok(selected.pages.reduce((sum, page) => sum + page.text.length, 0) <= 40000);
  assert.ok(selected.pages.every(page => page.text === source.pages[page.pageIndex].text));
  assert.equal(selected.docId, "paper");
});

test("Reference matching uses citation identity and ignores untrusted mirrors and different papers", () => {
  const query = referenceQuery("Transformer architecture", "Summarize Vaswani et al.'s 2017 paper \u201cAttention Is All You Need\u201d.\n\nSOURCE PAGE 15:\nOther work arXiv:2205.01068");
  assert.deepEqual(query, { title: "Attention Is All You Need", year: 2017, author: "Vaswani" });
  assert.equal(referenceQuery("Transformer", 'The paper "Attention Is All You Need," introduced the architecture.').title, "Attention Is All You Need");
  const work = { title: query.title, publication_year: 2025, authorships: [{ author: { display_name: "Ashish Vaswani" } }], locations: [{ pdf_url: "https://untrusted.example/paper.pdf" }, { pdf_url: "https://arxiv.org/pdf/1706.03762" }] };
  assert.equal(matchReference(query, [work]).url, "https://arxiv.org/pdf/1706.03762");
  assert.throws(() => matchReference(query, [{ ...work, title: "Attention Is All You Need in Speech Separation" }]));
  assert.throws(() => matchReference(query, [{ ...work, authorships: [] }]));
  assert.throws(() => matchReference(query, [{ ...work, locations: [{ pdf_url: "https://arxiv.org/pdf/2501.00001" }] }]));
  assert.throws(() => matchReference(query, [work, { ...work, locations: [{ pdf_url: "https://arxiv.org/pdf/1706.00001" }] }]));
});

test("Public retrieval blocks private URLs, credentials, unapproved hosts and redirects", async () => {
  for (const url of ["http://arxiv.org/pdf/1706.03762", "https://127.0.0.1/paper.pdf", "https://arxiv.org.evil.test/paper.pdf", "https://name:secret@arxiv.org/pdf/1706.03762", "https://arxiv.org:8443/pdf/1706.03762", "file:///C:/paper.pdf"]) assert.throws(() => publicPdfUrl(url));
  assert.equal(publicPdfUrl("https://arxiv.org/abs/1706.03762").href, "https://arxiv.org/pdf/1706.03762");
  let requests = 0;
  const redirect = (async () => { requests++; return new Response(null, { status: 302, headers: { location: "http://127.0.0.1/private" } }); }) as typeof fetch;
  await assert.rejects(readPublicSource(new URL("https://arxiv.org/pdf/1706.03762"), "pdf", undefined, redirect));
  assert.equal(requests, 1);
});

test("Downloads are bounded, reject non-PDFs and honor cancellation", async () => {
  const url = new URL("https://arxiv.org/pdf/1706.03762");
  await assert.rejects(readPublicSource(url, "pdf", undefined, (async () => new Response("html")) as typeof fetch), /not a PDF/);
  await assert.rejects(readPublicSource(url, "pdf", undefined, (async () => new Response("%PDF-test", { headers: { "content-length": "99999999" } })) as typeof fetch), /size limit/);
  await assert.rejects(readPublicSource(url, "pdf", undefined, (async () => new Response(new Uint8Array(MAX_SOURCE_PDF_BYTES + 1))) as typeof fetch), /size limit/);
  const abort = AbortSignal.abort();
  let calls = 0;
  await assert.rejects(readPublicSource(url, "pdf", abort, (async () => { calls++; return new Response("%PDF-test"); }) as typeof fetch));
  assert.equal(calls, 0);
  assert.equal(new TextDecoder().decode(await readPublicSource(url, "pdf", undefined, (async () => new Response("%PDF-test")) as typeof fetch)), "%PDF-test");
});

test("An explicit arXiv citation resolves without searching or transmitting source-page text", async () => {
  const result = await resolveReference(referenceQuery("OPT", "Zhang et al. (2022), \u201cOPT: Open Pre-trained Transformer Language Models\u201d, arXiv:2205.01068"), undefined, undefined, (async () => { throw new Error("Unexpected metadata request"); }) as typeof fetch);
  assert.equal(result.url, "https://arxiv.org/pdf/2205.01068");
});

const referencePage = { pageIndex: 14, width: 600, height: 800, items: [], text: "References\nVaswani et al. 2017. Attention Is All You Need." };
const paper: ExtractedPdf = { numPages: 2, pages: [
  { ...referencePage, pageIndex: 0, text: "Attention Is All You Need\nAshish Vaswani\n" + "The Transformer uses attention mechanisms in encoder and decoder layers. ".repeat(20) },
  { ...referencePage, pageIndex: 1, text: "Multi-head attention computes parallel attention outputs. ".repeat(30) },
] };
const sourceInput = { label: "Attention Is All You Need", context: "Summarize Vaswani et al.'s 2017 paper \u201cAttention Is All You Need\u201d.", evidenceSource: { docId: "original", pages: [referencePage] }, allowExternal: false };
const original = { id: "original", filename: "Other paper.pdf", extracted: { numPages: 1, pages: [referencePage] } };

test("An imported paper supplies its own identity and evidence without any external request", async () => {
  const imported = { id: "imported", filename: "Attention.pdf", extracted: paper };
  const result = await retrieveSourceContext(sourceInput, { document: id => id === "original" ? original : imported, library: () => [{ id: "imported" }], request: async () => { throw new Error("Unexpected external request"); }, extract: async () => paper, cache: () => { throw new Error("Unexpected cache write"); } });
  assert.equal(result.evidenceSource.docId, "imported");
  assert.equal(result.evidenceSource.provenance?.differentDocument, true);
  assert.ok(result.context.includes("The Transformer uses attention"));
  assert.ok(!result.context.includes("References\n"));
});

test("A cached public paper is reused even with retrieval disabled and an explicit matching URL", async () => {
  const cached = { id: "cached", filename: "Attention.pdf", extracted: paper, sourceUrl: "https://arxiv.org/pdf/1706.03762" };
  const result = await retrieveSourceContext({ ...sourceInput, sourceUrl: "https://arxiv.org/abs/1706.03762" }, { document: id => id === "original" ? original : cached, library: () => [{ id: "cached" }], request: async () => { throw new Error("Unexpected download"); }, extract: async () => paper, cache: () => { throw new Error("Unexpected cache write"); } });
  assert.equal(result.evidenceSource.docId, "cached");
  assert.equal(result.evidenceSource.warnings, undefined);
});

test("External retrieval is opt-in and failures leave original evidence with an explicit warning", async () => {
  let calls = 0;
  const deps = { document: () => original, library: () => [], request: (async () => { calls++; return new Response("", { status: 429 }); }) as typeof fetch, extract: async () => paper, cache: () => { throw new Error("Unexpected cache write"); } };
  const disabled = await retrieveSourceContext(sourceInput, deps);
  assert.equal(calls, 0);
  assert.match(disabled.evidenceSource.warnings![0], /No external request/);
  const failed = await retrieveSourceContext({ ...sourceInput, allowExternal: true }, deps);
  assert.equal(calls, 1);
  assert.equal(failed.evidenceSource.docId, "original");
  assert.match(failed.evidenceSource.warnings![0], /429/);
});

test("Downloaded PDF identity is checked before caching and its provenance is retained", async () => {
  let saved = 0;
  const deps = { document: () => original, library: () => [], request: (async () => new Response("%PDF-fixture")) as typeof fetch, extract: async () => paper, cache: (reference: { url: string }) => { saved++; return { id: "cached", filename: "Attention.pdf", extracted: paper, sourceUrl: reference.url, uploadedAt: 1 }; } };
  const input = { ...sourceInput, allowExternal: true, sourceUrl: "https://arxiv.org/abs/1706.03762" };
  const result = await retrieveSourceContext(input, deps);
  assert.equal(saved, 1);
  assert.equal(result.evidenceSource.docId, "cached");
  assert.equal(result.evidenceSource.provenance?.url, "https://arxiv.org/pdf/1706.03762");
  const wrong = await retrieveSourceContext(input, { ...deps, extract: async () => ({ ...paper, pages: paper.pages.map(page => ({ ...page, text: "A different paper about geology. ".repeat(60) })) }) });
  assert.equal(saved, 1);
  assert.match(wrong.evidenceSource.warnings![0], /does not match/);
  await assert.rejects(retrieveSourceContext({ ...input, signal: AbortSignal.abort() }, deps));
  assert.equal(saved, 1);
});