"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { Pause, Play, RotateCcw, RotateCw, X } from "lucide-react";
import { compileFn } from "@/lib/viz-runtime";
import type { ThreeDSpec } from "@/lib/schemas";
import { fitSceneDistance } from "@/lib/viz-framing";
import { createSceneClock, describeThreePart, inspectableObject, type ThreePart } from "@/lib/three-inspection";

type Props = {
  spec: ThreeDSpec;
  /** Called once per spec instance if the scene crashes (setup or update). */
  onRuntimeError?: (message: string) => void;
};

export default function ThreeDView({ spec, onRuntimeError }: Props) {
  return <ThreeDScene key={spec.setup_code} spec={spec} onRuntimeError={onRuntimeError} />;
}

function ThreeDScene({ spec, onRuntimeError }: Props) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reportedRef = useRef(false);
  const engineRef = useRef<{ rotate: () => void; animate: () => void; reset: () => void; select: (id: number) => void; clear: () => void } | null>(null);
  const [motion, setMotion] = useState({ rotating: true, playing: true, animated: false, ready: false });
  const [parts, setParts] = useState<ThreePart[]>([]);
  const [inspection, setInspection] = useState<{ part: ThreePart; pinned: boolean } | null>(null);

  useEffect(() => {
    reportedRef.current = false;
    const reportError = (msg: string) => {
      setError(msg);
      if (!reportedRef.current) {
        reportedRef.current = true;
        onRuntimeError?.(msg);
      }
    };
    const mount = mountRef.current;
    if (!mount) return;

    const width = Math.max(1, Math.floor(mount.getBoundingClientRect().width));
    const height = Math.max(1, Math.floor(mount.getBoundingClientRect().height));

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.domElement.setAttribute("role", "img");
    renderer.domElement.setAttribute("aria-label", "3D visualization");
    renderer.domElement.tabIndex = 0;
    renderer.domElement.style.display = "block";
    renderer.domElement.style.touchAction = "none";
    renderer.domElement.setAttribute("aria-keyshortcuts", "ArrowLeft ArrowRight ArrowUp ArrowDown Home Escape");
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    const isDark = document.documentElement.classList.contains("dark");
    renderer.setClearColor(isDark ? "#1a1a1f" : "#ffffff", 1);
    rendererRef.current = renderer;
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, width / height, 0.05, 200);
    camera.position.set(0, 1.5, 4);

    const group = new THREE.Group();
    scene.add(group);

    let isDragging = false;
    let pointerId: number | null = null;
    let downX = 0;
    let downY = 0;
    let lastX = 0;
    let lastY = 0;
    let yaw = 0;
    let pitch = 0;
    let rotating = true;
    let playing = true;
    let camDist = 4;
    let fittedDistance = 4;
    let sceneRadius = 1;
    let updateCb: ((t: number) => void) | null = null;
    let selected: THREE.Object3D | null = null;
    let pinned = false;
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const selectionBox = new THREE.Box3Helper(new THREE.Box3(), new THREE.Color("#e6a700"));
    selectionBox.visible = false;
    selectionBox.userData.inspectable = false;
    for (const material of Array.isArray(selectionBox.material) ? selectionBox.material : [selectionBox.material]) {
      material.depthTest = false;
      material.transparent = true;
    }
    selectionBox.renderOrder = 1000;
    const publishMotion = () => setMotion({ rotating, playing, animated: !!updateCb, ready: true });
    const showPart = (object: THREE.Object3D | null, pin: boolean) => {
      const resolved = object ? describeThreePart(object) : null;
      if (selected === resolved?.object && pinned === pin) return;
      selected = resolved?.object ?? null;
      pinned = !!selected && pin;
      if (selected && pinned) { rotating = false; publishMotion(); }
      selectionBox.visible = !!selected;
      setInspection(resolved ? { part: resolved.part, pinned } : null);
    };
    const pick = (event: PointerEvent) => {
      const bounds = renderer.domElement.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return null;
      pointer.set((event.clientX - bounds.left) / bounds.width * 2 - 1, -(event.clientY - bounds.top) / bounds.height * 2 + 1);
      scene.updateMatrixWorld(true);
      camera.updateMatrixWorld(true);
      raycaster.setFromCamera(pointer, camera);
      return raycaster.intersectObjects(scene.children, true).find(hit => inspectableObject(hit.object))?.object ?? null;
    };
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 || pointerId !== null) return;
      pointerId = e.pointerId;
      isDragging = false;
      downX = e.clientX;
      downY = e.clientY;
      lastX = e.clientX;
      lastY = e.clientY;
      renderer.domElement.focus({ preventScroll: true });
      mount.setPointerCapture?.(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (pointerId === null) {
        if (!pinned && e.pointerType !== "touch") showPart(pick(e), false);
        return;
      }
      if (e.pointerId !== pointerId) return;
      if (!isDragging && Math.hypot(e.clientX - downX, e.clientY - downY) <= 5) return;
      if (!isDragging) { isDragging = true; rotating = false; publishMotion(); showPart(null, false); }
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      yaw -= dx * 0.005;
      pitch -= dy * 0.005;
      pitch = Math.max(-1.2, Math.min(1.2, pitch));
    };
    const onUp = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      if (!isDragging) {
        const object = pick(e);
        const target = object ? describeThreePart(object).object : null;
        showPart(pinned && target === selected ? null : object, true);
      }
      pointerId = null;
      isDragging = false;
      if (mount.hasPointerCapture(e.pointerId)) mount.releasePointerCapture(e.pointerId);
    };
    const onCancel = () => { pointerId = null; isDragging = false; };
    const onLeave = () => { if (!pinned && pointerId === null) showPart(null, false); };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      rotating = false;
      publishMotion();
      camDist *= Math.exp(Math.max(-1, Math.min(1, e.deltaY * 0.001)));
      camDist = Math.max(fittedDistance * 0.25, Math.min(fittedDistance * 5, camDist));
    };
    const reset = () => { yaw = 0; pitch = 0; camDist = fittedDistance; showPart(null, false); };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { showPart(null, false); event.preventDefault(); event.stopPropagation(); return; }
      if (event.key === "Home") { reset(); event.preventDefault(); return; }
      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
      event.preventDefault(); rotating = false; publishMotion();
      if (event.key === "ArrowLeft") yaw += 0.12;
      if (event.key === "ArrowRight") yaw -= 0.12;
      if (event.key === "ArrowUp") pitch = Math.min(1.2, pitch + 0.12);
      if (event.key === "ArrowDown") pitch = Math.max(-1.2, pitch - 0.12);
    };
    mount.addEventListener("pointerdown", onDown);
    mount.addEventListener("pointermove", onMove);
    mount.addEventListener("pointerup", onUp);
    mount.addEventListener("pointercancel", onCancel);
    mount.addEventListener("lostpointercapture", onCancel);
    mount.addEventListener("pointerleave", onLeave);
    mount.addEventListener("wheel", onWheel, { passive: false });
    renderer.domElement.addEventListener("keydown", onKey);

    // Stub OrbitControls-shaped object so model code that touches
    // controls.target / controls.update() etc. doesn't crash. Our own orbit
    // implementation handles camera movement instead.
    const controlsStub = {
      target: new THREE.Vector3(0, 0, 0),
      update: () => {},
      enableDamping: false,
      autoRotate: false,
      enableZoom: false,
      enablePan: false,
      enableRotate: false,
      addEventListener: () => {},
      removeEventListener: () => {},
      dispose: () => {},
    };
    try {
      const fn = compileFn(spec.setup_code);
      const ret = fn({ THREE, scene, camera, renderer, controls: controlsStub, group }) as
        | { update?: (t: number) => void }
        | undefined;
      if (ret && typeof ret.update === "function") updateCb = ret.update;
    } catch (e) {
      // Use warn (not error) so Next.js dev overlay doesn't surface the
      // crash as an Issue — the orchestrator handles retries.
      console.warn("3D setup error (will be reported for repair):", e);
      reportError(`3D scene crashed: ${(e as Error).message}`);
    }

    // Auto-derive a reasonable initial framing from the group bbox.
    try {
      const bbox = new THREE.Box3().setFromObject(group);
      if (bbox.isEmpty() === false) {
        const size = new THREE.Vector3();
        const center = new THREE.Vector3();
        bbox.getSize(size);
        bbox.getCenter(center);
        sceneRadius = size.length() / 2 + 0.1;
        fittedDistance = fitSceneDistance(sceneRadius, camera.fov, camera.aspect);
        camDist = fittedDistance;
        camera.far = Math.max(200, fittedDistance * 10);
        camera.updateProjectionMatrix();
        // Re-center the group so orbit looks natural.
        group.position.sub(center);
      }
    } catch {
      /* ignore */
    }

    const objects = new Map<number, THREE.Object3D>();
    scene.traverse(object => {
      if (!(object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Points || object instanceof THREE.Sprite) || !inspectableObject(object)) return;
      const resolved = describeThreePart(object);
      objects.set(resolved.object.id, resolved.object);
    });
    scene.add(selectionBox);
    engineRef.current = {
      rotate: () => { rotating = !rotating; publishMotion(); },
      animate: () => { playing = !playing; publishMotion(); },
      reset,
      select: id => { const object = objects.get(id); showPart(object && inspectableObject(object) ? object : null, true); },
      clear: () => showPart(null, false),
    };
    const readyFrame = requestAnimationFrame(() => {
      setParts([...objects.values()].map(object => describeThreePart(object).part));
      publishMotion();
    });
    let raf = 0;
    const clock = createSceneClock();
    let initialUpdate = true;
    const animate = () => {
      const { elapsed, delta } = clock.tick(performance.now(), playing);
      if (rotating && pointerId === null) yaw += delta * 0.25;
      const cy = Math.cos(pitch);
      camera.position.set(
        Math.sin(yaw) * cy * camDist,
        Math.sin(pitch) * camDist + 0.3,
        Math.cos(yaw) * cy * camDist,
      );
      camera.lookAt(0, 0, 0);
      try {
        if (playing || initialUpdate) updateCb?.(elapsed);
        initialUpdate = false;
      } catch (e) {
        console.warn("3D update threw (will be reported for repair):", e);
        reportError(`3D scene update threw: ${(e as Error).message}`);
        cancelAnimationFrame(raf);
        return; // stop the loop; orchestrator will swap the spec out
      }
      if (selected) {
        if (!inspectableObject(selected) || !scene.getObjectById(selected.id)) showPart(null, false);
        else {
          selectionBox.box.setFromObject(selected);
          selectionBox.visible = !selectionBox.box.isEmpty();
        }
      }
      renderer.render(scene, camera);
      raf = requestAnimationFrame(animate);
    };
    animate();

    // Catch "silent" failures: setup_code that runs without throwing but
    // never adds anything visible to the scene (e.g. objects added to a
    // local variable instead of the provided `group`/`scene`). A scene with
    // no renderable objects draws a blank canvas with no error — report it
    // so the repair path can regenerate the spec.
    const blankCheck = window.setTimeout(() => {
      if (reportedRef.current) return;
      let renderable = 0;
      scene.traverse((obj) => {
        if (
          obj !== selectionBox && (obj instanceof THREE.Mesh ||
          obj instanceof THREE.Line ||
          obj instanceof THREE.Points ||
          obj instanceof THREE.Sprite)
        ) {
          renderable++;
        }
      });
      if (renderable === 0) {
        reportError(
          "3D scene rendered nothing — the generated code added no visible objects.",
        );
      }
    }, 900);

    const onResize = () => {
      const w = Math.floor(mount.getBoundingClientRect().width);
      const h = Math.floor(mount.getBoundingClientRect().height);
      if (!w || !h) return;
      renderer.setSize(w, h);
      const zoom = camDist / fittedDistance;
      camera.aspect = w / h;
      fittedDistance = fitSceneDistance(sceneRadius, camera.fov, camera.aspect);
      camDist = fittedDistance * zoom;
      camera.far = Math.max(200, fittedDistance * 10);
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(onResize);
    ro.observe(mount);

    return () => {
      cancelAnimationFrame(readyFrame);
      cancelAnimationFrame(raf);
      clearTimeout(blankCheck);
      ro.disconnect();
      engineRef.current = null;
      rendererRef.current = null;
      mount.removeEventListener("pointerdown", onDown);
      mount.removeEventListener("pointermove", onMove);
      mount.removeEventListener("pointerup", onUp);
      mount.removeEventListener("pointercancel", onCancel);
      mount.removeEventListener("lostpointercapture", onCancel);
      mount.removeEventListener("pointerleave", onLeave);
      mount.removeEventListener("wheel", onWheel);
      renderer.domElement.removeEventListener("keydown", onKey);
      try {
        renderer.dispose();
        if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement);
      } catch {}
      // Dispose of geometries & materials.
      scene.traverse((obj) => {
        if ((obj as THREE.Mesh).geometry) (obj as THREE.Mesh).geometry?.dispose?.();
        const mat = (obj as THREE.Mesh).material;
        if (Array.isArray(mat)) mat.forEach((m) => m?.dispose?.());
        else mat?.dispose?.();
      });
    };
    // We deliberately do not depend on onRuntimeError so a parent re-render
    // doesn't tear down the WebGL context. The ref captures the latest one
    // through closure since it is stable across the spec lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec.setup_code]);

  // Theme reactivity: watch html.dark class and update the renderer clear
  // colour without tearing down the WebGL context.
  useEffect(() => {
    const el = document.documentElement;
    const mo = new MutationObserver(() => {
      const r = rendererRef.current;
      if (!r) return;
      const dark = el.classList.contains("dark");
      r.setClearColor(dark ? "#1a1a1f" : "#ffffff", 1);
    });
    mo.observe(el, { attributes: true, attributeFilter: ["class"] });
    return () => mo.disconnect();
  }, []);

  return (
    <div className="relative h-full w-full min-w-0 overflow-hidden" onKeyDown={event => { if (event.key === "Escape") { engineRef.current?.clear(); event.stopPropagation(); } }}>
      <div ref={mountRef} className="h-full w-full cursor-grab overflow-hidden active:cursor-grabbing" />
      {error && (
        <div className="absolute bottom-3 left-3 right-3 rounded-md border border-[var(--feedback-wrong-border)] bg-[var(--feedback-wrong-bg)] px-3 py-2 text-xs text-[var(--feedback-wrong-text)]">
          {error}
        </div>
      )}
      <div role="group" aria-label="3D controls" className="absolute left-3 right-3 top-3 flex flex-wrap items-center justify-end gap-1.5">
        <select aria-label="3D part" value={inspection?.pinned ? inspection.part.id : ""} disabled={!motion.ready || !!error} onChange={event => { if (event.target.value) engineRef.current?.select(Number(event.target.value)); else engineRef.current?.clear(); }} className="h-8 min-w-0 flex-1 rounded border border-[var(--border-subtle)] bg-[var(--surface-raised)] px-2 text-xs text-[var(--ink-900)]">
          <option value="">Select part</option>
          {parts.map((part, index) => <option key={part.id} value={part.id}>{part.named ? part.label : `Unnamed part ${index + 1}`}</option>)}
        </select>
        <button type="button" title={motion.rotating ? "Pause rotation" : "Resume rotation"} aria-label={motion.rotating ? "Pause rotation" : "Resume rotation"} aria-pressed={motion.rotating} disabled={!motion.ready || !!error} onClick={() => engineRef.current?.rotate()} className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded border border-[var(--border-subtle)] bg-[var(--surface-raised)] text-[var(--ink-700)] disabled:opacity-40"><RotateCw size={16} /></button>
        <button type="button" title={!motion.animated ? "No model animation" : motion.playing ? "Pause model animation" : "Resume model animation"} aria-label={motion.playing ? "Pause model animation" : "Resume model animation"} disabled={!motion.ready || !motion.animated || !!error} onClick={() => engineRef.current?.animate()} className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded border border-[var(--border-subtle)] bg-[var(--surface-raised)] text-[var(--ink-700)] disabled:opacity-40">{motion.playing ? <Pause size={16} /> : <Play size={16} />}</button>
        <button type="button" title="Reset 3D view" aria-label="Reset 3D view" disabled={!motion.ready || !!error} onClick={() => engineRef.current?.reset()} className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded border border-[var(--border-subtle)] bg-[var(--surface-raised)] text-[var(--ink-700)] disabled:opacity-40"><RotateCcw size={16} /></button>
      </div>
      {!error && inspection && <section role={inspection.pinned ? "dialog" : "tooltip"} aria-label={inspection.pinned ? "3D part details" : undefined} className="absolute bottom-3 left-3 max-h-[42%] w-80 max-w-[calc(100%-1.5rem)] space-y-2 overflow-auto rounded-md border border-[var(--border-default)] bg-[var(--surface-raised)] p-3 text-xs text-[var(--ink-900)] shadow-md">
        <div className="flex items-start gap-2"><strong className="min-w-0 flex-1 [overflow-wrap:anywhere]">{inspection.part.label}</strong>{inspection.pinned && <button type="button" aria-label="Close 3D part details" title="Close 3D part details" onClick={() => engineRef.current?.clear()} className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded hover:bg-[var(--surface-sunken)]"><X size={14} /></button>}</div>
        <p className="[overflow-wrap:anywhere]">{inspection.part.description || "No explanation supplied for this part."}</p>
        {inspection.part.description && <p className="text-[var(--ink-500)]">Model-supplied explanation; not independently verified.</p>}
        {inspection.part.illustrative && <p className="text-[var(--ink-500)]">Illustrative model; geometry and values are not measurements.</p>}
        {!!inspection.part.properties.length && <dl className="grid grid-cols-2 gap-x-3 gap-y-1">{inspection.part.properties.map(([key, value]) => <div key={key} className="contents"><dt className="text-[var(--ink-500)] [overflow-wrap:anywhere]">{key}</dt><dd className="[overflow-wrap:anywhere]">{value}</dd></div>)}</dl>}
      </section>}
    </div>
  );
}
