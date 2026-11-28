const PROJECT_ID = /^[A-Za-z][A-Za-z0-9_-]{0,62}$/;

export function assertPreviewProjectId(projectId: string): void {
  if (!PROJECT_ID.test(projectId)) {
    throw new Error(`invalid preview project id: ${projectId}`);
  }
}

export function previewPartition(projectId: string): `persist:ef-preview-${string}` {
  assertPreviewProjectId(projectId);
  return `persist:ef-preview-${projectId}`;
}

export function previewDatabaseName(projectId: string, engine: "sqlite" | "postgres"): string {
  assertPreviewProjectId(projectId);
  if (engine === "sqlite") return "demo.db";
  return `${projectId.replaceAll("-", "_")}_preview`;
}

export function featureUpdatePill(featureId: string): string {
  return `Updated to include Feature ${featureId}`;
}

export function lastGoodBanner(sha: string): string {
  return `Preview build failed on latest commit — Viewing last working build (${sha}) · Inspect Error`;
}

export function noLastGoodBanner(): string {
  return "Preview build failed on latest commit — No last working build · Inspect Error";
}
