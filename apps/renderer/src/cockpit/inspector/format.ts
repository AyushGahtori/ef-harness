import type { AttemptSnapshot, CrewLevel } from "./types.js";

export function formatSpend(microUsd: number): string {
  return `$${(microUsd / 1_000_000).toFixed(2)}`;
}

export function formatElapsed(ms: number): string {
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)} min`;
  const hours = Math.floor(ms / 3_600_000);
  const mins = Math.floor((ms % 3_600_000) / 60_000);
  return `${hours}h ${mins}m`;
}

export function formatTokens(tokens: number): string {
  if (tokens >= 1000) {
    const scaled = tokens / 1000;
    const digits = scaled >= 10 ? scaled.toFixed(0) : scaled.toFixed(1);
    return `${digits}k tokens`;
  }
  return `${tokens} tokens`;
}

export function formatByteSize(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (bytes >= 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  return `${bytes} B`;
}

export function largeFileLabel(byteSize: number): string {
  return `Large file (${formatByteSize(byteSize)}) — Load preview chunk (64 KB)`;
}

export function attemptLabel(attempt: AttemptSnapshot): string {
  if (attempt.outcome === "pass") return `Attempt ${attempt.number} (PASS)`;
  if (attempt.hint) return `Attempt ${attempt.number} (Failed — ${attempt.hint})`;
  if (attempt.outcome === "running") return `Attempt ${attempt.number} (Running)`;
  return `Attempt ${attempt.number} (Queued)`;
}

export function attemptGroupHeading(attempt: AttemptSnapshot): string {
  if (attempt.outcome === "pass") return `Attempt ${attempt.number} · PASS`;
  if (attempt.hint) return `Attempt ${attempt.number} · ${attempt.hint}`;
  return `Attempt ${attempt.number} · ${attempt.outcome}`;
}

export function escalationLine(from: CrewLevel, to: CrewLevel): string {
  return `Escalated ${from} → ${to}`;
}

export function editorCommand(filePath: string, line: number): string {
  return `code -g ${filePath}:${line}`;
}

export function identityTitle(agentId: string, title: string): string {
  return `${agentId} · ${title}`;
}

export function modelBadge(model: string, connection: string): string {
  return `${model} · ${connection}`;
}

export function waitingLine(taskIds: readonly string[]): string {
  return `Waiting on ${taskIds.join(", ")}`;
}
