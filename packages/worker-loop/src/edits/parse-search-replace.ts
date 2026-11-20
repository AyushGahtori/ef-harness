import { SearchReplaceParseError } from "./errors.js";

export interface SearchReplaceBlock {
  readonly path: string;
  readonly search: string;
  readonly replace: string;
}

const SEARCH_START = `${"<".repeat(7)} SEARCH`;
const SEARCH_MID = "=".repeat(7);
const SEARCH_END = `${">".repeat(7)} REPLACE`;

export function parseSearchReplaceBlocks(source: string): readonly SearchReplaceBlock[] {
  const lines = source.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const blocks: SearchReplaceBlock[] = [];
  let index = 0;
  while (index < lines.length && (lines[index] ?? "").trim() === "") index += 1;
  if (index >= lines.length) throw new SearchReplaceParseError(1, "no blocks");
  while (index < lines.length) {
    if ((lines[index] ?? "").trim() === "") {
      index += 1;
      continue;
    }
    const filePath = (lines[index] ?? "").trim();
    const pathLine = index + 1;
    index += 1;
    if ((lines[index] ?? "") !== SEARCH_START) {
      throw new SearchReplaceParseError(index + 1, `expected ${SEARCH_START}`);
    }
    index += 1;
    const search: string[] = [];
    while (index < lines.length && (lines[index] ?? "") !== SEARCH_MID) {
      search.push(lines[index] ?? "");
      index += 1;
    }
    if ((lines[index] ?? "") !== SEARCH_MID) {
      throw new SearchReplaceParseError(pathLine, "block is missing the divider");
    }
    index += 1;
    const replace: string[] = [];
    while (index < lines.length && (lines[index] ?? "") !== SEARCH_END) {
      replace.push(lines[index] ?? "");
      index += 1;
    }
    if ((lines[index] ?? "") !== SEARCH_END) {
      throw new SearchReplaceParseError(pathLine, "block is missing the end marker");
    }
    index += 1;
    if (filePath.length === 0) throw new SearchReplaceParseError(pathLine, "missing path");
    blocks.push({ path: filePath, search: search.join("\n"), replace: replace.join("\n") });
  }
  if (blocks.length === 0) throw new SearchReplaceParseError(1, "no blocks");
  return blocks;
}
