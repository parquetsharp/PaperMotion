"use client";

import { useEffect, useState, type RefObject } from "react";
import { Loader2, Sparkles, X } from "lucide-react";
import type { VizType } from "@/lib/schemas";
import { VIZ_LEGEND_ORDER, VIZ_TYPE_META } from "./Visualizer/viz-meta";

export type PdfSelectionRequest = {
  requestId: string;
  page: number;
  text: string;
  endX: number;
  endY: number;
  fontHeight: number;
  type: VizType;
  label?: string;
};

type Passage = Omit<PdfSelectionRequest, "type" | "label">;

export default function PdfSelectionTools({ root, pageDims, onGenerate }: {
  root: RefObject<HTMLDivElement | null>;
  pageDims: Array<{ width: number; height: number }>;
  onGenerate: (selection: PdfSelectionRequest) => Promise<void>;
}) {
  const [passage, setPassage] = useState<Passage | null>(null);
  const [type, setType] = useState<VizType>("formula");
  const [label, setLabel] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const capture = () => {
      if (busy || !root.current) return;
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || !selection.rangeCount) return;
      const range = selection.getRangeAt(0);
      const element = (node: Node) => node instanceof Element ? node : node.parentElement;
      const start = element(range.startContainer)?.closest<HTMLElement>(".textLayer[data-selection-page]");
      const end = element(range.endContainer)?.closest<HTMLElement>(".textLayer[data-selection-page]");
      if (!start || !root.current.contains(start)) return;
      if (start !== end) { setPassage(null); setError("Select text within a single PDF page."); return; }
      const pieces: string[] = [];
      for (const span of start.querySelectorAll("[data-pdf-text]")) {
        if (!range.intersectsNode(span)) continue;
        const piece = document.createRange();
        piece.selectNodeContents(span);
        if (range.compareBoundaryPoints(Range.START_TO_START, piece) > 0) piece.setStart(range.startContainer, range.startOffset);
        if (range.compareBoundaryPoints(Range.END_TO_END, piece) < 0) piece.setEnd(range.endContainer, range.endOffset);
        const text = piece.toString();
        if (text) pieces.push(text);
      }
      const text = pieces.join(" ").replace(/\s+/g, " ").trim();
      if (text.length < 4 || text.length > 4000) { setPassage(null); setError("Select between 4 and 4000 characters."); return; }
      const page = Number(start.dataset.selectionPage);
      const dimensions = pageDims[page];
      const pageRect = start.getBoundingClientRect();
      const rect = Array.from(range.getClientRects()).filter(item => item.width > 0 && item.height > 0).at(-1);
      if (!dimensions || !rect || !pageRect.width || !pageRect.height) return;
      const next: Passage = {
        requestId: crypto.randomUUID(), page, text,
        endX: Math.max(0, Math.min(dimensions.width, (rect.right - pageRect.left) / pageRect.width * dimensions.width)),
        endY: Math.max(0, Math.min(dimensions.height, (pageRect.bottom - rect.bottom) / pageRect.height * dimensions.height)),
        fontHeight: Math.min(200, Math.max(1, rect.height / pageRect.height * dimensions.height)),
      };
      setPassage(previous => previous?.text === next.text && previous.page === next.page && previous.endY === next.endY ? previous : next);
      setError("");
    };
    document.addEventListener("selectionchange", capture);
    return () => document.removeEventListener("selectionchange", capture);
  }, [root, pageDims, busy]);

  const dismiss = () => { setPassage(null); setError(""); setLabel(""); window.getSelection()?.removeAllRanges(); };
  if (!passage && !error) return null;
  return <section aria-label="Selected passage" className="absolute inset-x-2 top-2 z-40 max-h-[55%] overflow-auto rounded-lg border border-[var(--border-default)] bg-[var(--surface-raised)] p-3 text-xs text-[var(--ink-900)] shadow-[var(--shadow-popover)]">
    <div className="mb-2 flex items-center justify-between gap-2">
      <p className="font-medium">{passage ? `Page ${passage.page + 1} - ${passage.text.length} characters` : "PDF selection"}</p>
      <button type="button" disabled={busy} aria-label="Dismiss selection" title="Dismiss selection" onClick={dismiss} className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded hover:bg-[var(--surface-sunken)] disabled:opacity-40"><X size={15} /></button>
    </div>
    {passage && <form onSubmit={async event => {
      event.preventDefault();
      if (busy) return;
      setBusy(true); setError("");
      try { await onGenerate({ ...passage, type, ...(label.trim() ? { label: label.trim() } : {}) }); dismiss(); }
      catch (failure) { setError(failure instanceof Error ? failure.message : "Could not create the visualization."); }
      finally { setBusy(false); }
    }} className="space-y-2">
      <p aria-label="Selected PDF text" className="max-h-20 overflow-auto whitespace-pre-wrap break-words border-l-2 border-[var(--accent-500)] pl-2 text-[var(--ink-500)]">{passage.text}</p>
      <label className="flex flex-col gap-1">Label (optional)<input aria-label="Selection label" value={label} maxLength={50} minLength={2} disabled={busy} onChange={event => { setLabel(event.target.value); setPassage(previous => previous ? { ...previous, requestId: crypto.randomUUID() } : previous); }} className="min-w-0 rounded border border-[var(--border-subtle)] bg-[var(--surface-raised)] px-2 py-1.5" /></label>
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="Selection visualization format" value={type} disabled={busy} onChange={event => { setType(event.target.value as VizType); setPassage(previous => previous ? { ...previous, requestId: crypto.randomUUID() } : previous); }} className="h-8 min-w-0 flex-1 rounded border border-[var(--border-subtle)] bg-[var(--surface-raised)] px-2">{VIZ_LEGEND_ORDER.map(format => <option key={format} value={format}>{VIZ_TYPE_META[format].label}</option>)}</select>
        <button type="submit" disabled={busy} className="inline-flex h-8 items-center gap-1.5 rounded border border-[var(--border-subtle)] px-2 disabled:opacity-40">{busy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}Generate selection</button>
      </div>
      {busy && <p role="status">Saving selection...</p>}
    </form>}
    {error && <p role="alert" className="mt-2 break-words text-[var(--feedback-wrong-text)]">{error}</p>}
  </section>;
}