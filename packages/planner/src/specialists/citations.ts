import { lineRangeInDiff } from "./diff.js";
import type { CitationGround, GroundedCitation } from "./types.js";

export interface CitationCheck {
  readonly ok: boolean;
  readonly problems: readonly string[];
}

/**
 * Every cited file, line range, node, and receipt must exist before display or action.
 * A citation that names nothing is not evidence.
 */
export function checkCitation(citation: GroundedCitation, ground: CitationGround): CitationCheck {
  const problems: string[] = [];
  const named =
    citation.filePath !== undefined ||
    citation.lineRange !== undefined ||
    citation.nodeId !== undefined ||
    citation.receiptId !== undefined;
  if (!named) problems.push("citation names no file, line, node, or receipt");
  if (citation.lineRange && !citation.filePath) problems.push("line range has no file");
  if (citation.filePath) {
    const lines = ground.files.get(citation.filePath);
    if (!lines) problems.push(`file is not in the grounded set: ${citation.filePath}`);
    if (citation.lineRange) {
      const inDiff = lineRangeInDiff(
        ground.files,
        citation.filePath,
        citation.lineRange.start,
        citation.lineRange.end,
      );
      if (!inDiff) {
        problems.push(
          `lines ${String(citation.lineRange.start)}-${String(citation.lineRange.end)} are not in ${citation.filePath}`,
        );
      }
    }
  }
  if (citation.nodeId && !ground.nodeIds.has(citation.nodeId)) {
    problems.push(`node is not in state.db: ${citation.nodeId}`);
  }
  if (citation.receiptId && !ground.receiptIds.has(citation.receiptId)) {
    problems.push(`receipt is not in state.db: ${citation.receiptId}`);
  }
  return { ok: problems.length === 0, problems };
}

export function filterGrounded<T extends GroundedCitation>(
  items: readonly T[],
  ground: CitationGround,
): readonly T[] {
  return items.filter((item) => checkCitation(item, ground).ok);
}
