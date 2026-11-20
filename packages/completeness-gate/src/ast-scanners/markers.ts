import ts from "typescript";
import type { StaticAuditContext, StaticAuditFinding } from "./types.js";
import { makeFinding } from "./locate.js";
import { deferralExpression, markerExpression } from "./terms.js";
import { collectComments } from "./ts-utils.js";

export interface MarkerScan {
  readonly findings: readonly StaticAuditFinding[];
  readonly recordedDeferralIds: readonly string[];
}

interface DeferralSpan {
  readonly start: number;
  readonly end: number;
  readonly approvedId: string | null;
  readonly rawId: string;
}

export function scanMarkersInText(
  file: string,
  text: string,
  auditContext: StaticAuditContext,
  searchable: string = text,
): MarkerScan {
  return scanMarkerSpan(file, text, searchable, 0, auditContext);
}

export function scanTypeScriptMarkers(file: string, sourceFile: ts.SourceFile, auditContext: StaticAuditContext): MarkerScan {
  const text = sourceFile.getFullText();
  const findings: StaticAuditFinding[] = [];
  const recorded: string[] = [];
  const absorb = (scan: MarkerScan) => {
    findings.push(...scan.findings);
    recorded.push(...scan.recordedDeferralIds);
  };

  for (const comment of collectComments(sourceFile)) {
    absorb(scanMarkerSpan(file, text, text.slice(comment.pos, comment.end), comment.pos, auditContext));
  }

  const visit = (node: ts.Node): void => {
    if (ts.isJsxText(node)) {
      absorb(scanMarkerSpan(file, text, node.getText(sourceFile), node.getStart(sourceFile), auditContext));
    }
    if (isScannedString(node)) {
      absorb(scanMarkerSpan(file, text, node.text, node.getStart(sourceFile), auditContext));
    }
    if (ts.isTemplateExpression(node)) {
      absorb(scanMarkerSpan(file, text, node.head.text, node.head.getStart(sourceFile), auditContext));
      for (const span of node.templateSpans) {
        absorb(
          scanMarkerSpan(file, text, span.literal.text, span.literal.getStart(sourceFile), auditContext),
        );
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return { findings, recordedDeferralIds: recorded };
}

function isScannedString(node: ts.Node): node is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node);
}

function scanMarkerSpan(
  file: string,
  fullText: string,
  spanText: string,
  spanStart: number,
  auditContext: StaticAuditContext,
): MarkerScan {
  const deferrals = findDeferrals(spanText, auditContext);
  const findings: StaticAuditFinding[] = [];
  const recorded: string[] = [];
  for (const deferral of deferrals) {
    if (deferral.approvedId) {
      recorded.push(deferral.approvedId);
      continue;
    }
    findings.push(
      markerFinding(
        file,
        fullText,
        spanStart + deferral.start,
        `Unapproved deferral ${deferral.rawId} is not an active kernel-approved id.`,
        "Remove the marker or reference a deferral id the kernel has approved.",
      ),
    );
  }

  for (const match of spanText.matchAll(markerExpression())) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (deferrals.some((deferral) => start < deferral.end && end > deferral.start)) continue;
    findings.push(
      markerFinding(
        file,
        fullText,
        spanStart + start,
        `Unfinished marker "${match[0]}" is not an exact approved deferral reference.`,
        "Finish the work or replace it with an exact approved deferral reference.",
      ),
    );
  }
  return { findings, recordedDeferralIds: recorded };
}

function findDeferrals(spanText: string, auditContext: StaticAuditContext): DeferralSpan[] {
  const spans: DeferralSpan[] = [];
  for (const match of spanText.matchAll(deferralExpression())) {
    const rawId = match[1] ?? "";
    const start = match.index ?? 0;
    spans.push({
      start,
      end: start + match[0].length,
      rawId,
      approvedId: resolveApproved(rawId, auditContext.approvedDeferralIds),
    });
  }
  return spans;
}

function resolveApproved(rawId: string, approved: readonly string[]): string | null {
  const needle = rawId.toUpperCase();
  for (const candidate of approved) {
    if (candidate.toUpperCase() === needle) return candidate;
  }
  return null;
}

function markerFinding(file: string, fullText: string, index: number, message: string, remediation: string): StaticAuditFinding {
  const lines = fullText.split(/\r?\n/);
  let line = 1;
  let column = 1;
  for (let i = 0; i < index && i < fullText.length; i += 1) {
    const ch = fullText[i];
    if (ch === "\n") {
      line += 1;
      column = 1;
      continue;
    }
    if (ch === "\r") continue;
    column += 1;
  }
  return makeFinding({
    ruleId: "unfinished-marker",
    severity: "hard",
    file,
    line,
    column,
    snippet: lines[line - 1] ?? "",
    message,
    remediation,
  });
}
