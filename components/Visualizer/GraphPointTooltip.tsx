"use client";

import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { X } from "lucide-react";
import { graphTooltipPosition, type GraphDatum } from "@/lib/graph-inspection";

type Props = {
  id: string;
  datum: GraphDatum;
  candidates: GraphDatum[];
  pinned: boolean;
  containerRef: RefObject<HTMLDivElement | null>;
  viewport: { width: number; height: number };
  xLabel: string;
  yLabel: string;
  onSelect: (datum: GraphDatum) => void;
  onPin: () => void;
  onClose: () => void;
};

export default function GraphPointTooltip({ id, datum, candidates, pinned, containerRef, viewport, xLabel, yLabel, onSelect, onPin, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const tooltip = ref.current;
    const container = containerRef.current;
    if (!tooltip || !container) return;
    const bounds = tooltip.getBoundingClientRect();
    const next = graphTooltipPosition({ horizontal: datum.horizontal - container.scrollLeft, vertical: datum.vertical - container.scrollTop }, bounds, { width: container.clientWidth, height: container.clientHeight });
    setPosition({ left: next.left + container.scrollLeft, top: next.top + container.scrollTop });
  }, [datum, containerRef, viewport, pinned, candidates.length]);

  return <div ref={ref} id={id} role={pinned ? "dialog" : "tooltip"} aria-label={pinned ? "Data point details" : undefined} onClick={pinned ? undefined : onPin} className="absolute z-20 space-y-2 overflow-auto rounded-md border border-[var(--border-default)] bg-[var(--surface-raised)] p-3 text-xs text-[var(--ink-900)] shadow-md" style={{ width: Math.min(288, Math.max(0, viewport.width - 16)), maxHeight: Math.max(0, Math.min(280, viewport.height - 16)), left: position?.left ?? 0, top: position?.top ?? 0, visibility: position ? "visible" : "hidden" }}>
    <div className="flex items-start gap-2">
      <span aria-hidden="true" className="mt-1 h-2 w-3 shrink-0 rounded-sm" style={{ backgroundColor: datum.color }} />
      <strong data-testid="graph-point-series" className="min-w-0 flex-1 [overflow-wrap:anywhere]">{datum.series}</strong>
      {pinned && <button type="button" title="Close data point" aria-label="Close data point" onClick={onClose} className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded hover:bg-[var(--surface-sunken)]"><X size={14} /></button>}
    </div>
    <dl className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-x-3 gap-y-1">
      <dt className="[overflow-wrap:anywhere] text-[var(--ink-500)]">{xLabel || "x"}</dt>
      <dd data-testid="graph-point-x" className="text-right font-mono tabular-nums [overflow-wrap:anywhere]">{String(datum.xValue)}</dd>
      <dt className="[overflow-wrap:anywhere] text-[var(--ink-500)]">{yLabel || "y"}</dt>
      <dd data-testid="graph-point-y" className="text-right font-mono tabular-nums [overflow-wrap:anywhere]">{String(datum.yValue)}</dd>
    </dl>
    {pinned && candidates.length > 1 && <select aria-label="Nearby data point" value={datum.id} onChange={event => { const next = candidates.find(item => item.id === Number(event.target.value)); if (next) onSelect(next); }} className="h-8 w-full min-w-0 rounded border border-[var(--border-subtle)] bg-[var(--surface-raised)] px-1">
      {candidates.map(item => <option key={item.id} value={item.id}>{item.series}: {String(item.xValue)}, {String(item.yValue)}</option>)}
    </select>}
  </div>;
}