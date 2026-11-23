import type { SecurityScorecard } from "./types.js";

export const RED_TEAM_TIME_BUDGET_MS = 30_000;

export function formatScorecardJson(scorecard: SecurityScorecard): string {
  return `${JSON.stringify(scorecard, null, 2)}\n`;
}

export function formatScorecardMarkdown(scorecard: SecurityScorecard): string {
  const lines = [
    "# Meta-Lab Red-Team Scorecard",
    "",
    `**ok:** ${scorecard.ok}`,
    `**durationMs:** ${scorecard.durationMs}`,
    `**withinBudget:** ${scorecard.withinBudget}`,
    `**trapHitCount:** ${scorecard.trapHitCount}`,
    `**canaryAccessCount:** ${scorecard.canaryAccessCount}`,
    `**rawCanaryLeaks:** ${scorecard.rawCanaryLeaks}`,
    "",
    "## Attacks",
    "",
  ];
  for (const attack of scorecard.attacks) {
    lines.push(
      `- **${attack.id}**: blocked=${attack.blocked}; trap=${attack.trapHitCount}; canary=${attack.canaryAccessCount}; leaks=${attack.rawCanaryLeaks}`,
    );
    for (const layer of attack.layers) {
      lines.push(`  - ${layer.id}: triggered=${layer.triggered}, blocked=${layer.blocked}`);
    }
  }
  lines.push("", "## Boundary probes", "");
  for (const probe of scorecard.probes) {
    lines.push(`- **${probe.id}**: blocked=${probe.blocked} (${probe.detail})`);
  }
  return `${lines.join("\n")}\n`;
}