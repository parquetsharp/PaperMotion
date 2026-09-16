"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { BookOpen, X } from "lucide-react";
import { EVIDENCE_LABELS, type EvidenceClaim, type EvidenceHighlight, type VisualizationEvidence } from "@/lib/evidence-types";

type EvidenceContext = { evidence?: VisualizationEvidence; select: (target: string) => void };
const Context = createContext<EvidenceContext | null>(null);

export function EvidenceMarker({ target }: { target: string }) {
  const context = useContext(Context);
  if (!context) return null;
  const claims = context.evidence?.claims.filter(claim => claim.target === target) ?? [];
  return <button type="button" title={`Evidence for ${target}`} aria-label={`Evidence for ${target}`} onClick={() => context.select(target)} className="my-1 inline-flex min-h-7 max-w-full items-center gap-1 rounded border border-[var(--border-subtle)] px-2 py-1 text-left font-sans text-[11px] leading-4 text-[var(--ink-700)] hover:bg-[var(--surface-sunken)]">
    <BookOpen size={12} className="shrink-0" />{claims.length === 1 ? EVIDENCE_LABELS[claims[0].kind] : claims.length ? `${claims.length} evidence claims` : "Evidence not checked"}
  </button>;
}

export default function EvidenceView({ evidence, children, onShowPassage, onClearPassage }: { evidence?: VisualizationEvidence; children: ReactNode; onShowPassage?: (highlight: EvidenceHighlight) => Promise<void>; onClearPassage?: () => void }) {
  const [target, setTarget] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [error, setError] = useState("");
  const claims = evidence?.claims.filter(claim => claim.target === target) ?? [];
  const claim = claims.find(item => item.id === selectedId) ?? claims[0];
  const select = (next: string) => { onClearPassage?.(); setTarget(next); setSelectedId(""); setError(""); };
  const dependencyLabel = (id: string) => evidence?.claims.find(item => item.id === id)?.text ?? id;
  const jump = async (item: EvidenceClaim, index: number) => {
    if (!onShowPassage || !evidence) return;
    setError("");
    try { await onShowPassage({ ...item.passages[index], docId: evidence.docId, claimId: item.id }); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "This evidence location is unavailable."); }
  };
  return <Context.Provider value={{ evidence, select }}>
    <div className="relative flex h-full min-h-0 flex-col">
      {!!evidence?.warnings?.length && <div role="status" aria-label="Evidence warnings" className="max-h-20 shrink-0 overflow-auto border-b border-[var(--border-subtle)] bg-[var(--tag-amber-bg)] px-3 py-2 text-xs text-[var(--tag-amber-fg)]">{evidence.warnings.map(warning => <p key={warning} className="break-words">{warning}</p>)}</div>}
      <div className="relative min-h-0 flex-1 overflow-hidden">{children}</div>
      {target !== null && <section aria-label="Claim evidence" className="max-h-[52%] shrink-0 space-y-2 overflow-auto border-t border-[var(--border-default)] bg-[var(--surface-raised)] p-3 text-xs text-[var(--ink-900)]">
        <div className="flex items-center justify-between gap-2"><h3 className="font-semibold">Evidence</h3><button type="button" aria-label="Close evidence" title="Close evidence" onClick={() => { onClearPassage?.(); setTarget(null); }} className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded hover:bg-[var(--surface-sunken)]"><X size={15} /></button></div>
        {claims.length > 1 && <select aria-label="Evidence claim" value={claim?.id ?? ""} onChange={event => { onClearPassage?.(); setError(""); setSelectedId(event.target.value); }} className="h-8 w-full min-w-0 rounded border border-[var(--border-subtle)] bg-[var(--surface-raised)] px-2">{claims.map(item => <option key={item.id} value={item.id}>{item.text}</option>)}</select>}
        {!claim ? <p>Evidence not available for this element. Generate a new version to request evidence.</p> : <>
          <p className="font-medium">{EVIDENCE_LABELS[claim.kind]}</p>
          <p className="break-words">{claim.text}</p>
          <p className="break-words text-[var(--ink-500)]">{claim.rationale}</p>
          <p className="text-[var(--ink-500)]">{claim.verification === "excerpt_matched" ? "Excerpt matched in PDF text. Support is model-assessed, not independently verified." : "No verified source match. Classification is model-suggested."}</p>
          {claim.kind === "derived" && <p>Derivation and calculations have not been independently checked.</p>}
          {claim.kind === "assumption" && <p>Introduced for illustration, not a reported result.</p>}
          {claim.issue && <p role="status" className="text-[var(--feedback-wrong-text)]">{claim.issue}</p>}
          {!!claim.dependencies.length && <div><h4 className="font-medium">Depends on</h4><ul className="space-y-1">{claim.dependencies.map(id => <li key={id}><button type="button" className="text-left underline decoration-dotted" onClick={() => { const dependency = evidence?.claims.find(item => item.id === id); if (dependency) { onClearPassage?.(); setError(""); setTarget(dependency.target); setSelectedId(id); } }}>{dependencyLabel(id)}</button></li>)}</ul></div>}
          {claim.passages.map((passage, index) => <div key={`${passage.page}-${passage.start}`} className="space-y-1 border-l-2 border-[var(--tag-amber-fg)] pl-2">
            <blockquote className="whitespace-pre-wrap break-words">{passage.quote}</blockquote>
            <button type="button" disabled={!onShowPassage || !passage.rects.length} onClick={() => void jump(claim, index)} className="inline-flex min-h-8 items-center gap-1 text-[var(--accent-700)] disabled:text-[var(--ink-400)]"><BookOpen size={13} />Show passage - page {passage.page + 1}</button>
            {!passage.rects.length && <p className="text-[var(--ink-500)]">Highlight coordinates unavailable.</p>}
            {!!passage.rects.length && <p className="text-[var(--ink-500)]">Highlight covers matching PDF text runs; placement is approximate.</p>}
          </div>)}
          {!claim.passages.length && <p className="text-[var(--ink-500)]">No linked PDF passage.</p>}
        </>}
        {error && <p role="alert" className="break-words text-[var(--feedback-wrong-text)]">{error}</p>}
      </section>}
    </div>
  </Context.Provider>;
}