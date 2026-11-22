import type { NameOnlySecretDiff, SecretNameHash } from "./types.js";

export function diffSecretNames(
  local: readonly SecretNameHash[],
  remote: readonly SecretNameHash[],
): NameOnlySecretDiff {
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
