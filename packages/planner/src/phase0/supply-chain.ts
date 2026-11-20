import { Phase0Error } from "./errors.js";
import type { DependencyIntent, Phase0Recipe } from "./types.js";
import type { TaskExecution } from "./ports.js";
import { fileInScopes } from "./scope.js";

const RAW_INSTALL = /\b(?:npm|pnpm|yarn)\s+(?:install|add|i)\b|\bpostinstall\b/i;

export function rawInstallViolation(commands: readonly string[]): string | null {
  for (const command of commands) {
    if (RAW_INSTALL.test(command)) {
      return `Phase 0 workers cannot run \`${command}\`. Dependency installs go through the kernel installer.`;
    }
  }
  return null;
}

export interface PreparedExecution {
  readonly files: Readonly<Record<string, string>>;
  readonly dependencyIntents: readonly DependencyIntent[];
}

/**
 * Drops parallel `package.json` / lockfile edits and keeps their dependency
 * intents for a serialized kernel install. Rejects raw `npm`/`pnpm` installs
 * and files outside the task write scope.
 */
export function prepareExecution(task: Phase0Recipe, execution: TaskExecution): PreparedExecution {
  const violation = rawInstallViolation(execution.attemptedCommands);
  if (violation) throw new Phase0Error("raw_install_forbidden", violation);
  const intents = [...execution.dependencyIntents];
  const files: Record<string, string> = {};
  for (const [rel, content] of Object.entries(execution.files)) {
    const normalized = rel.replaceAll("\\", "/");
    if (task.id !== "P0.1" && isManifest(normalized)) {
      intents.push(...intentsFromPackageJson(content));
      continue;
    }
    if (!fileInScopes(normalized, task.writeScope)) {
      throw new Phase0Error("scope_violation", `${task.id} cannot write ${normalized}`);
    }
    files[normalized] = content;
  }
  return { files, dependencyIntents: uniqueIntents(intents) };
}

function isManifest(rel: string): boolean {
  const base = rel.toLowerCase();
  return base === "package.json" || base === "pnpm-lock.yaml" || base.endsWith("/package.json") || base.endsWith("/pnpm-lock.yaml");
}

function intentsFromPackageJson(content: string): DependencyIntent[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch {
    throw new Phase0Error("package_json", "package.json is not valid JSON");
  }
  if (!parsed || typeof parsed !== "object") return [];
  const dependencies = (parsed as { dependencies?: unknown }).dependencies;
  if (!dependencies || typeof dependencies !== "object") return [];
  const intents: DependencyIntent[] = [];
  for (const [name, version] of Object.entries(dependencies)) {
    if (typeof version !== "string") continue;
    intents.push({ name, version, approved: false });
  }
  return intents;
}

export function uniqueIntents(intents: readonly DependencyIntent[]): DependencyIntent[] {
  const seen = new Map<string, DependencyIntent>();
  for (const intent of intents) {
    const key = `${intent.name}@${intent.version}`;
    const previous = seen.get(key);
    if (!previous || (!previous.approved && intent.approved)) seen.set(key, intent);
  }
  return [...seen.values()];
}
