"use client";

import { useEffect, useRef } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";
import type { FormulaSpec } from "@/lib/schemas";
import { EvidenceMarker } from "./EvidenceView";

function Tex({ tex, label, baseSize = 16 }: { tex: string; label: string; baseSize?: number }) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const content = ref.current;
    const container = containerRef.current;
    if (!content || !container) return;
    try {
      katex.render(tex, content, {
        throwOnError: false,
        displayMode: true,
        strict: "ignore",
      });
    } catch (e) {
      content.textContent = tex;
      console.warn("KaTeX render error (falling back to plain text):", e);
    }
    let disposed = false;
    let lastWidth = -1;
    const fit = (force = false) => {
      if (disposed || !container.clientWidth) return;
      const width = container.clientWidth;
      if (!force && width === lastWidth) return;
      lastWidth = width;
      content.style.fontSize = `${baseSize}px`;
      const naturalWidth = content.getBoundingClientRect().width;
      const size = Math.max(12, Math.min(baseSize, baseSize * Math.max(1, width - 2) / Math.max(1, naturalWidth)));
      content.style.fontSize = `${size}px`;
      container.scrollLeft = 0;
    };
    fit(true);
    const observer = new ResizeObserver(() => fit());
    observer.observe(container);
    void document.fonts.ready.then(() => fit(true));
    const fontLoaded = () => fit(true);
    document.fonts.addEventListener("loadingdone", fontLoaded);
    return () => { disposed = true; observer.disconnect(); document.fonts.removeEventListener("loadingdone", fontLoaded); };
  }, [tex, baseSize]);
  return <div ref={containerRef} role="region" aria-label={label} tabIndex={0} className="w-full min-w-0 max-w-full overflow-x-auto overflow-y-hidden focus-visible:outline focus-visible:outline-[var(--accent-500)]">
    <span ref={ref} className="inline-block w-max max-w-none align-top [&_.katex-display]:my-3 [&_.katex-display]:text-left" style={{ fontSize: baseSize }} />
  </div>;
}

type Props = { spec: FormulaSpec };

export default function FormulaView({ spec }: Props) {
  return (
    <div data-testid="formula-view" className="h-full w-full min-w-0 overflow-y-auto bg-[var(--surface-raised)] px-3 py-4 text-[var(--ink-900)] sm:px-5 sm:py-5">
      <div className="min-w-0 max-w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-sunken)] p-3 sm:p-4">
        <p className="mb-3 text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--ink-400)]">
          Headline
        </p>
        <Tex tex={spec.main_latex} label="Headline equation" baseSize={20} />
        <EvidenceMarker target="main_latex" />
      </div>
      <p className="mt-7 mb-3 text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--ink-400)]">
        Step-by-step derivation
      </p>
      <ol className="min-w-0 space-y-3">
        {spec.steps.map((s, i) => (
          <li
            key={i}
            className="min-w-0 max-w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-raised)] p-3 sm:p-4"
          >
            <div className="mb-2 flex items-center gap-2">
              <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--surface-sunken)] text-[10px] font-medium text-[var(--ink-700)]">
                {i + 1}
              </span>
              <p className="min-w-0 break-words [overflow-wrap:anywhere] text-[12.5px] text-[var(--ink-500)]">{s.explanation}</p>
            </div>
            <Tex tex={s.latex} label={`Derivation equation ${i + 1}`} />
            <EvidenceMarker target={`step:${i + 1}`} />
          </li>
        ))}
      </ol>
    </div>
  );
}
