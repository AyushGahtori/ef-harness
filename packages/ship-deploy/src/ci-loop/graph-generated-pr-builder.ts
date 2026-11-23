import type { GeneratedPullRequestDraft, GraphGeneratedPrInput } from "./types.js";

const SECRET_VALUE_MARKERS = [
  new RegExp(["sk", "_live_"].join(""), "i"),
  new RegExp(`${["AK", "IA"].join("")}[0-9A-Z]{16}`),
  new RegExp(`${["ghp", "_"].join("")}[A-Za-z0-9]+`),
  new RegExp(`-----${["BEGIN ", "PRIVATE KEY"].join("")}-----`),
];

function assertNoEmbeddedSecrets(markdown: string): void {
  for (const pattern of SECRET_VALUE_MARKERS) {
    if (pattern.test(markdown)) {
      throw new Error("Generated PR body must not contain raw secret values");
    }
  }
}

function renderReceiptsTable(rows: GraphGeneratedPrInput["verificationReceipts"]): string {
  if (rows.length === 0) {
    return "_No verification receipts recorded._\n";
  }
  const lines = ["| Gate | Result | Detail |", "| --- | --- | --- |"];
  for (const row of rows) {
    lines.push(`| ${row.gate} | ${row.result} | ${row.detail ?? "—"} |`);
  }
  return `${lines.join("\n")}\n`;
}

export class GraphGeneratedPrBuilder {
  build(input: GraphGeneratedPrInput): GeneratedPullRequestDraft {
    const reqBullets =
      input.requirementRefs.length === 0
        ? "- _No linked requirements._\n"
        : input.requirementRefs.map((node) => `- **${node.kind}** #${node.nid}: ${node.title}`).join("\n");

    const migrations =
      input.migrationNotes.length === 0 ? "_None._" : input.migrationNotes.map((note) => `- ${note}`).join("\n");
    const envNames =
      input.envVarNames.length === 0
        ? "_No new environment variables._"
        : input.envVarNames.map((name) => `- \`${name}\` (name only — set in host/CI separately)`).join("\n");

    const human =
      input.humanFixedNotes.length === 0
        ? "_None._"
        : input.humanFixedNotes.map((line) => `- ${line}`).join("\n");
    const delegated =
      input.delegatedDecisions.length === 0
        ? "_None._"
        : input.delegatedDecisions.map((line) => `- ${line}`).join("\n");
    const deferred =
      input.deferredNotes.length === 0 ? "_None._" : input.deferredNotes.map((line) => `- ${line}`).join("\n");

    const title = input.featureTitle.trim();
    const bodyMarkdown = [
      "## Summary",
      input.landingSummaryParagraph.trim(),
      "",
      "### Requirements covered",
      reqBullets,
      "",
      "## Verification receipts",
      renderReceiptsTable(input.verificationReceipts),
      "## Migrations & env vars needed",
      "### Migrations",
      migrations,
      "",
      "### Env var names (no values)",
      envNames,
      "",
      "## Human-fixed / delegated / deferred",
      "### Human-fixed",
      human,
      "",
      "### Delegated decisions",
      delegated,
      "",
      "### Deferred notes",
      deferred,
      "",
      `<!-- EF-Effect-Id: ${input.effectId} -->`,
    ].join("\n");

    assertNoEmbeddedSecrets(bodyMarkdown);

    return { title, bodyMarkdown };
  }
}