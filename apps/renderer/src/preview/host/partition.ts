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

export const HARNESS_SHELL_PARTITION = "persist:ef-harness-shell";

export const PREVIEW_LABELS = {
  resetDemoData: "Reset Demo Data",
  mobile: "Mobile 375px",
  tablet: "Tablet 768px",
  desktop: "Desktop 1440px",
  responsive: "Responsive Fit",
  reload: "Reload",
  openBrowser: "Open in system browser",
  popOut: "Pop out to Monitor 2",
  wake: "Wake",
  inspectError: "Inspect Error",
  sendError: "Send error to fix",
  cliTitle: "Interactive Sandboxed CLI Preview Runner",
} as const;

export const VIEWPORT_WIDTHS = {
  mobile: 375,
  tablet: 768,
  desktop: 1440,
  responsive: null,
} as const;

export type ViewportPreset = keyof typeof VIEWPORT_WIDTHS;

export function featureUpdatePill(featureId: string): string {
  return `Updated to include Feature ${featureId}`;
}

export function lastGoodBanner(sha: string): string {
  return `Preview build failed on latest commit — Viewing last working build (${sha}) · Inspect Error`;
}
