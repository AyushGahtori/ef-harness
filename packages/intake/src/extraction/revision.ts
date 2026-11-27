import { formatDocumentLocator } from "./locator.js";
import { snapshotSections } from "./outline.js";
import type { HybridRevisionFeed, NormalizedDocument, RevisionDelta } from "./types.js";

export interface SectionDiff {
  readonly deltas: readonly RevisionDelta[];
  readonly extractKeys: readonly string[];
  readonly skippedKeys: readonly string[];
}

function label(sourceName: string, page: number): string {
  return formatDocumentLocator(sourceName, { page, paragraph: null, section: null });
}

/** Section diff used by re-import. Unchanged sections are skipped, not re-extracted. */
export function diffNormalizedDocuments(previous: NormalizedDocument, next: NormalizedDocument): SectionDiff {
  const previousSections = snapshotSections(previous.blocks);
  const nextSections = snapshotSections(next.blocks);
  const previousByKey = new Map(previousSections.map((section) => [section.key, section]));
  const nextByKey = new Map(nextSections.map((section) => [section.key, section]));
  const deltas: RevisionDelta[] = [];
  const extractKeys: string[] = [];
  const skippedKeys: string[] = [];
  for (const section of nextSections) {
    const prior = previousByKey.get(section.key);
    if (!prior) {
      deltas.push({
        sectionKey: section.key,
        headingPath: section.headingPath,
        change: "added",
        previousText: null,
        nextText: section.text,
        locatorLabel: label(next.sourceName, section.page),
      });
      extractKeys.push(section.key);
      continue;
    }
    if (prior.text !== section.text) {
      deltas.push({
        sectionKey: section.key,
        headingPath: section.headingPath,
        change: "modified",
        previousText: prior.text,
        nextText: section.text,
        locatorLabel: label(next.sourceName, section.page),
      });
      extractKeys.push(section.key);
      continue;
    }
    skippedKeys.push(section.key);
  }
  for (const section of previousSections) {
    if (nextByKey.has(section.key)) continue;
    deltas.push({
      sectionKey: section.key,
      headingPath: section.headingPath,
      change: "removed",
      previousText: section.text,
      nextText: null,
      locatorLabel: label(previous.sourceName, section.page),
    });
  }
  return { deltas, extractKeys, skippedKeys };
}

export function hybridRevisionFeed(
  previous: NormalizedDocument,
  next: NormalizedDocument,
  deltas: readonly RevisionDelta[],
): HybridRevisionFeed {
  return {
    target: "task-087",
    contract: "hybrid-revision",
    previousSourceName: previous.sourceName,
    sourceName: next.sourceName,
    deltas,
  };
}
