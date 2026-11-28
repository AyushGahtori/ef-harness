import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

export interface PlaintextHit {
  readonly path: string;
  readonly needleIndex: number;
}

export function scanPathsForPlaintext(
  roots: readonly string[],
  needles: readonly Uint8Array[],
): PlaintextHit[] {
  const hits: PlaintextHit[] = [];
  for (const root of roots) {
    walk(root, needles, hits);
  }
  return hits;
}

function walk(target: string, needles: readonly Uint8Array[], hits: PlaintextHit[]): void {
  let stat;
  try {
    stat = statSync(target);
  } catch (error) {
    const code = errorCode(error);
    if (code === "ENOENT") return;
    throw error;
  }
  if (stat.isDirectory()) {
    for (const entry of readdirSync(target)) {
      walk(path.join(target, entry), needles, hits);
    }
    return;
  }
  if (!stat.isFile()) return;
  const bytes = readFileSync(target);
  for (let index = 0; index < needles.length; index += 1) {
    const needle = needles[index];
    if (!needle || needle.length === 0) continue;
    if (bytes.indexOf(needle) >= 0) {
      hits.push({ path: target, needleIndex: index });
    }
  }
}

function errorCode(error: unknown): string | undefined {
  if (error && typeof error === "object" && "code" in error) {
    const code = error.code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}
