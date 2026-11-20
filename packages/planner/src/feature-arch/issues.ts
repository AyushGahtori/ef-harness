import type { ArchIssue } from "./types.js";

export function issue(
  code: string,
  message: string,
  refs?: { featureId?: string; nodeId?: string },
): ArchIssue {
  const out: ArchIssue = { code, message };
  if (refs?.featureId) out.featureId = refs.featureId;
  if (refs?.nodeId) out.nodeId = refs.nodeId;
  return out;
}
