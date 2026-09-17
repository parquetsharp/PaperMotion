import type { PersistedTagServer } from "./tags-store";
import type { VizSpec } from "./schemas";

export function visualizationVersions(tag: PersistedTagServer) {
  const versions = (tag.versions ?? []).map((version, index) => ({ ...version, id: version.id ?? `legacy-${index}-${version.at}` }));
  if (tag.spec) versions.push({ id: tag.versionId ?? "current", at: tag.versionAt ?? ((versions.at(-1)?.at ?? 0) + 1), spec: tag.spec });
  return versions.sort((first, second) => first.at - second.at);
}

export function generatedVersion(tag: PersistedTagServer, spec: VizSpec, id: string, at = Date.now()) {
  return { spec, type: spec.type, versionId: id, versionAt: at, versions: visualizationVersions(tag).slice(-5) };
}