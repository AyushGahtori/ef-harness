import { pathKey, splitModulePath } from "./paths.js";
import type { CollisionPolicy, FeatureInput } from "./types.js";

export interface CollisionPlan {
  features: FeatureInput[];
  sharedWritePaths: { path: string; owner: "phase0-foundation" }[];
  hoistedFeatureIds: string[];
}

export function applyCollisionPolicy(
  features: readonly FeatureInput[],
  policy: CollisionPolicy,
): CollisionPlan {
  const next = features.map((feature) => ({
    ...feature,
    writePaths: feature.writePaths.map((item) => item),
  }));
  const sharedWritePaths: { path: string; owner: "phase0-foundation" }[] = [];
  const hoistedFeatureIds: string[] = [];
  if (policy === "reject") {
    return { features: next, sharedWritePaths, hoistedFeatureIds };
  }
  for (const overlap of overlappingPaths(next)) {
    if (policy === "hoist-shared") {
      for (const feature of next) {
        const before = feature.writePaths.length;
        feature.writePaths = feature.writePaths.filter((item) => pathKey(item) !== pathKey(overlap.path));
        if (feature.writePaths.length !== before && !hoistedFeatureIds.includes(feature.id)) {
          hoistedFeatureIds.push(feature.id);
        }
      }
      sharedWritePaths.push({ path: overlap.path, owner: "phase0-foundation" });
      continue;
    }
    for (const feature of next) {
      feature.writePaths = feature.writePaths.map((item) =>
        pathKey(item) === pathKey(overlap.path) ? splitModulePath(item, feature.slug) : item,
      );
    }
  }
  return { features: next, sharedWritePaths, hoistedFeatureIds };
}

export function overlappingPaths(
  features: readonly FeatureInput[],
): { path: string; featureIds: string[] }[] {
  const grouped = new Map<string, { path: string; featureIds: string[] }>();
  for (const feature of features) {
    for (const writePath of feature.writePaths) {
      const key = pathKey(writePath);
      const current = grouped.get(key);
      if (!current) {
        grouped.set(key, { path: writePath, featureIds: [feature.id] });
        continue;
      }
      if (!current.featureIds.includes(feature.id)) current.featureIds.push(feature.id);
    }
  }
  return [...grouped.values()].filter((item) => item.featureIds.length >= 2);
}
