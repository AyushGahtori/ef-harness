export const packageName = "@ef-harness/ship-deploy" as const;
export const layer = 4 as const;

export function packageIdentity(): {
  readonly name: typeof packageName;
  readonly layer: typeof layer;
} {
  return { name: packageName, layer };
}
