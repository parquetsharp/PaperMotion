import * as THREE from "three";
import { z } from "zod";

const studySchema = z.object({
  label: z.string().trim().min(1).max(160).optional(),
  description: z.string().trim().max(1600).optional(),
  properties: z.record(z.string().max(80), z.union([z.string().max(400), z.number().finite(), z.boolean()])).optional(),
  illustrative: z.boolean().optional(),
});

export type ThreePart = { id: number; label: string; description?: string; properties: Array<[string, string]>; illustrative: boolean; named: boolean };

export function inspectableObject(object: THREE.Object3D): boolean {
  for (let current: THREE.Object3D | null = object; current; current = current.parent) {
    if (!current.visible || current.userData.inspectable === false) return false;
  }
  const material = (object as THREE.Mesh).material;
  if (material) {
    const materials = Array.isArray(material) ? material : [material];
    if (!materials.some(item => item.visible && (!item.transparent || item.opacity > 0))) return false;
  }
  return true;
}

export function describeThreePart(object: THREE.Object3D): { object: THREE.Object3D; part: ThreePart } {
  let named: THREE.Object3D | undefined;
  for (let current: THREE.Object3D | null = object; current && !(current instanceof THREE.Scene); current = current.parent) {
    if (!named && current.name.trim()) named = current;
    const parsed = studySchema.safeParse(current.userData.study);
    if (!parsed.success || !Object.keys(parsed.data).length) continue;
    const data = parsed.data;
    const label = data.label || current.name.trim().slice(0, 160) || "Unnamed part";
    return { object: current, part: { id: current.id, label, description: data.description || undefined, properties: Object.entries(data.properties ?? {}).slice(0, 12).map(([key, value]) => [key, String(value)]), illustrative: data.illustrative === true, named: label !== "Unnamed part" } };
  }
  const target = named ?? object;
  return { object: target, part: { id: target.id, label: named ? named.name.trim().slice(0, 160) : "Unnamed part", properties: [], illustrative: false, named: !!named } };
}

export function createSceneClock() {
  let previous: number | undefined;
  let elapsed = 0;
  return {
    tick(now: number, running: boolean) {
      const delta = previous === undefined ? 0 : Math.max(0, Math.min((now - previous) / 1000, 0.1));
      previous = now;
      if (running) elapsed += delta;
      return { elapsed, delta };
    },
  };
}