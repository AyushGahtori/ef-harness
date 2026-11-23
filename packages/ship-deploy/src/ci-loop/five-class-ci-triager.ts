import { computeFailureFingerprint } from "./canonical-hash.js";
import type { BaseBranchCiSnapshot } from "./contracts.js";
import type { CiClassification, CiFailureInput, CiOperationalClass, CiTriageV1Class } from "./types.js";

function quoteEvidence(lines: readonly string[], max = 5): string[] {
  return lines.slice(0, max).map((line) => line.trim()).filter(Boolean);
}

function mapToOperational(v1: CiTriageV1Class): CiOperationalClass {
  switch (v1) {
    case "regression":
      return "class_1_regression";
    case "platform":
      return "class_2_portability";
    case "flaky":
      return "class_3_transient";
    case "missing_secret":
      return "class_4_missing_secret";
    case "infrastructure":
    default:
      return "class_3_transient";
  }
}

function detectV1Class(input: CiFailureInput): CiTriageV1Class {
  const blob = input.logExcerpt.join("\n");
  if (/secret .* not set|missing.*secret|Error:.*secret/i.test(blob)) {
    return "missing_secret";
  }
  if (/503 Service Unavailable|runner.*offline|ECONNRESET|ETIMEDOUT|429 Too Many Requests|npm ERR! 503/i.test(blob)) {
    return "infrastructure";
  }
  if (/TS2307|Cannot find module|ENOENT.*case|bad interpreter|\^M:|\\\\/.test(blob)) {
    return "platform";
  }
  if (input.baseBranchFailedChecks?.includes(input.jobName)) {
    return "infrastructure";
  }
  if (/flaky|retry|intermittent/i.test(blob)) {
    return "flaky";
  }
  return input.localVerificationPassed ? "platform" : "regression";
}

export class FiveClassCiTriager {
  classify(input: CiFailureInput, baseSnapshot?: BaseBranchCiSnapshot): CiClassification {
    const evidence_lines = quoteEvidence(input.logExcerpt);

    if (baseSnapshot?.failingCheckNames.includes(input.jobName)) {
      const triage = {
        class: "infrastructure" as const,
        evidence_lines,
        suggested_owner: "harness/ship",
      };
      return {
        operationalClass: "class_5_preexisting_main",
        triage,
        allowsAutomatedCodeRepair: false,
        allowsBoundedRerun: false,
        userFacingSummary: `Check ${input.jobName} already fails on ${input.baseBranch}`,
      };
    }

    let v1 = detectV1Class(input);
    if (v1 === "infrastructure" && /503|runner|429|CDN timeout/i.test(input.logExcerpt.join("\n"))) {
      v1 = "flaky";
    }

    const operationalClass = mapToOperational(v1);
    const fingerprint = computeFailureFingerprint({
      errorType: v1,
      filePath: evidence_lines[0] ?? input.jobName,
      message: evidence_lines.join(" | "),
    });

    const triage = {
      class: v1,
      evidence_lines,
      suggested_owner:
        operationalClass === "class_4_missing_secret"
          ? "developer/github-secrets"
          : operationalClass === "class_2_portability"
            ? "harness/ci-repair"
            : "feature-owner",
    };

    return {
      operationalClass,
      triage,
      allowsAutomatedCodeRepair:
        operationalClass === "class_1_regression" || operationalClass === "class_2_portability",
      allowsBoundedRerun: operationalClass === "class_3_transient",
      userFacingSummary: `${operationalClass} (${fingerprint.slice(0, 8)})`,
    };
  }
}

export function extractSecretName(log: readonly string[]): string | undefined {
  for (const line of log) {
    const match = /secret ([A-Z0-9_]+) not set|missing.*secret.*?([A-Z0-9_]+)/i.exec(line);
    if (match) {
      return match[1] ?? match[2];
    }
  }
  return undefined;
}