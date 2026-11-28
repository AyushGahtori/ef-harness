export const packageName = "@ef-harness/brownfield" as const;
export const layer = 2 as const;

export function packageIdentity(): {
  readonly name: typeof packageName;
  readonly layer: typeof layer;
} {
  return { name: packageName, layer };
}

export * as l0Scan from "./l0-scan/index.js";
export * as l1Codemap from "./l1-codemap/index.js";
export * as l2Cards from "./l2-cards/index.js";
export * as opening from "./opening/index.js";
export * as testHealth from "./test-health/index.js";
