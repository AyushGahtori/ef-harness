export const packageName = "@ef-harness/spec-expansion" as const;
export const layer = 2 as const;

export function packageIdentity(): {
  readonly name: typeof packageName;
  readonly layer: typeof layer;
} {
  return { name: packageName, layer };
}
