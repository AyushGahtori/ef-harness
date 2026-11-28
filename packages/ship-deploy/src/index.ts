export const packageName = "@ef-harness/ship-deploy" as const;
export const layer = 4 as const;

export function packageIdentity(): {
  readonly name: typeof packageName;
  readonly layer: typeof layer;
} {
  return { name: packageName, layer };
}

export * as effects from "./effects/index.js";
export * as github from "./github/index.js";
export * as ciLoop from "./ci-loop/index.js";
export {
  adaptLedgerForCi,
  bindShipDeploy,
  createGitSafetyScannerPort,
  createMinGitRepoInspector,
  landingParagraph,
  type ShipDeployBindings,
} from "./wire.js";
