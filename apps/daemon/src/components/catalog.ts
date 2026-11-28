import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

export interface CatalogFileEntry {
  readonly path: string;
  readonly sha256: string;
  readonly sizeBytes: number;
}

export interface CatalogComponent {
  readonly id: string;
  readonly label: string;
  readonly version: string;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly files: readonly CatalogFileEntry[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function catalogFilePath(componentsRoot: string): string {
  return path.join(componentsRoot, "_catalog", "components.json");
}

export function readComponentCatalog(componentsRoot: string): Record<string, CatalogComponent> {
  try {
    const parsed = JSON.parse(readFileSync(catalogFilePath(componentsRoot), "utf8")) as unknown;
    if (!isRecord(parsed) || !isRecord(parsed.components)) return {};
    const components: Record<string, CatalogComponent> = {};
    for (const [id, value] of Object.entries(parsed.components)) {
      if (!isRecord(value) || typeof value.label !== "string" || !Array.isArray(value.files)) continue;
      const files: CatalogFileEntry[] = [];
      for (const fileEntry of value.files) {
        if (!isRecord(fileEntry) || typeof fileEntry.path !== "string" || typeof fileEntry.sha256 !== "string") {
          continue;
        }
        if (!Number.isSafeInteger(fileEntry.sizeBytes)) continue;
        files.push({
          path: fileEntry.path,
          sha256: fileEntry.sha256,
          sizeBytes: fileEntry.sizeBytes as number,
        });
      }
      components[id] = {
        id,
        label: value.label,
        version: typeof value.version === "string" ? value.version : "",
        sha256: typeof value.sha256 === "string" ? value.sha256 : "",
        sizeBytes: Number.isSafeInteger(value.sizeBytes) ? (value.sizeBytes as number) : 0,
        files,
      };
    }
    return components;
  } catch (error) {
    void error;
    return {};
  }
}

export function writeComponentCatalog(
  componentsRoot: string,
  components: Record<string, CatalogComponent>,
): void {
  const file = catalogFilePath(componentsRoot);
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify({ components }), "utf8");
  renameSync(tmp, file);
}

export function upsertCatalogComponent(componentsRoot: string, component: CatalogComponent): void {
  const components = readComponentCatalog(componentsRoot);
  components[component.id] = component;
  writeComponentCatalog(componentsRoot, components);
}

export function removeCatalogComponent(componentsRoot: string, componentId: string): void {
  const components = readComponentCatalog(componentsRoot);
  if (components[componentId] === undefined) return;
  delete components[componentId];
  writeComponentCatalog(componentsRoot, components);
}
