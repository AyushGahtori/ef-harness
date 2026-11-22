import type { UnsignedProviderPolicy } from "./types.js";

export function summarizePolicyDiff(
  previous: UnsignedProviderPolicy | null,
  next: UnsignedProviderPolicy,
): string {
  if (!previous) return `loaded policy version ${next.policyVersion}`;
  const parts = [`policy version ${previous.policyVersion} -> ${next.policyVersion}`];
  const previousRoutes = new Map(previous.routes.map((route) => [route.id, route]));
  for (const route of next.routes) {
    const before = previousRoutes.get(route.id);
    if (!before) {
      parts.push(`added route ${route.id}`);
      continue;
    }
    if (before.status !== route.status) {
      parts.push(`route ${route.id} ${before.status} -> ${route.status}`);
    }
  }
  const previousModels = new Map(previous.models.map((model) => [model.modelId, model]));
  for (const model of next.models) {
    const before = previousModels.get(model.modelId);
    if (!before) {
      parts.push(`added model ${model.modelId}`);
      continue;
    }
    if (
      before.inputMicroUsdPer1M !== model.inputMicroUsdPer1M ||
      before.outputMicroUsdPer1M !== model.outputMicroUsdPer1M ||
      before.cachedInputMicroUsdPer1M !== model.cachedInputMicroUsdPer1M
    ) {
      parts.push(`price update ${model.modelId}`);
    }
    if (
      before.supportsTools !== model.supportsTools ||
      before.supportsVision !== model.supportsVision ||
      before.supportsStructuredJson !== model.supportsStructuredJson
    ) {
      parts.push(`capability update ${model.modelId}`);
    }
    if (before.deprecatedAfter !== model.deprecatedAfter || before.revoked !== model.revoked) {
      parts.push(`model ${model.modelId} deprecation updated`);
    }
  }
  const previousFloors = new Map(previous.cliFloors.map((floor) => [floor.runtime, floor.minVersion]));
  for (const floor of next.cliFloors) {
    const before = previousFloors.get(floor.runtime);
    if (before !== floor.minVersion) parts.push(`cli floor ${floor.runtime} ${before ?? "none"} -> ${floor.minVersion}`);
  }
  return parts.join("; ");
}
