export type ReferenceQuery = { title: string; year?: number; author?: string; arxivId?: string };
export type ResolvedReference = ReferenceQuery & { url: string };

const PDF_HOSTS = new Set(["arxiv.org", "export.arxiv.org", "proceedings.neurips.cc", "papers.nips.cc", "proceedings.mlr.press", "aclanthology.org", "www.usenix.org"]);
export const MAX_SOURCE_PDF_BYTES = 20 * 1024 * 1024;

export function normalizedTitle(text: string): string {
  return text.toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "").replace(/[^a-z0-9]+/g, " ").trim();
}

export function referenceQuery(label: string, context: string): ReferenceQuery {
  const local = context.split(/\n\nSOURCE PAGE /)[0];
  const quoted = [...local.matchAll(/[\u201c"]([^\u201d"\n]{8,250})[\u201d"]/g)].map(match => match[1]);
  const title = (quoted.find(value => value.split(/\s+/).length >= 2) ?? label).replace(/[.,;:]+\s*$/, "").trim();
  const year = local.match(/\b((?:19|20)\d{2})\b/);
  const author = local.match(/([\p{L}-]+)\s+et\s+al\b/iu)?.[1];
  const arxivId = local.match(/(?:arxiv\s*:\s*|arxiv\.org\/(?:abs|pdf)\/)(\d{4}\.\d{4,5}(?:v\d+)?)/i)?.[1];
  return { title: title.slice(0, 250), ...(year ? { year: Number(year[1]) } : {}), ...(author ? { author } : {}), ...(arxivId ? { arxivId } : {}) };
}

export function publicPdfUrl(input: string): URL {
  const url = new URL(input);
  if (url.protocol !== "https:" || url.username || url.password || url.port || !PDF_HOSTS.has(url.hostname)) throw new Error("Use an HTTPS PDF from arXiv, NeurIPS, PMLR, ACL Anthology, or USENIX, or import the PDF manually.");
  if (url.hostname === "arxiv.org" || url.hostname === "export.arxiv.org") {
    const match = /^\/(?:abs|pdf)\/(\d{4}\.\d{4,5}(?:v\d+)?|[a-z-]+\/\d{7}(?:v\d+)?)(?:\.pdf)?\/?$/i.exec(url.pathname);
    if (!match) throw new Error("The arXiv URL must identify a paper.");
    url.hostname = "arxiv.org";
    url.pathname = `/pdf/${match[1]}`;
    url.search = "";
  }
  url.hash = "";
  return url;
}

export async function readPublicSource(url: URL, kind: "metadata" | "pdf", signal?: AbortSignal, request: typeof fetch = fetch): Promise<Uint8Array> {
  const limit = kind === "pdf" ? MAX_SOURCE_PDF_BYTES : 1_000_000;
  const deadline = AbortSignal.timeout(25000);
  const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
  let next = url;
  for (let redirects = 0; redirects <= 3; redirects++) {
    if (kind === "pdf") next = publicPdfUrl(next.href);
    else if (next.origin !== "https://api.openalex.org" || next.pathname !== "/works") throw new Error("Unexpected reference metadata endpoint.");
    combined.throwIfAborted();
    const response = await request(next, { redirect: "manual", credentials: "omit", signal: combined, headers: { Accept: kind === "pdf" ? "application/pdf" : "application/json" } });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      const location = response.headers.get("location");
      if (!location) throw new Error("The source returned an invalid redirect.");
      next = new URL(location, next);
      continue;
    }
    if (!response.ok || !response.body) { await response.body?.cancel(); throw new Error(`Public source retrieval returned HTTP ${response.status}.`); }
    if (Number(response.headers.get("content-length")) > limit) { await response.body.cancel(); throw new Error("The public source exceeds the download size limit."); }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        combined.throwIfAborted();
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > limit) throw new Error("The public source exceeds the download size limit.");
        chunks.push(value);
      }
    } finally { await reader.cancel(); }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    if (kind === "pdf" && new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-") throw new Error("The retrieved source is not a PDF. Import the paper manually.");
    return bytes;
  }
  throw new Error("The source redirected too many times.");
}

type Work = { title?: string; publication_year?: number; authorships?: Array<{ author?: { display_name?: string } }>; locations?: Array<{ pdf_url?: string; landing_page_url?: string }> };

export function matchReference(query: ReferenceQuery, works: Work[]): ResolvedReference {
  const candidates = new Map<string, ResolvedReference>();
  for (const work of works) {
    if (!work.title || normalizedTitle(work.title) !== normalizedTitle(query.title)) continue;
    if (query.author && !work.authorships?.some(item => normalizedTitle(item.author?.display_name ?? "").split(" ").includes(normalizedTitle(query.author!)))) continue;
    for (const location of work.locations ?? []) {
      let url: URL;
      try { url = publicPdfUrl(location.pdf_url ?? location.landing_page_url ?? ""); } catch { continue; }
      const arxivYear = url.hostname === "arxiv.org" && /^\/pdf\/\d{4}\./.test(url.pathname) ? 2000 + Number(url.pathname.slice(5, 7)) : undefined;
      if (query.year && Math.abs((arxivYear ?? work.publication_year ?? 0) - query.year) > 1) continue;
      const identity = url.href.replace(/v\d+$/, "");
      candidates.set(identity, { ...query, url: url.href });
    }
  }
  const arxiv = [...candidates.values()].filter(item => new URL(item.url).hostname === "arxiv.org");
  const preferred = arxiv.length ? arxiv : [...candidates.values()];
  if (preferred.length !== 1) throw new Error(preferred.length ? "Several papers match this citation. Supply the intended public paper URL." : "No matching PDF was found on the approved repositories. Supply its public paper URL or import the PDF.");
  return preferred[0];
}

export async function resolveReference(query: ReferenceQuery, sourceUrl?: string, signal?: AbortSignal, request: typeof fetch = fetch): Promise<ResolvedReference> {
  if (sourceUrl) return { ...query, url: publicPdfUrl(sourceUrl).href };
  if (query.arxivId) return { ...query, url: publicPdfUrl(`https://arxiv.org/abs/${query.arxivId}`).href };
  const url = new URL("https://api.openalex.org/works");
  url.search = new URLSearchParams({ search: query.title, per_page: "5", select: "title,publication_year,authorships,locations" }).toString();
  const bytes = await readPublicSource(url, "metadata", signal, request);
  const data: unknown = JSON.parse(new TextDecoder().decode(bytes));
  if (!data || typeof data !== "object" || !("results" in data) || !Array.isArray(data.results)) throw new Error("The reference metadata response was invalid.");
  return matchReference(query, data.results);
}