import type { GitSafetyScanner, SafetyScanReport, SecretHit } from "./ports.js";

/**
 * In-memory stand-in for Task 036 GitSafetyScanner.scanCommitDiffForSecrets.
 * Reports masked rule and location only. Swap for the real scanner at integration.
 */
export function createLocalGitSafetyScanner(): GitSafetyScanner {
  return {
    scanCommitDiffForSecrets(diffText, vaultSecrets = []) {
      const hits: SecretHit[] = [];
      let file = "diff";
      let line = 1;
      for (const raw of diffText.split(/\r?\n/)) {
        if (raw.startsWith("+++ b/")) {
          file = raw.slice("+++ b/".length).trim();
          continue;
        }
        const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(raw);
        if (hunk?.[1]) {
          line = Number(hunk[1]);
          continue;
        }
        if (!raw.startsWith("+") || raw.startsWith("+++")) continue;
        const text = raw.slice(1);
        const found = detectSecret(text, vaultSecrets);
        if (found) {
          hits.push({
            file,
            line,
            ruleId: found.ruleId,
            maskedPreview: maskSecretValue(found.raw),
          });
        }
        line += 1;
      }
      const report: SafetyScanReport = {
        blockedSecrets: hits,
        largeFiles: [],
        recommendedIgnores: [],
        proposedGitignoreDiff: "",
        safeToCommit: hits.length === 0,
      };
      return report;
    },
  };
}

export function maskSecretValue(value: string): string {
  if (value.length <= 6) return "****";
  return `${value.slice(0, 2)}****${value.slice(-2)}`;
}

function detectSecret(line: string, vaultSecrets: readonly string[]): { ruleId: string; raw: string } | null {
  for (const secret of vaultSecrets) {
    if (secret.length < 8) continue;
    if (line.includes(secret)) return { ruleId: "vault-secret", raw: secret };
    const encoded = Buffer.from(secret).toString("base64");
    if (encoded.length >= 8 && line.includes(encoded)) return { ruleId: "vault-secret-base64", raw: secret };
    const url = encodeURIComponent(secret);
    if (url !== secret && line.includes(url)) return { ruleId: "vault-secret-url", raw: secret };
  }
  const prefixed = prefixedSecret(line);
  if (prefixed) return prefixed;
  const assigned = /(?:api[_-]?key|secret|token|password|private[_-]?key)\s*[:=]\s*(['"])([^'"]{20,})\1/i.exec(
    line,
  );
  const assignedValue = assigned?.[2];
  if (assignedValue && shannon(assignedValue) >= 3.4) {
    return { ruleId: "assigned-secret", raw: assignedValue };
  }
  return null;
}

function prefixedSecret(line: string): { ruleId: string; raw: string } | null {
  const prefixes = [
    { prefix: ["sk", "_live_"].join(""), ruleId: "live-key" },
    { prefix: ["ghp", "_"].join(""), ruleId: "github-token" },
    { prefix: ["AK", "IA"].join(""), ruleId: "aws-access-key" },
    { prefix: ["sk-ant", "-"].join(""), ruleId: "anthropic-key" },
  ];
  for (const item of prefixes) {
    const index = line.indexOf(item.prefix);
    if (index < 0) continue;
    const tail = /^[A-Za-z0-9_\-]+/.exec(line.slice(index));
    return { ruleId: item.ruleId, raw: tail?.[0] ?? item.prefix };
  }
  const header = ["BEGIN ", "PRIVATE KEY"].join("");
  if (line.includes(header)) return { ruleId: "private-key", raw: header };
  return null;
}

function shannon(value: string): number {
  const counts = new Map<string, number>();
  for (const char of value) counts.set(char, (counts.get(char) ?? 0) + 1);
  let entropy = 0;
  for (const count of counts.values()) {
    const p = count / value.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}
