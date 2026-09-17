export type Connection = { origin: string; extensionId: string; token: string; expiresAt: number };
export type StudyDocument = { docId: string; filename: string; numPages: number };
export const MAX_PDF_BYTES = 20 * 1024 * 1024;

export function engineOrigin(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname)
    || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("Use a local engine address such as http://127.0.0.1:3000.");
  }
  return url.origin;
}

export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export async function api<Result>(connection: Connection, path: string, body?: unknown, method = body === undefined ? "GET" : "POST", signal?: AbortSignal): Promise<Result> {
  let response: Response;
  try {
    response = await fetch(`${engineOrigin(connection.origin)}/api/extension/${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${connection.token}`,
        "X-PaperMotion-Extension": connection.extensionId,
        ...(body === undefined || body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      },
      body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
      credentials: "omit",
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(330000)]) : AbortSignal.timeout(330000),
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new Error("The local engine did not respond. Check that PaperMotion is running, then retry.");
  }
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(typeof result?.error === "string" ? result.error : `Engine request failed (${response.status}).`, response.status);
  if (!result) throw new Error("The engine returned an unreadable response.");
  return result;
}

export async function fetchPdf(url: string, fileAccessAllowed = false): Promise<Blob> {
  const source = new URL(url);
  const localFile = source.protocol === "file:";
  if (!["https:", "http:", "file:"].includes(source.protocol) || source.username || source.password
    || (localFile && source.hostname !== "")) {
    throw new Error("Open a PDF from a website or your computer in its own tab. Temporary and embedded documents may need Choose File.");
  }
  if (localFile && !fileAccessAllowed) {
    throw new Error("Enable Allow access to file URLs in this extension's Details page, then return to the PDF tab and retry Study This PDF. If the setting is managed, ask your administrator.");
  }
  const response = await fetch(source.href, { credentials: localFile ? "omit" : "include", signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`PDF download failed (${response.status}). Choose the PDF file instead.`);
  if (Number(response.headers.get("content-length")) > MAX_PDF_BYTES) throw new Error("PDFs must be 20 MB or smaller.");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("The PDF download was empty.");
  const chunks: ArrayBuffer[] = [];
  let size = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    size += result.value.byteLength;
    if (size > MAX_PDF_BYTES) {
      await reader.cancel();
      throw new Error("PDFs must be 20 MB or smaller.");
    }
    chunks.push(result.value.slice().buffer);
  }
  return new Blob(chunks, { type: "application/pdf" });
}

export async function pdfHash(pdf: Blob): Promise<string> {
  if (!pdf.size || pdf.size > MAX_PDF_BYTES) throw new Error("Choose a nonempty PDF of at most 20 MB.");
  if (await pdf.slice(0, 5).text() !== "%PDF-") throw new Error("This tab did not return a PDF. Choose the PDF file instead.");
  const digest = await crypto.subtle.digest("SHA-256", await pdf.arrayBuffer());
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, "0")).join("");
}