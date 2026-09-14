"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Pause, Play, RotateCcw } from "lucide-react";
import type { InteractiveSpec } from "@/lib/interactive-viz";

const colors = {
  neutral: { fill: "var(--surface-raised)", stroke: "var(--border-subtle)" },
  active: { fill: "var(--tag-sky-bg)", stroke: "var(--tag-sky-fg)" },
  complete: { fill: "var(--tag-emerald-bg)", stroke: "var(--tag-emerald-fg)" },
  warning: { fill: "var(--tag-amber-bg)", stroke: "var(--tag-amber-fg)" },
};

export default function InteractiveView({ spec }: { spec: InteractiveSpec }) {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const step = spec.steps[index];
  const last = spec.steps.length - 1;
  useEffect(() => {
    if (!playing || index === last) return;
    const timer = setInterval(() => {
      setIndex(current => {
        if (current >= last) return current;
        return current + 1;
      });
    }, 2000 / speed);
    return () => clearInterval(timer);
  }, [playing, speed, last, index]);
  const move = (next: number) => { setPlaying(false); setIndex(Math.max(0, Math.min(last, next))); setSelected(null); };
  const item = step.items.find(value => value.id === selected);
  const columns = Math.max(...spec.steps.flatMap(value => value.items.map(node => node.column))) + 1;
  const rows = Math.max(...spec.steps.flatMap(value => value.items.map(node => node.row))) + 1;
  const position = (id: string) => step.items.find(node => node.id === id)!;
  const buttonClass = "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded border border-[var(--border-subtle)] hover:bg-[var(--surface-sunken)] disabled:opacity-40";

  return <div className="flex h-full min-h-0 flex-col text-[var(--ink-900)]" data-testid="interactive-lesson">
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--border-subtle)] px-3 py-2">
      <button className={buttonClass} title="First step" aria-label="First step" onClick={() => move(0)}><RotateCcw size={15} /></button>
      <button className={buttonClass} title="Previous step" aria-label="Previous step" disabled={index === 0} onClick={() => move(index - 1)}><ChevronLeft size={17} /></button>
      <button className={buttonClass} title={playing && index < last ? "Pause lesson" : "Play lesson"} aria-label={playing && index < last ? "Pause lesson" : "Play lesson"} onClick={() => {
        if (index === last) { setIndex(0); setPlaying(true); }
        else setPlaying(!playing);
      }}>{playing && index < last ? <Pause size={15} /> : <Play size={15} />}</button>
      <button className={buttonClass} title="Next step" aria-label="Next step" disabled={index === last} onClick={() => move(index + 1)}><ChevronRight size={17} /></button>
      <span className="w-20 text-center text-xs tabular-nums" aria-live="polite">{index + 1} / {spec.steps.length}</span>
      <select aria-label="Lesson playback speed" className="h-8 rounded border border-[var(--border-subtle)] bg-[var(--surface-raised)] px-1 text-xs" value={speed} onChange={event => setSpeed(Number(event.target.value))}><option value={0.5}>0.5x</option><option value={1}>1x</option><option value={2}>2x</option></select>
      <input className="min-w-24 flex-1" type="range" min={0} max={last} value={index} aria-label="Lesson step" onChange={event => move(Number(event.target.value))} />
    </div>
    <div className="min-h-0 flex-1 overflow-auto p-3">
      <h3 className="text-sm font-semibold" data-testid="step-title">{step.title}</h3>
      <p className="mt-1 break-words text-xs leading-relaxed text-[var(--ink-700)]">{step.explanation}</p>
      <div className="my-3 overflow-x-auto" tabIndex={0} aria-label="Step diagram">
        <svg role="img" aria-label={`${step.title} diagram`} viewBox={`0 0 ${columns * 170} ${rows * 116}`} className="w-full" style={{ minWidth: columns > 2 ? 420 : 240, maxHeight: 380 }}>
          {step.links.map((link, linkIndex) => {
            const from = position(link.from); const to = position(link.to);
            const startX = from.column * 170 + 85; const startY = from.row * 116 + 55;
            const endX = to.column * 170 + 85; const endY = to.row * 116 + 55;
            return <line key={linkIndex} x1={startX} y1={startY} x2={endX} y2={endY} stroke="var(--ink-400)" strokeWidth={2} />;
          })}
          {step.items.map(node => <g key={node.id}>
            <rect x={node.column * 170 + 8} y={node.row * 116 + 8} width={154} height={88} rx={5} fill={colors[node.state].fill} stroke={selected === node.id ? "var(--ink-900)" : colors[node.state].stroke} strokeWidth={2} />
            <foreignObject x={node.column * 170 + 12} y={node.row * 116 + 12} width={146} height={80}>
              <button aria-label={`Inspect ${node.label}`} onClick={() => setSelected(node.id)} className="flex h-full w-full flex-col items-center justify-center gap-1 overflow-hidden px-1 text-center" style={{ fontSize: node.label.length + node.value.length > 48 ? 11 : 13, lineHeight: "15px", overflowWrap: "anywhere" }}><strong>{node.label}</strong><span>{node.value}</span></button>
            </foreignObject>
          </g>)}
        </svg>
      </div>
      {item && <p role="status" className="mb-2 break-words text-xs">{item.label}: {item.value} ({item.state})</p>}
      {step.links.length > 0 && <ul className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--ink-500)]">{step.links.map((link, linkIndex) => <li key={linkIndex}>{position(link.from).label} &rarr; {position(link.to).label}{link.label ? `: ${link.label}` : ""}</li>)}</ul>}
      {step.variables.length > 0 && <dl className="mb-3 grid grid-cols-2 gap-x-4 gap-y-1 border-y border-[var(--border-subtle)] py-2 text-xs">{step.variables.map((variable, variableIndex) => <div className="min-w-0" key={variableIndex}><dt className="text-[var(--ink-500)]">{variable.name}</dt><dd className="break-words font-mono">{variable.value}</dd></div>)}</dl>}
      <ol className="overflow-x-auto font-mono text-xs leading-6" aria-label="Algorithm pseudocode">{spec.code.map((line, lineIndex) => <li key={lineIndex} aria-current={step.line === lineIndex + 1 ? "step" : undefined} className={`flex gap-2 rounded px-2 ${step.line === lineIndex + 1 ? "bg-[var(--tag-sky-bg)] text-[var(--tag-sky-fg)]" : "text-[var(--ink-500)]"}`}><span className="w-5 shrink-0 text-right tabular-nums">{lineIndex + 1}</span><code className="whitespace-pre-wrap break-words">{line}</code></li>)}</ol>
    </div>
  </div>;
}