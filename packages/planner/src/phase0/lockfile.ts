import { sha256FileBytes } from "./hash.js";
import type { DependencyIntent } from "./types.js";

export function canonicalLockfile(dependencies: readonly DependencyIntent[]): string {
  const sorted = [...dependencies].sort((left, right) => {
    const name = left.name.localeCompare(right.name);
    if (name !== 0) return name;
    return left.version.localeCompare(right.version);
  });
  const lines = ["lockfileVersion: \"9.0\""];
  for (const dep of sorted) {
    lines.push(`${dep.name}@${dep.version}`);
  }
  lines.push("");
  return lines.join("\n");
}

export function lockfileHash(body: string): string {
  return sha256FileBytes(body);
}

export function dependenciesFromIntents(dependencies: readonly DependencyIntent[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const dep of [...dependencies].sort((left, right) => left.name.localeCompare(right.name))) {
    out[dep.name] = dep.version;
  }
  return out;
}

export function mergePackageDependencies(packageJson: string, dependencies: Readonly<Record<string, string>>): string {
  const parsed = JSON.parse(packageJson) as { dependencies?: Record<string, string> };
  parsed.dependencies = { ...dependencies };
  return `${JSON.stringify(parsed, null, 2)}\n`;
}

export function isCanonicalLockfile(body: string): boolean {
  const names: DependencyIntent[] = [];
  const lines = body.replaceAll("\r\n", "\n").split("\n");
  if (lines[0] !== "lockfileVersion: \"9.0\"") return false;
  for (const line of lines.slice(1)) {
    if (line === "") continue;
    const match = /^(@?[^@\s]+)@(\d+\.\d+\.\d+)$/.exec(line);
    if (!match || !match[1] || !match[2]) return false;
    names.push({ name: match[1], version: match[2], approved: true });
  }
  return canonicalLockfile(names) === body.replaceAll("\r\n", "\n");
}
