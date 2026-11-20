import {
  SkillSecurityRejection,
  type CandidateSkill,
  type SecurityFinding,
  type SkillFile,
  type SkillSourceType,
} from "./model.js";
import {
  hasBinaryMagic,
  hasRejectedExtension,
  isAllowedSkillPath,
  isOsiLicense,
  textSecurityFindings,
} from "./patterns.js";

export interface SkillScanInput {
  readonly sourceType: SkillSourceType;
  readonly license: string;
  readonly upstreamRepo: string | null;
  readonly files: readonly SkillFile[];
}

/** Scans SKILL.md and companion files before any quarantine execution. */
export class StaticSkillSecurityVetter {
  scan(input: SkillScanInput): readonly SecurityFinding[] {
    const findings: SecurityFinding[] = [];
    let sawSkill = false;
    for (const file of input.files) {
      if (file.relativePath === "SKILL.md") sawSkill = true;
      findings.push(...this.scanFile(file, input));
    }
    if (!sawSkill) {
      findings.push({
        code: "unapproved_payload",
        path: "SKILL.md",
        detail: "SKILL.md is required",
      });
    }
    return findings;
  }

  assertClean(input: SkillScanInput): void {
    const findings = this.scan(input);
    if (findings.length > 0) throw new SkillSecurityRejection(findings);
  }

  assertCandidate(candidate: CandidateSkill): void {
    this.assertClean(candidate);
  }

  private scanFile(file: SkillFile, input: SkillScanInput): SecurityFinding[] {
    const findings: SecurityFinding[] = [];
    if (!isAllowedSkillPath(file.relativePath) || hasRejectedExtension(file.relativePath)) {
      findings.push({
        code: "unapproved_payload",
        path: file.relativePath,
        detail: "bundled executable or unapproved script hook",
      });
    }
    if (hasBinaryMagic(file.bytes) || file.bytes.includes(0)) {
      findings.push({
        code: "unapproved_payload",
        path: file.relativePath,
        detail: "bundled executable binary",
      });
    }
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(file.bytes);
    } catch {
      findings.push({
        code: "unapproved_payload",
        path: file.relativePath,
        detail: "file is not valid UTF-8 text",
      });
      return findings;
    }
    if (text.startsWith("#!")) {
      findings.push({
        code: "unapproved_payload",
        path: file.relativePath,
        detail: "shebang script hook",
      });
    }
    findings.push(...textSecurityFindings(file.relativePath, text));
    if (file.relativePath === "SKILL.md") {
      findings.push(...skillContractFindings(text, input));
    }
    return findings;
  }
}

function skillContractFindings(text: string, input: SkillScanInput): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  const tools = /^tools:\s*(.*)$/m.exec(text);
  const toolValue = tools?.[1]?.trim();
  if (toolValue !== undefined && toolValue !== "none") {
    findings.push({
      code: "tool_grant",
      path: "SKILL.md",
      detail: "a skill cannot add tools or permissions",
    });
  }
  if (/^hooks\s*:/m.test(text)) {
    findings.push({
      code: "unapproved_payload",
      path: "SKILL.md",
      detail: "skill hook declarations are rejected",
    });
  }
  if (input.license.trim().length === 0) {
    findings.push({
      code: "license",
      path: "SKILL.md",
      detail: "license attribution is missing",
    });
    return findings;
  }
  if (input.sourceType === "authored") return findings;
  if (!isOsiLicense(input.license)) {
    findings.push({
      code: "license",
      path: "SKILL.md",
      detail: `downloaded skill license ${input.license} is not OSI-compatible`,
    });
  }
  const spdx = new RegExp(`SPDX-License-Identifier:\\s*${escapeRegExp(input.license)}\\b`);
  if (!spdx.test(text) || !/Attribution:/i.test(text)) {
    findings.push({
      code: "license",
      path: "SKILL.md",
      detail: "downloaded skill is missing SPDX and Attribution lines",
    });
  } else if (input.upstreamRepo !== null && !text.includes(input.upstreamRepo)) {
    findings.push({
      code: "license",
      path: "SKILL.md",
      detail: "downloaded skill attribution does not name upstreamRepo",
    });
  }
  if (input.upstreamRepo === null) {
    findings.push({
      code: "license",
      path: "SKILL.md",
      detail: "downloaded skill is missing upstreamRepo attribution",
    });
  }
  return findings;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
