"use client";

import { useEffect, useRef, useState } from "react";
import { compileFn } from "@/lib/viz-runtime";
import type { TwoDAnimSpec } from "@/lib/schemas";
import { Pause, Play, RotateCcw } from "lucide-react";

type Props = {
  spec: TwoDAnimSpec;
  /** Called once per spec instance if setup or any draw frame throws. */
  onRuntimeError?: (message: string) => void;
};

export default function TwoDAnimView({ spec, onRuntimeError }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reportedRef = useRef(false);
  const playback = useRef({ playing: true, speed: 1 });
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [restart, setRestart] = useState(0);

  useEffect(() => {
    setError(null);
    reportedRef.current = false;
    const reportError = (msg: string) => {
      setError(msg);
      if (!reportedRef.current) {
        reportedRef.current = true;
        onRuntimeError?.(msg);
      }
    };
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    type DrawFn = (
      ctx: CanvasRenderingContext2D,
      w: number,
      h: number,
      t: number,
      dt: number,
    ) => void;
    let drawCb: DrawFn | null = null;
    let lastT = performance.now();
    let raf = 0;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio, 2);
      const w = container.clientWidth;
      const h = container.clientHeight;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();

    try {
      const fn = compileFn(spec.setup_code);
      const ret = fn({ ctx, width: container.clientWidth, height: container.clientHeight }) as
        | { draw?: DrawFn }
        | undefined;
      if (ret && typeof ret.draw === "function") drawCb = ret.draw;
      else throw new Error("Animation must return a draw function.");
    } catch (e) {
      // warn (not error) — Next.js dev overlay treats console.error as
      // an "Issue". The orchestrator handles retries.
      console.warn("2D anim setup threw (will be reported for repair):", e);
      reportError(`Animation crashed at setup: ${(e as Error).message}`);
    }

    // Contract: `time` and `dt` are in SECONDS (the generator prompt states this
    // explicitly). A spec that wrongly treats them as milliseconds appears
    // frozen — regenerate it (the prompt fix makes the new spec correct).
    let elapsed = 0;
    let firstFrame = true;
    const tick = (now: number) => {
      const dt = playback.current.playing ? Math.min((now - lastT) / 1000, 0.1) * playback.current.speed : 0;
      lastT = now;
      elapsed += dt;
      try {
        if (playback.current.playing || firstFrame) drawCb?.(ctx, container.clientWidth, container.clientHeight, elapsed, dt);
        firstFrame = false;
      } catch (e) {
        console.warn("2D anim draw threw (will be reported for repair):", e);
        reportError(`Animation crashed mid-frame: ${(e as Error).message}`);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    const ro = new ResizeObserver(() => { resize(); firstFrame = true; });
    ro.observe(container);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
    // onRuntimeError captured by closure; we don't want to remount on every
    // parent re-render that produces a new function reference.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec.setup_code, restart]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border-subtle)] px-3 py-2 text-[var(--ink-900)]">
        <button className="tab-icon-btn" aria-label={playing ? "Pause animation" : "Play animation"} title={playing ? "Pause animation" : "Play animation"} onClick={() => { playback.current.playing = !playing; setPlaying(!playing); }}>{playing ? <Pause size={16} /> : <Play size={16} />}</button>
        <button className="tab-icon-btn" aria-label="Restart animation" title="Restart animation" onClick={() => setRestart(value => value + 1)}><RotateCcw size={16} /></button>
        <select aria-label="Animation speed" value={speed} onChange={event => { const next = Number(event.target.value); playback.current.speed = next; setSpeed(next); }} className="rounded border border-[var(--border-subtle)] bg-[var(--surface-raised)] px-2 py-1 text-xs"><option value={0.5}>0.5x</option><option value={1}>1x</option><option value={2}>2x</option></select>
      </div>
    <div ref={containerRef} className="relative min-h-0 flex-1 w-full">
      <canvas ref={canvasRef} className="h-full w-full" />
      {error && (
        <div className="absolute bottom-3 left-3 right-3 rounded-md border border-[var(--feedback-wrong-border)] bg-[var(--feedback-wrong-bg)] px-3 py-2 text-xs text-[var(--feedback-wrong-text)]">
          {error}
        </div>
      )}
    </div>
    </div>
  );
}
