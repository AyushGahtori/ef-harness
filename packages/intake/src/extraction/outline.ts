import type { NormalizedBlock } from "./types.js";
import { estimateTokens } from "./tokens.js";

export interface StructuredBlock {
  readonly block: NormalizedBlock;
  readonly headingPath: readonly string[];
  readonly sectionId: string;
  readonly sectionKey: string;
  readonly topHeading: string;
}

export function assignStructure(blocks: readonly NormalizedBlock[]): readonly StructuredBlock[] {
  const headingLevels = blocks.filter((block) => block.kind === "heading").map((block) => block.level ?? 1);
  const topLevel = headingLevels.length > 0 ? Math.min(...headingLevels) : 1;
  const stack: { level: number; title: string }[] = [];
  let topCount = 0;
  let sectionId = "0";
  const structured: StructuredBlock[] = [];
  for (const block of blocks) {
    if (block.kind === "heading") {
      const level = block.level ?? 1;
      while (stack.length > 0 && (stack[stack.length - 1]?.level ?? 0) >= level) {
        stack.pop();
      }
      stack.push({ level, title: block.text });
      if (level === topLevel) {
        topCount += 1;
        sectionId = String(topCount);
      }
    }
    const headingPath = stack.map((entry) => entry.title);
    const sectionKey = headingPath.join(" / ");
    structured.push({
      block,
      headingPath,
      sectionId: headingPath.length === 0 ? "0" : sectionId,
      sectionKey,
      topHeading: headingPath[0] ?? "",
    });
  }
  return structured;
}

export interface SectionSnapshot {
  readonly key: string;
  readonly headingPath: readonly string[];
  readonly sectionId: string;
  readonly text: string;
  readonly page: number;
  readonly tokenCount: number;
}

/** Direct body of each heading path, not the text of nested sections. */
export function snapshotSections(blocks: readonly NormalizedBlock[]): readonly SectionSnapshot[] {
  const structured = assignStructure(blocks);
  const groups = new Map<string, StructuredBlock[]>();
  const order: string[] = [];
  for (const item of structured) {
    if (!item.sectionKey || item.block.kind === "page_break") continue;
    const existing = groups.get(item.sectionKey);
    if (!existing) {
      groups.set(item.sectionKey, [item]);
      order.push(item.sectionKey);
    } else {
      existing.push(item);
    }
  }
  return order.map((key) => {
    const items = groups.get(key) ?? [];
    const text = items.map((item) => item.block.text).join("\n");
    const first = items[0];
    return {
      key,
      headingPath: first?.headingPath ?? [],
      sectionId: first?.sectionId ?? "0",
      text,
      page: first?.block.page ?? 1,
      tokenCount: estimateTokens(text),
    };
  });
}
