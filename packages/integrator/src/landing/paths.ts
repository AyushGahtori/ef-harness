export function normalizeRepoPath(filePath: string): string {
  return filePath.replaceAll("\\", "/").replace(/^\.\//, "");
}

export function pathsEqualCaseInsensitive(a: string, b: string): boolean {
  return normalizeRepoPath(a).toLocaleLowerCase("en-US") === normalizeRepoPath(b).toLocaleLowerCase("en-US");
}

export function intersectsPathSets(
  dirty: readonly string[],
  integration: readonly string[],
): string[] {
  const integrationKeys = new Map<string, string>();
  for (const path of integration) {
    integrationKeys.set(normalizeRepoPath(path).toLocaleLowerCase("en-US"), normalizeRepoPath(path));
  }
  const overlaps: string[] = [];
  for (const path of dirty) {
    const key = normalizeRepoPath(path).toLocaleLowerCase("en-US");
    const matched = integrationKeys.get(key);
    if (matched) overlaps.push(matched);
  }
  return [...new Set(overlaps)].sort((left, right) => left.localeCompare(right));
}

export function findUntrackedCaseCollisions(
  untracked: readonly string[],
  integrationNewPaths: readonly string[],
): string[] {
  const untrackedKeys = new Map<string, string>();
  for (const path of untracked) {
    untrackedKeys.set(normalizeRepoPath(path).toLocaleLowerCase("en-US"), normalizeRepoPath(path));
  }
  const hits: string[] = [];
  for (const path of integrationNewPaths) {
    const key = normalizeRepoPath(path).toLocaleLowerCase("en-US");
    const local = untrackedKeys.get(key);
    if (local && normalizeRepoPath(local) !== normalizeRepoPath(path)) {
      hits.push(`${local} ↔ ${normalizeRepoPath(path)}`);
    }
  }
  return hits.sort((left, right) => left.localeCompare(right));
}