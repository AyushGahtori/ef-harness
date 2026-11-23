import type { NameOnlyEnvDiff, SecretNameHash } from "./types.js";

export function diffSecretNameHashes(
  local: readonly SecretNameHash[],
  remote: readonly SecretNameHash[],
): NameOnlyEnvDiff {
  const remoteByName = new Map(remote.map((item) => [item.name, item.hmac]));
  const localNames = new Set(local.map((item) => item.name));
  const added: string[] = [];
  const changed: string[] = [];
  const deleted: string[] = [];
  for (const item of local) {
    const previous = remoteByName.get(item.name);
    if (previous === undefined) added.push(item.name);
    else if (previous !== item.hmac) changed.push(item.name);
  }
  for (const item of remote) {
    if (!localNames.has(item.name)) deleted.push(item.name);
  }
  added.sort();
  changed.sort();
  deleted.sort();
  return {
    added,
    changed,
    deleted,
    summary: `${added.length} added, ${changed.length} changed, ${deleted.length} deleted — [names only]`,
  };
}

export function formatApprovalLines(diff: NameOnlyEnvDiff): string[] {
  const lines: string[] = [];
  for (const name of diff.added) lines.push(`+ ${name} (added)`);
  for (const name of diff.changed) lines.push(`~ ${name} (updated)`);
  for (const name of diff.deleted) lines.push(`- ${name} (removed)`);
  return lines;
}