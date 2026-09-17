"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import type { GraphSpec } from "@/lib/schemas";
import { barChartLayout } from "@/lib/graph-layout";
import { findGraphData, type GraphDatum } from "@/lib/graph-inspection";
import GraphPointTooltip from "./GraphPointTooltip";

type Props = {
  spec: GraphSpec;
  /** Called once per spec instance if the chart fails to render. */
  onRuntimeError?: (message: string) => void;
};

const COLORS = ["#5b66f1", "#d97706", "#db2777", "#7c3aed", "#059669", "#dc2626"];

function safeFn(expr: string): (x: number) => number {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
  const fn = new Function("Math", "x", `return (${expr});`) as (M: typeof Math, x: number) => number;
  return (x: number) => fn(Math, x);
}

export default function GraphView({ spec, onRuntimeError }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reportedRef = useRef(false);
  const [themeVersion, setThemeVersion] = useState(0);
  const renderedSpecRef = useRef<GraphSpec | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const dataRef = useRef<GraphDatum[]>([]);
  const tooltipId = useId();
  const graphKey = JSON.stringify([spec.chart_type, spec.title, spec.x_label, spec.y_label, spec.data_json]);
  const drawingRef = useRef<{ graphKey: string; size: { width: number; height: number }; themeVersion: number } | null>(null);
  const [selection, setInspection] = useState<{ datum: GraphDatum; candidates: GraphDatum[]; pinned: boolean; graphKey: string; size: { width: number; height: number }; themeVersion: number; scrollLeft: number; scrollTop: number } | null>(null);
  const inspection = !error && selection?.graphKey === graphKey && selection.size === size && selection.themeVersion === themeVersion ? selection : null;
  const inspectAt = (clientX: number, clientY: number, pin: boolean) => {
    const canvas = canvasRef.current;
    if (!canvas || (!pin && inspection?.pinned)) return;
    const bounds = canvas.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const horizontal = (clientX - bounds.left) * parseFloat(canvas.style.width) / bounds.width;
    const vertical = (clientY - bounds.top) * parseFloat(canvas.style.height) / bounds.height;
    const candidates = findGraphData(dataRef.current, horizontal, vertical, pin ? 18 : 10);
    const datum = candidates[0];
    if (pin) canvas.focus({ preventScroll: true });
    setInspection(previous => {
      if (!datum || (pin && previous === inspection && previous?.pinned && previous.datum.id === datum.id)) return null;
      if (!pin && previous === inspection && previous?.datum.id === datum.id) return previous;
      return { datum, candidates, pinned: pin, graphKey, size, themeVersion, scrollLeft: containerRef.current?.scrollLeft ?? 0, scrollTop: containerRef.current?.scrollTop ?? 0 };
    });
  };
  const inspectKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setInspection(null); return; }
    if (event.target !== canvasRef.current || !dataRef.current.length) return;
    const data = dataRef.current;
    const current = inspection ? data.findIndex(item => item.id === inspection.datum.id) : -1;
    let index: number;
    switch (event.key) {
      case "ArrowRight": case "ArrowDown": index = Math.min(data.length - 1, current + 1); break;
      case "ArrowLeft": case "ArrowUp": index = current < 0 ? data.length - 1 : Math.max(0, current - 1); break;
      case "Home": index = 0; break;
      case "End": index = data.length - 1; break;
      case "Enter": case " ": index = Math.max(0, current); break;
      default: return;
    }
    event.preventDefault();
    const datum = data[index];
    const container = containerRef.current;
    if (container) {
      if (datum.horizontal < container.scrollLeft || datum.horizontal > container.scrollLeft + container.clientWidth) container.scrollLeft = Math.max(0, datum.horizontal - container.clientWidth / 2);
      if (datum.vertical < container.scrollTop || datum.vertical > container.scrollTop + container.clientHeight) container.scrollTop = Math.max(0, datum.vertical - container.clientHeight / 2);
    }
    setInspection({ datum, candidates: findGraphData(data, datum.horizontal, datum.vertical), pinned: true, graphKey, size, themeVersion, scrollLeft: container?.scrollLeft ?? 0, scrollTop: container?.scrollTop ?? 0 });
  };

  useEffect(() => {
    if (!inspection?.pinned) return;
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !containerRef.current?.contains(event.target)) setInspection(null);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [inspection?.pinned]);
  let legend: Array<{ name: string; color: string }> = [];
  try {
    if (spec.chart_type === "lines") {
      const data = JSON.parse(spec.data_json) as { series?: Array<{ name?: string; color?: string }> };
      if (Array.isArray(data.series)) legend = data.series.map((series, index) => ({ name: series.name || `Series ${index + 1}`, color: series.color || COLORS[index % COLORS.length] }));
    }
  } catch {}

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(([entry]) => {
      const width = Math.max(0, Math.floor(entry.contentRect.width));
      const height = Math.max(0, Math.floor(entry.contentRect.height));
      setSize(previous => previous.width === width && previous.height === height ? previous : { width, height });
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // Re-draw when the html.dark class toggles.
  useEffect(() => {
    const el = document.documentElement;
    const obs = new MutationObserver(() => {
      setThemeVersion((v) => v + 1);
    });
    obs.observe(el, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);

  useLayoutEffect(() => {
    const previous = drawingRef.current;
    if (previous?.graphKey === graphKey && previous.size === size && previous.themeVersion === themeVersion) return;
    drawingRef.current = { graphKey, size, themeVersion };
    dataRef.current = [];
    if (renderedSpecRef.current !== spec) {
      setError(null);
      reportedRef.current = false;
      renderedSpecRef.current = spec;
    }
    const reportError = (msg: string) => {
      setError(msg);
      if (!reportedRef.current) {
        reportedRef.current = true;
        onRuntimeError?.(msg);
      }
    };
    const c = canvasRef.current;
    const cont = containerRef.current;
    if (!c || !cont) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;

    if (!size.width || !size.height) return;

    type Pt = [number, number];
    type Series = { name?: string; color: string; points: Pt[] };

    const series: Series[] = [];

    try {
      let data: Record<string, unknown> = {};
      try {
        data = JSON.parse(spec.data_json) as Record<string, unknown>;
      } catch (parseErr) {
        throw new Error(`Could not parse graph data_json: ${(parseErr as Error).message}`);
      }
      const bars = spec.chart_type === "bars" ? (data.bars as Array<{ label: string; value: number }>) ?? [] : [];
      ctx.font = "11px ui-sans-serif, system-ui";
      const barLayout = spec.chart_type === "bars" ? barChartLayout({ labels: bars.map(bar => bar.label), values: bars.map(bar => bar.value), width: size.width, height: size.height, xLabel: spec.x_label || "", yLabel: spec.y_label || "" }, text => ctx.measureText(text).width) : null;
      const dpr = Math.min(window.devicePixelRatio, 2);
      const W = barLayout?.width ?? size.width;
      const H = barLayout?.height ?? size.height;
      c.width = W * dpr;
      c.height = H * dpr;
      c.style.width = `${W}px`;
      c.style.height = `${H}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const isDark = document.documentElement.classList.contains("dark");
      const ink = isDark ? "#d4d4d8" : "#2a2c33";
      const inkMuted = isDark ? "#a1a1aa" : "#6b6e78";
      ctx.fillStyle = isDark ? "#1a1a1f" : "#ffffff";
      ctx.fillRect(0, 0, W, H);
      const padL = barLayout?.left ?? 50;
      const padR = barLayout?.right ?? 20;
      const padT = barLayout?.top ?? 20;
      const padB = barLayout?.bottom ?? 40;
      const plotW = W - padL - padR;
      const plotH = H - padT - padB;
      if (spec.chart_type === "function") {
        const fn = safeFn((data.fn as string) || "x");
        const xMin = (data.x_min as number) ?? -5;
        const xMax = (data.x_max as number) ?? 5;
        const samples = Math.max(20, Math.min(2000, (data.samples as number) ?? 200));
        const pts: Pt[] = [];
        for (let i = 0; i <= samples; i++) {
          const x = xMin + ((xMax - xMin) * i) / samples;
          const y = fn(x);
          if (Number.isFinite(y)) pts.push([x, y]);
        }
        series.push({ color: COLORS[0], points: pts, name: spec.title });
      } else if (spec.chart_type === "points") {
        const pts = (data.points as Pt[]) ?? [];
        series.push({ color: COLORS[0], points: pts, name: spec.title });
      } else if (spec.chart_type === "lines") {
        const ss = (data.series as Array<{ name: string; color?: string; points: Pt[] }>) ?? [];
        ss.forEach((s, i) => series.push({ name: s.name, color: s.color || COLORS[i % COLORS.length], points: s.points }));
      } else if (spec.chart_type === "bars" && barLayout) {
        // draw bars directly
        const maxV = Math.max(...bars.map((b) => b.value), 1);
        const bw = barLayout.slotWidth * 0.7;
        const gap = barLayout.slotWidth * 0.3;
        ctx.font = "11px ui-sans-serif, system-ui";
        ctx.textAlign = "center";
        bars.forEach((b, i) => {
          const x = padL + i * (bw + gap) + gap / 2;
          const h = (b.value / maxV) * plotH;
          const y = padT + plotH - h;
          dataRef.current.push({ id: dataRef.current.length, series: b.label, color: COLORS[i % COLORS.length], horizontal: x + bw / 2, vertical: y, xValue: b.label, yValue: b.value, bounds: { left: x, top: Math.min(y, padT + plotH), width: bw, height: Math.abs(h) } });
          ctx.fillStyle = COLORS[i % COLORS.length];
          ctx.fillRect(x, y, bw, h);
          ctx.fillStyle = ink;
          ctx.textBaseline = "top";
          barLayout.labels[i].forEach((line, lineIndex) => ctx.fillText(line, x + bw / 2, barLayout.labelY + lineIndex * barLayout.lineHeight));
          ctx.fillStyle = inkMuted;
          ctx.textBaseline = "bottom";
          ctx.fillText(String(b.value), x + bw / 2, y - 6);
        });
        // axis labels
        ctx.textAlign = "center";
        ctx.fillStyle = inkMuted;
        ctx.textBaseline = "top";
        barLayout.xAxisLines.forEach((line, index) => ctx.fillText(line, padL + plotW / 2, barLayout.xAxisY + index * barLayout.lineHeight));
        ctx.save();
        ctx.translate(14, padT + plotH / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.textBaseline = "middle";
        barLayout.yAxisLines.forEach((line, index) => ctx.fillText(line, 0, index * barLayout.lineHeight));
        ctx.restore();
        return;
      }

      // For non-bar charts: compute extents from all series.
      const allPts = series.flatMap((s) => s.points);
      if (!allPts.length) {
        ctx.fillStyle = isDark ? "#f87171" : "#9f1f3a";
        ctx.fillText("No data points", 20, 40);
        return;
      }
      const xs = allPts.map((p) => p[0]);
      const ys = allPts.map((p) => p[1]);
      let xMin = Math.min(...xs);
      let xMax = Math.max(...xs);
      let yMin = Math.min(...ys);
      let yMax = Math.max(...ys);
      if (xMin === xMax) {
        xMin -= 1;
        xMax += 1;
      }
      if (yMin === yMax) {
        yMin -= 1;
        yMax += 1;
      }
      // Pad y range a touch.
      const padY = (yMax - yMin) * 0.07;
      yMin -= padY;
      yMax += padY;

      const sx = (x: number) => padL + ((x - xMin) / (xMax - xMin)) * plotW;
      const sy = (y: number) => padT + plotH - ((y - yMin) / (yMax - yMin)) * plotH;

      for (const [index, item] of series.entries()) {
        for (const [horizontal, vertical] of item.points) {
          dataRef.current.push({ id: dataRef.current.length, series: item.name || `Series ${index + 1}`, color: item.color, horizontal: sx(horizontal), vertical: sy(vertical), xValue: horizontal, yValue: vertical });
        }
      }

      // Grid + axes
      ctx.strokeStyle = isDark ? "rgba(238,238,242,0.1)" : "rgba(20,22,26,0.08)";
      ctx.lineWidth = 1;
      ctx.font = "10px ui-sans-serif, system-ui";
      ctx.fillStyle = inkMuted;
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      const yTicks = 5;
      for (let i = 0; i <= yTicks; i++) {
        const y = yMin + ((yMax - yMin) * i) / yTicks;
        const py = sy(y);
        ctx.beginPath();
        ctx.moveTo(padL, py);
        ctx.lineTo(padL + plotW, py);
        ctx.stroke();
        ctx.fillText(y.toFixed(Math.abs(y) < 10 ? 2 : 0), padL - 6, py);
      }
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      const xTicks = 6;
      for (let i = 0; i <= xTicks; i++) {
        const x = xMin + ((xMax - xMin) * i) / xTicks;
        const px = sx(x);
        ctx.beginPath();
        ctx.moveTo(px, padT);
        ctx.lineTo(px, padT + plotH);
        ctx.stroke();
        ctx.fillText(x.toFixed(Math.abs(x) < 10 ? 2 : 0), px, padT + plotH + 4);
      }

      // Origin axes
      if (xMin <= 0 && xMax >= 0) {
        ctx.strokeStyle = isDark ? "rgba(238,238,242,0.3)" : "rgba(20,22,26,0.22)";
        ctx.beginPath();
        ctx.moveTo(sx(0), padT);
        ctx.lineTo(sx(0), padT + plotH);
        ctx.stroke();
      }
      if (yMin <= 0 && yMax >= 0) {
        ctx.strokeStyle = isDark ? "rgba(238,238,242,0.3)" : "rgba(20,22,26,0.22)";
        ctx.beginPath();
        ctx.moveTo(padL, sy(0));
        ctx.lineTo(padL + plotW, sy(0));
        ctx.stroke();
      }

      // Series
      series.forEach((s) => {
        ctx.strokeStyle = s.color;
        ctx.fillStyle = s.color;
        ctx.lineWidth = 2;
        if (spec.chart_type === "points") {
          for (const [px, py] of s.points) {
            ctx.beginPath();
            ctx.arc(sx(px), sy(py), 3, 0, Math.PI * 2);
            ctx.fill();
          }
        } else {
          ctx.beginPath();
          s.points.forEach(([px, py], i) => {
            const X = sx(px);
            const Y = sy(py);
            if (i === 0) ctx.moveTo(X, Y);
            else ctx.lineTo(X, Y);
          });
          ctx.stroke();
        }
      });

      if (spec.chart_type === "lines") {
        ctx.strokeStyle = isDark ? "#1a1a1f" : "#ffffff";
        ctx.lineWidth = 1.25;
        for (const item of series) {
          ctx.fillStyle = item.color;
          for (const [horizontal, vertical] of item.points) {
            ctx.beginPath();
            ctx.arc(sx(horizontal), sy(vertical), 3, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
          }
        }
      }

      // Axis labels
      ctx.fillStyle = inkMuted;
      ctx.font = "11px ui-sans-serif, system-ui";
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillText(spec.x_label || "x", padL + plotW / 2, H - 8);
      ctx.save();
      ctx.translate(14, padT + plotH / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.textBaseline = "middle";
      ctx.fillText(spec.y_label || "y", 0, 0);
      ctx.restore();
    } catch (e) {
      dataRef.current = [];
      ctx.clearRect(0, 0, c.width, c.height);
      console.warn("graph render threw (will be reported for repair):", e);
      reportError(`Graph render failed: ${(e as Error).message}`);
    }
    // onRuntimeError captured by closure; we don't re-render the chart on
    // every parent rerender that produces a new function reference.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec, graphKey, themeVersion, size]);

  return (
    <div className="flex h-full w-full min-h-0 min-w-0 flex-col">
      {!error && legend.length > 1 && <section aria-label="Graph legend" tabIndex={0} className="max-h-[32%] min-h-0 shrink-0 overflow-auto border-b border-[var(--border-subtle)] bg-[var(--surface-raised)] px-3 py-2 focus-visible:outline focus-visible:outline-[var(--accent-500)]">
        <ul aria-label="Graph series" className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,16rem),1fr))] gap-x-4 gap-y-2 font-sans text-[11px] leading-4 text-[var(--ink-700)]">
          {legend.map((series, index) => <li key={index} className="flex min-w-0 items-start gap-2">
            <span aria-hidden="true" className="mt-1 h-2 w-[18px] shrink-0" style={{ backgroundColor: series.color }} />
            <span title={series.name} className="min-w-0 [overflow-wrap:anywhere]">{series.name}</span>
          </li>)}
        </ul>
      </section>}
      <div ref={containerRef} role="region" aria-label="Graph scroll area" tabIndex={0} onKeyDown={inspectKey} onScroll={event => { const { scrollLeft, scrollTop } = event.currentTarget; setInspection(previous => previous?.scrollLeft === scrollLeft && previous.scrollTop === scrollTop ? previous : null); }} onPointerLeave={() => setInspection(previous => previous?.pinned ? previous : null)} className={`relative min-h-0 w-full min-w-0 flex-1 ${spec.chart_type === "bars" ? "overflow-auto" : "overflow-hidden"} focus-visible:outline focus-visible:outline-[var(--accent-500)]`}>
      <canvas ref={canvasRef} data-testid="graph-canvas" role="img" tabIndex={0} aria-label={`${spec.title} chart`} aria-describedby={inspection ? tooltipId : undefined} aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown Home End Enter Escape" onPointerMove={event => { if (event.pointerType !== "touch") inspectAt(event.clientX, event.clientY, false); }} onClick={event => inspectAt(event.clientX, event.clientY, true)} onBlur={event => { if (!containerRef.current?.contains(event.relatedTarget as Node | null)) setInspection(null); }} className={`block focus-visible:outline focus-visible:outline-[var(--accent-500)] ${inspection ? "cursor-crosshair" : ""}`} />
      {inspection && <>
        <span aria-hidden="true" className="pointer-events-none absolute h-3 w-3 rounded-full border-2 border-[var(--ink-900)]" style={{ left: inspection.datum.horizontal - 6, top: inspection.datum.vertical - 6 }} />
        <GraphPointTooltip id={tooltipId} datum={inspection.datum} candidates={inspection.candidates} pinned={inspection.pinned} containerRef={containerRef} viewport={size} xLabel={spec.x_label} yLabel={spec.y_label} onSelect={datum => setInspection(previous => previous ? { ...previous, datum } : null)} onPin={() => setInspection(previous => previous ? { ...previous, pinned: true } : null)} onClose={() => { setInspection(null); canvasRef.current?.focus({ preventScroll: true }); }} />
      </>}
      {error && (
        <div className="absolute bottom-3 left-3 right-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-300">
          {error}
        </div>
      )}
      </div>
    </div>
  );
}
