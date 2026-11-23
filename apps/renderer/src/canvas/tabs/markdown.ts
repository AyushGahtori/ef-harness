import type { FeatureOutline, OutlineSnapshot } from "./types.js";

const INTERNAL_MARKER = /cell:|content_hash|change_set|review_status|record_type|\b[a-f0-9]{64}\b/i;

export function leaksInternalMarkers(markdown: string): boolean {
  return INTERNAL_MARKER.test(markdown);
}

export function featureSpecMarkdown(outline: OutlineSnapshot, featureId: string): string {
  const feature = outline.features.find((item) => item.id === featureId);
  if (!feature) return "";
  const hideScreens = outline.projectKind === "cli" || feature.screens.length === 0;
  const lines: string[] = [`# ${feature.title}`, ""];
  pushSection(lines, "Requirements", feature.requirements.map((item) => item.text || item.title));
  pushSection(lines, "Contracts", feature.contracts.map((item) => item.title));
  if (!hideScreens) pushSection(lines, "Screens", feature.screens.map((item) => item.title));
  pushSection(lines, "Seams", feature.seams.map((item) => item.title));
  pushSection(lines, "Research", feature.research.map((item) => item.text || item.title));
  if (feature.cliCommands.length > 0 || outline.projectKind === "cli") {
    pushSection(lines, "CLI commands", feature.cliCommands.map((item) => item.text || item.title));
  }
  if (feature.exitCodes.length > 0 || outline.projectKind === "cli") {
    pushSection(lines, "Exit codes", feature.exitCodes.map((item) => item.text || item.title));
  }
  if (outline.rules.length > 0) {
    pushSection(
      lines,
      "Cross-cutting rules",
      outline.rules.map((rule) => `${rule.id} ${rule.title}`.trim()),
    );
  }
  return lines.join("\n").trim() + "\n";
}

function pushSection(lines: string[], heading: string, body: readonly string[]): void {
  if (body.length === 0) return;
  lines.push(`## ${heading}`, "");
  for (const line of body) {
    if (line.trim().length === 0) continue;
    lines.push(line.trim(), "");
  }
}

export function featureById(outline: OutlineSnapshot, featureId: string): FeatureOutline | undefined {
  return outline.features.find((feature) => feature.id === featureId);
}
