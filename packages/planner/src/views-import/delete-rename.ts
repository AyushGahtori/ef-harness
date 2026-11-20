import path from "node:path";
import { cloneFields, isFieldMap } from "./hash.js";
import type { DeleteConfirmation, FieldMap, FieldValue, ImpactPreview, MoveConfirmation, MangledMarkerConfirmation } from "./types.js";

const REATTACH_THRESHOLD = 0.6;

export interface MangledCandidate {
  readonly nodeId: string;
  readonly title: string;
  readonly filePath: string;
  readonly previousNodeId: string | null;
  readonly nextNodeId: string | null;
}

export interface UnmarkedCandidate {
  readonly heading: string;
  readonly index: number;
  readonly previousNodeId: string | null;
  readonly nextNodeId: string | null;
}

/**
 * Deletion, rename, move, and damaged-marker decisions.
 * Removing a block never becomes a hard delete. Creating a duplicate always waits for confirmation.
 */
export class SafeDeleteRenameHandler {
  removalCard(input: {
    readonly filePath: string;
    readonly nodeId: string;
    readonly title: string;
    readonly impact: ImpactPreview;
  }): DeleteConfirmation {
    const fileName = path.posix.basename(input.filePath.replaceAll("\\", "/"));
    return {
      cardId: `delete:${input.filePath}:${input.nodeId}`,
      kind: "delete",
      filePath: input.filePath,
      nodeId: input.nodeId,
      title: input.title,
      message: `You removed '${input.title}' from ${fileName} — Mark as removed/deprecated or Restore block?`,
      prompt: "Restore or Deprecate?",
      actions: ["deprecate", "restore"],
      impact: input.impact,
    };
  }

  moveCard(input: {
    readonly nodeId: string;
    readonly fromFile: string;
    readonly toFile: string;
    readonly fromFeatureId: string | null;
    readonly toFeatureId: string | null;
  }): MoveConfirmation {
    const fromName = path.posix.basename(input.fromFile.replaceAll("\\", "/"));
    const toName = path.posix.basename(input.toFile.replaceAll("\\", "/"));
    return {
      cardId: `move:${input.nodeId}:${input.fromFile}:${input.toFile}`,
      kind: "move",
      nodeId: input.nodeId,
      fromFile: input.fromFile,
      toFile: input.toFile,
      fromFeatureId: input.fromFeatureId,
      toFeatureId: input.toFeatureId,
      message: `Cut-and-paste detected: ${input.nodeId} moved from ${fromName} to ${toName}. Confirm feature reassignment.`,
      actions: ["confirm_move", "cancel_move"],
    };
  }

  matchMangled(missing: readonly MangledCandidate[], unmarked: readonly UnmarkedCandidate[]): MangledMarkerConfirmation[] {
    const used = new Set<number>();
    const cards: MangledMarkerConfirmation[] = [];
    const ranked = missing
      .flatMap((candidate) =>
        unmarked.map((section) => ({
          candidate,
          section,
          similarity: scoreMatch(candidate, section),
        })),
      )
      .filter((item) => item.similarity >= REATTACH_THRESHOLD)
      .sort((left, right) => right.similarity - left.similarity);
    const usedNodes = new Set<string>();
    for (const item of ranked) {
      if (usedNodes.has(item.candidate.nodeId) || used.has(item.section.index)) continue;
      usedNodes.add(item.candidate.nodeId);
      used.add(item.section.index);
      cards.push({
        cardId: `mangled:${item.candidate.filePath}:${item.candidate.nodeId}`,
        kind: "mangled_marker",
        filePath: item.candidate.filePath,
        nodeId: item.candidate.nodeId,
        heading: item.section.heading,
        similarity: item.similarity,
        message: `The ef:node marker for '${item.candidate.title}' (${item.candidate.nodeId}) looks damaged. Reattach it, or confirm before creating a duplicate node.`,
        actions: ["reattach", "create_new"],
      });
    }
    return cards;
  }

  consumedUnmarkedIndexes(cards: readonly MangledMarkerConfirmation[], unmarked: readonly UnmarkedCandidate[]): Set<number> {
    const headings = new Set(cards.map((card) => card.heading));
    const indexes = new Set<number>();
    for (const section of unmarked) {
      if (headings.has(section.heading)) indexes.add(section.index);
    }
    return indexes;
  }

  renameNames(fields: FieldMap, previousTitle: string, nextTitle: string): FieldMap {
    const next = cloneFields(fields);
    const names = next.names;
    if (!Array.isArray(names)) {
      next.names = [{ kind: "title", value: nextTitle }];
      return next;
    }
    let replaced = false;
    const rewritten: FieldValue[] = names.map((entry) => {
      if (!isFieldMap(entry) || typeof entry.kind !== "string" || typeof entry.value !== "string") return entry;
      if (entry.value !== previousTitle) return entry;
      replaced = true;
      return { kind: entry.kind, value: nextTitle };
    });
    if (!replaced) rewritten.push({ kind: "title", value: nextTitle });
    next.names = rewritten;
    return next;
  }
}

export function headingSimilarity(left: string, right: string): number {
  const a = tokens(left);
  const b = tokens(right);
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function scoreMatch(candidate: MangledCandidate, section: UnmarkedCandidate): number {
  const heading = headingSimilarity(candidate.title, section.heading);
  const neighbor =
    candidate.previousNodeId === section.previousNodeId && candidate.nextNodeId === section.nextNodeId ? 1 : 0;
  return Math.min(1, heading * 0.75 + neighbor * 0.25);
}

function tokens(value: string): Set<string> {
  return new Set(value.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 0));
}

export function impactFromEdges(
  nodeId: string,
  edges: readonly { src: string; type: string; dst: string }[],
): ImpactPreview {
  const related = edges.filter((edge) => edge.src === nodeId || edge.dst === nodeId);
  return {
    nodeId,
    summary: `Deprecating ${nodeId} touches ${String(related.length)} current edge(s). Full reverse impact_walk is deferred to Task 087.`,
    edges: related.map((edge) => ({ src: edge.src, type: edge.type, dst: edge.dst })),
  };
}
