import type { Concealable, KnowledgeNode, TaskPacketV1 } from "./types.js";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isConcealed(record: Concealable): boolean {
  if (record.visibility === "held_back" || record.visibility === "sealed") return true;
  if (record.status === "sealed") return true;
  if (record.kind === "checks-sealed" || record.kind === "check_sealed") return true;
  if (typeof record.id === "string" && (record.id.startsWith("checks-sealed/") || record.id.startsWith("checks-sealed"))) {
    return record.kind === "checks-sealed" || record.id.startsWith("checks-sealed/");
  }
  return false;
}

export function stripConcealed(value: unknown): unknown {
  if (Array.isArray(value)) {
    const kept: unknown[] = [];
    for (const item of value) {
      if (isRecord(item) && isConcealed(item)) continue;
      const next = stripConcealed(item);
      if (next !== undefined) kept.push(next);
    }
    return kept;
  }
  if (!isRecord(value)) return value;
  if (isConcealed(value)) return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === "held_back" || key === "checks-sealed" || key === "checks_sealed" || key === "hidden_expectations") {
      continue;
    }
    const next = stripConcealed(child);
    if (next !== undefined) out[key] = next;
  }
  return out;
}

export function pinnedVersion(packet: TaskPacketV1, id: string): number | undefined {
  for (const contract of packet.contracts ?? []) {
    if (contract.id === id) return contract.v;
  }
  for (const item of packet.must ?? []) {
    if (item.id === id) return item.v;
  }
  return undefined;
}

export function parseIdAtVersion(value: string): { id: string; version?: number } {
  const at = value.lastIndexOf("@");
  if (at <= 0) return { id: value };
  const versionText = value.slice(at + 1);
  if (!/^\d+$/.test(versionText)) return { id: value };
  const version = Number(versionText);
  return { id: value.slice(0, at), version };
}

export function publicNode(node: KnowledgeNode, text?: string): Record<string, unknown> {
  return {
    id: node.id,
    kind: node.kind,
    version: node.version,
    contentHash: node.contentHash,
    title: node.title,
    text: text ?? node.text,
    status: node.status,
    fields: stripConcealed(node.fields),
  };
}

export function generateSearchSnippet(text: string, query: string): string {
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term.length > 0);
  const haystack = text.toLowerCase();
  let at = -1;
  let needle = "";
  for (const term of terms) {
    const found = haystack.indexOf(term);
    if (found >= 0) {
      at = found;
      needle = term;
      break;
    }
  }
  if (at < 0) return text.slice(0, 160);
  const start = Math.max(0, at - 60);
  const end = Math.min(text.length, at + needle.length + 60);
  return text.slice(start, end);
}

export function declaredArtifact(packet: TaskPacketV1, artifactId: string): boolean {
  return (packet.dependencies ?? []).some((item) => item.artifactId === artifactId);
}
