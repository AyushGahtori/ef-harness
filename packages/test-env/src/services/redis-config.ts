export type RedisServerKind = "garnet" | "memurai";

export const DANGEROUS_SHARED_REDIS_COMMANDS = ["FLUSHALL", "SHUTDOWN", "CONFIG"] as const;

const DANGEROUS = new Set<string>(DANGEROUS_SHARED_REDIS_COMMANDS);

/**
 * Garnet is the provisional default: it is MIT-licensed and redistributable.
 * Task 005's `REDIS_DECISION.md` and `EF_HARNESS_REDIS_SERVER` override it.
 */
export function resolveRedisServerChoice(input: {
  readonly envValue?: string;
  readonly decisionText?: string | null;
}): RedisServerKind {
  const envValue = (input.envValue ?? "").trim().toLowerCase();
  if (envValue === "garnet" || envValue === "memurai") return envValue;
  const decision = input.decisionText ?? "";
  const explicit = /(?:chosen|decision|selected)\s+server\s*:\s*(garnet|memurai)/i.exec(decision);
  const chosen = explicit?.[1]?.toLowerCase();
  if (chosen === "garnet" || chosen === "memurai") return chosen;
  return "garnet";
}

export function isDangerousSharedRedisCommand(command: string): boolean {
  return DANGEROUS.has(command.toUpperCase());
}

export function renderRedisIsolationConfig(input: {
  readonly server: RedisServerKind;
  readonly port: number;
  readonly dataDir: string;
}): string {
  const lines = [
    "bind 127.0.0.1",
    `port ${input.port}`,
    "protected-mode yes",
    "databases 16",
    'rename-command FLUSHALL ""',
    'rename-command SHUTDOWN ""',
    'rename-command CONFIG ""',
    `dir ${input.dataDir}`,
  ];
  if (input.server === "garnet") {
    lines.push(`checkpoint-dir ${input.dataDir}`);
  }
  return `${lines.join("\n")}\n`;
}

export function redisBackendArgs(input: {
  readonly server: RedisServerKind;
  readonly port: number;
  readonly dataDir: string;
  readonly configPath: string;
}): readonly string[] {
  if (input.server === "garnet") {
    return ["--bind", "127.0.0.1", "--port", String(input.port), "--checkpointdir", input.dataDir];
  }
  return [input.configPath, "--bind", "127.0.0.1", "--port", String(input.port)];
}
