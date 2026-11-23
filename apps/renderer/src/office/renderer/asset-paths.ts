import path from "node:path";
import { fileURLToPath } from "node:url";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

/** Resolve bundled office assets from compiled `dist` or source tree. */
export function resolveOfficeAssetDir(): string {
  const fromDist = path.resolve(moduleDir, "../../../assets/office");
  if (fromDist.includes(`${path.sep}dist${path.sep}`)) {
    return path.resolve(moduleDir, "../../../../assets/office");
  }
  return fromDist;
}

export function floorPlanAssetPath(): string {
  return path.join(resolveOfficeAssetDir(), "floorplan-v1.tmj");
}

export function spriteAtlasJsonPath(): string {
  return path.join(resolveOfficeAssetDir(), "cozy-office-atlas.json");
}

export function spriteAtlasImagePath(): string {
  return path.join(resolveOfficeAssetDir(), "cozy-office-atlas.png");
}