import { existsSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { removeCatalogComponent } from "./catalog.js";
import { ComponentLeaseActiveError } from "./errors.js";
import { assertSafeComponentId } from "./paths.js";

export interface ComponentDiskUsage {
  readonly componentId: string;
  readonly label: string;
  readonly sizeBytes: number;
  readonly display: string;
}

export interface ComponentLeaseSource {
  holder(componentId: string): string | null;
}

export function formatComponentDiskUsage(label: string, sizeBytes: number): string {
  const megabytes = sizeBytes / (1024 * 1024);
  const nearest = Math.round(megabytes);
  const rounded = Math.abs(megabytes - nearest) < 0.05 ? String(nearest) : megabytes.toFixed(1);
  return `${label}: ${rounded} MB`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function directorySize(dir: string): number {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += directorySize(full);
    else if (entry.isFile()) total += statSync(full).size;
  }
  return total;
}

function readLabel(dir: string, fallback: string): string {
  try {
    const parsed = JSON.parse(readFileSync(path.join(dir, "component.json"), "utf8")) as unknown;
    if (isRecord(parsed) && typeof parsed.label === "string" && parsed.label.length > 0) return parsed.label;
  } catch (error) {
    void error;
  }
  return fallback;
}

export class ComponentDiskUsageManager {
  constructor(
    private readonly componentsRoot: string,
    private readonly leases: ComponentLeaseSource,
  ) {}

  list(): readonly ComponentDiskUsage[] {
    if (!existsSync(this.componentsRoot)) return [];
    const rows: ComponentDiskUsage[] = [];
    for (const entry of readdirSync(this.componentsRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith("_") || entry.isSymbolicLink()) continue;
      const dir = path.join(this.componentsRoot, entry.name);
      const label = readLabel(dir, entry.name);
      const sizeBytes = directorySize(dir);
      rows.push({
        componentId: entry.name,
        label,
        sizeBytes,
        display: formatComponentDiskUsage(label, sizeBytes),
      });
    }
    rows.sort((left, right) => left.componentId.localeCompare(right.componentId));
    return rows;
  }

  uninstall(componentId: string): void {
    assertSafeComponentId(componentId);
    const holder = this.leases.holder(componentId);
    if (holder !== null && holder.length > 0) {
      throw new ComponentLeaseActiveError(componentId, holder);
    }
    rmSync(path.join(this.componentsRoot, componentId), { recursive: true, force: true });
    removeCatalogComponent(this.componentsRoot, componentId);
  }
}
