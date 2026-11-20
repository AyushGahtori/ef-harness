import type {
  EnvironmentKind,
  EnvironmentManifest,
  ProvisioningTier,
  ServiceName,
} from "./types.js";

const SHARED_SERVICES = new Set<ServiceName>([
  "postgres",
  "redis",
  "mail",
  "oauth",
  "stripe",
  "s3",
  "http_replay",
]);

export interface ProvisioningSelection {
  readonly tier: ProvisioningTier;
  readonly services: readonly ServiceName[];
  readonly stateful: boolean;
  readonly allocateAppPort: boolean;
}

export function selectProvisioningTier(input: {
  readonly kind: EnvironmentKind;
  readonly services: readonly ServiceName[];
  readonly hasApp: boolean;
  readonly explicitTier?: ProvisioningTier;
}): ProvisioningTier {
  if (input.explicitTier !== undefined) return input.explicitTier;
  const hasShared = input.services.some((service) => SHARED_SERVICES.has(service));
  if (input.kind === "migration" && (hasShared || input.services.includes("sqlite"))) {
    return 3;
  }
  if (hasShared) return 2;
  if (input.services.includes("sqlite") || input.hasApp) return 1;
  return 0;
}

export function selectProvisioning(input: {
  readonly kind: EnvironmentKind;
  readonly manifest: EnvironmentManifest;
}): ProvisioningSelection {
  const tier = selectProvisioningTier({
    kind: input.kind,
    services: input.manifest.services,
    hasApp: input.manifest.app !== undefined,
    ...(input.manifest.tier !== undefined ? { explicitTier: input.manifest.tier } : {}),
  });
  const services = filterServices(tier, input.manifest.services);
  const stateful = tier > 0;
  const allocateAppPort = tier > 0 && input.manifest.app !== undefined;
  return { tier, services, stateful, allocateAppPort };
}

function filterServices(tier: ProvisioningTier, services: readonly ServiceName[]): ServiceName[] {
  if (tier === 0) return [];
  if (tier === 1) return services.filter((service) => service === "sqlite");
  return [...services];
}
