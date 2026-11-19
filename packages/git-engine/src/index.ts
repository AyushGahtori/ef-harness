export const packageName = "@ef-harness/git-engine" as const;
export const layer = 1 as const;

export function packageIdentity(): {
  readonly name: typeof packageName;
  readonly layer: typeof layer;
} {
  return { name: packageName, layer };
}
