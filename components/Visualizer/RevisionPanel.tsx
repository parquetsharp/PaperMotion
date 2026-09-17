"use client";

import { useState } from "react";
import Link from "next/link";
import { Send, Sparkles, Undo2, MessageSquare, Loader2, Trash2, X } from "lucide-react";
import type { PersistedTagServer } from "@/lib/tags-store";
import type { VizType } from "@/lib/schemas";
import { visualizationVersions } from "@/lib/viz-versions";
import { VIZ_TYPE_META } from "./viz-meta";

const formats: Array<[VizType, string]> = [["2d-anim", "Animation"], ["interactive", "Step by Step"], ["formula", "Formula"], ["3d", "3D Model"], ["graph", "Plot"], ["2d-text", "Source"]];

export default function RevisionPanel({ docId, tag, onUpdate, onDelete }: { docId: string; tag: PersistedTagServer; onUpdate: (tag: PersistedTagServer) => void; onDelete?: (tagId: string) => void }) {
  const [type, setType] = useState<VizType>(tag.spec?.type ?? tag.type);
  const [draft, setDraft] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const versions = visualizationVersions(tag);
  const disabled = busy || tag.generating;
  async function submit(action: "generate" | "undo" | "restore", feedback = "", versionId?: string) {
    if (disabled) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/viz/${encodeURIComponent(docId)}/${encodeURIComponent(tag.id)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(action === "restore" ? { action, versionId, revision: tag.revision ?? 0 } : action === "undo" ? { action, revision: tag.revision ?? 0 } : { action, type, feedback, revision: tag.revision ?? 0, ...(type === "2d-text" && sourceUrl.trim() ? { sourceUrl: sourceUrl.trim() } : {}) }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not revise the visualization.");
      onUpdate(result.tag);
      setType(result.tag.type);
      if (feedback) setDraft("");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not revise the visualization."); }
    finally { setBusy(false); }
  }
  async function remove() {
    if (busy || !onDelete) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/viz/${encodeURIComponent(docId)}/${encodeURIComponent(tag.id)}`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ revision: tag.revision ?? 0 }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not delete the visualization.");
      onDelete(tag.id);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not delete the visualization."); }
    finally { setBusy(false); }
  }
  const iconClass = "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded border border-[var(--border-subtle)] hover:bg-[var(--surface-sunken)] disabled:opacity-40";
  return <section className="shrink-0 border-t border-[var(--border-subtle)] bg-[var(--surface-raised)] text-[var(--ink-900)]" aria-label="Visualization revision">
    <div className="flex flex-wrap items-center gap-2 px-3 py-2">
      <select aria-label="Visualization format" value={type} disabled={disabled} onChange={event => setType(event.target.value as VizType)} className="h-8 min-w-0 flex-1 rounded border border-[var(--border-subtle)] bg-[var(--surface-raised)] px-2 text-xs">{formats.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
      <button className="inline-flex h-8 items-center gap-1 rounded border border-[var(--border-subtle)] px-2 text-xs disabled:opacity-40" disabled={disabled} onClick={() => void submit("generate")}><Sparkles size={14} />Generate</button>
      <button className={iconClass} title="Undo last revision" aria-label="Undo last revision" disabled={disabled || !tag.versions?.length} onClick={() => void submit("undo")}><Undo2 size={15} /></button>
      <button className={iconClass} title="Discuss and revise visualization" aria-label="Discuss and revise visualization" aria-expanded={open} onClick={() => setOpen(!open)}><MessageSquare size={15} /></button>
      {onDelete && <button type="button" className={iconClass} title="Delete visualization" aria-label="Delete visualization" disabled={busy} onClick={() => setConfirmDelete(true)}><Trash2 size={15} /></button>}
    </div>
    {type === "2d-text" && <div className="flex flex-wrap items-center gap-2 px-3 pb-2 text-xs">
      <label htmlFor={`source-url-${tag.id}`} className="shrink-0 text-[var(--ink-500)]">Paper URL</label>
      <input id={`source-url-${tag.id}`} type="url" aria-label="Public paper URL" title="Optional arXiv, NeurIPS, PMLR, ACL Anthology, or USENIX URL. Requires Public paper retrieval in Settings." placeholder="Optional https://arxiv.org/abs/..." maxLength={2000} value={sourceUrl} disabled={disabled} onChange={event => setSourceUrl(event.target.value)} className="h-8 min-w-0 flex-1 rounded border border-[var(--border-subtle)] bg-[var(--surface-raised)] px-2" />
      <Link href="/" title="Import a reference PDF" aria-label="Import a reference PDF" className="text-[var(--accent-700)] underline">Import PDF</Link>
    </div>}
    {versions.length > 1 && <div className="flex items-center gap-2 px-3 pb-2 text-xs">
      <label htmlFor={`versions-${tag.id}`} className="shrink-0 text-[var(--ink-500)]">Saved version</label>
      <select id={`versions-${tag.id}`} aria-label="Saved visualization version" value={tag.spec ? tag.versionId ?? "current" : ""} disabled={disabled} onChange={event => void submit("restore", "", event.target.value)} className="h-8 min-w-0 flex-1 rounded border border-[var(--border-subtle)] bg-[var(--surface-raised)] px-2">
        {!tag.spec && <option value="" disabled>Select version</option>}
        {versions.map((version, index) => <option key={version.id} value={version.id}>{index + 1}. {VIZ_TYPE_META[version.spec.type].label}: {version.spec.title}{version.id === (tag.versionId ?? "current") ? " (current)" : ""}</option>)}
      </select>
    </div>}
    {confirmDelete && <div role="alertdialog" aria-label="Confirm visualization deletion" className="space-y-2 border-t border-[var(--border-subtle)] px-3 py-2 text-xs">
      <p className="break-words">Delete &quot;{tag.label}&quot; and all its saved versions? This cannot be undone. The PDF is kept.</p>
      <div className="flex gap-2">
        <button type="button" disabled={busy} onClick={() => void remove()} className="inline-flex h-8 items-center gap-1 rounded border border-[var(--feedback-wrong-border)] px-2 text-[var(--feedback-wrong-text)] disabled:opacity-40"><Trash2 size={14} />Delete permanently</button>
        <button type="button" disabled={busy} onClick={() => setConfirmDelete(false)} className="inline-flex h-8 items-center gap-1 rounded border border-[var(--border-subtle)] px-2"><X size={14} />Cancel</button>
      </div>
    </div>}
    {busy && <p role="status" className="flex items-center gap-2 px-3 pb-2 text-xs"><Loader2 className="animate-spin" size={14} />Revising visualization...</p>}
    {error && <p role="alert" className="max-h-20 overflow-auto break-words px-3 pb-2 text-xs text-[var(--feedback-wrong-text)]">{error}</p>}
    {open && <div className="border-t border-[var(--border-subtle)] px-3 py-2">
      {!!tag.feedback?.length && <ol aria-label="Visualization feedback history" className="mb-2 max-h-28 space-y-2 overflow-auto text-xs">{tag.feedback.map(entry => <li key={entry.id} className="break-words"><p><strong>You: </strong>{entry.message}</p><p className={entry.status === "failed" ? "text-[var(--feedback-wrong-text)]" : "text-[var(--ink-500)]"}>{entry.reply}</p></li>)}</ol>}
      <form className="flex items-end gap-2" onSubmit={event => { event.preventDefault(); if (draft.trim()) void submit("generate", draft.trim()); }}>
        <textarea aria-label="Visualization feedback" value={draft} onChange={event => setDraft(event.target.value)} maxLength={2000} disabled={disabled} rows={2} placeholder="Correct the equation, change the example, or explain a missing step..." className="min-w-0 flex-1 resize-y rounded border border-[var(--border-subtle)] bg-[var(--surface-raised)] p-2 text-xs" />
        <button type="submit" className={iconClass} title="Apply feedback" aria-label="Apply feedback" disabled={disabled || !draft.trim()}><Send size={15} /></button>
      </form>
    </div>}
  </section>;
}