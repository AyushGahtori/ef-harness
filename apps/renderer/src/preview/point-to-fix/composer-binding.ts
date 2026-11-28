import type { ComposerElementTarget, ElementPickContext, PickContextBundle } from "./types.js";

export function formatElementTargetLabel(pick: ElementPickContext): string {
  const name =
    pick.accessibleName ||
    pick.textExcerpt ||
    pick.role ||
    pick.domPath.split("/").pop() ||
    "element";
  const shortName = name.length > 40 ? `${name.slice(0, 37)}…` : name;
  if (pick.efSource) {
    const base = pick.efSource.file.split("/").pop() ?? pick.efSource.file;
    return `Fixing UI: ${shortName} (${base}:${pick.efSource.line}) · ✕`;
  }
  return `Fixing UI: ${shortName} (preview-only) · ✕`;
}

export function bindComposerElementTarget(pick: PickContextBundle): ComposerElementTarget | null {
  if (pick.kind === "gap") {
    return null;
  }
  const source = pick.efSource;
  return {
    targetKey: `element:${source?.file ?? "unknown"}:${source?.line ?? 0}:${pick.domPath}`,
    label: formatElementTargetLabel(pick),
    thumbnailCropRef: pick.cropPngRef,
    sourceFile: source?.file ?? null,
    sourceLine: source?.line ?? null,
  };
}