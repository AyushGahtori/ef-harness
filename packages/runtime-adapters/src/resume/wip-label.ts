import {
  LARGE_WIP_FILE_BYTES,
  PRIOR_UNVERIFIED_WIP,
  PRIOR_UNVERIFIED_WIP_HEADER,
  WIP_HANDOFF_TOKEN_LIMIT,
  estimateTokens,
} from "./types.js";

export interface HandoffFile {
  readonly path: string;
  readonly bytes: number;
  readonly lines: number;
  readonly excerpt: string | null;
}

export interface LabeledWipHandoff {
  readonly text: string;
  readonly tokens: number;
}

/**
 * Bounded `[PRIOR UNVERIFIED WIP]` note. Large generated files contribute a
 * path and a line count, never their body, and the whole note stays <= 1,500 tokens.
 */
export function buildLabeledWipHandoff(input: {
  readonly files: readonly HandoffFile[];
  readonly wipedPaths: readonly string[];
  readonly lastFailingCheck: string | null;
  readonly note: string | null;
}): LabeledWipHandoff {
  const fileLines = input.files.map((file) => formatFileLine(file));
  const wipedLines =
    input.wipedPaths.length === 0 ? ["- (none)"] : input.wipedPaths.map((item) => `- ${item}`);
  const required = [
    PRIOR_UNVERIFIED_WIP_HEADER,
    PRIOR_UNVERIFIED_WIP,
    "Files:",
    ...fileLines,
    "Wiped:",
    ...wipedLines,
    `Last failing check: ${input.lastFailingCheck ?? "none"}`,
  ];
  if (input.note && input.note.length > 0) required.push(`Note: ${input.note}`);
  const fitted = fitRequired(required);
  const excerpts: string[] = [];
  for (const file of input.files) {
    if (!file.excerpt) continue;
    excerpts.push(`--- ${file.path}`);
    excerpts.push(file.excerpt);
  }
  let text = fitted.join("\n");
  for (const line of excerpts) {
    const next = `${text}\n${line}`;
    if (estimateTokens(next) > WIP_HANDOFF_TOKEN_LIMIT) break;
    text = next;
  }
  return { text, tokens: estimateTokens(text) };
}

function formatFileLine(file: HandoffFile): string {
  const lineWord = file.lines === 1 ? "line" : "lines";
  if (file.bytes >= LARGE_WIP_FILE_BYTES || file.excerpt === null) {
    return `- ${file.path} (${file.lines} ${lineWord}, ${file.bytes} bytes)`;
  }
  return `- ${file.path} (${file.lines} ${lineWord})`;
}

function fitRequired(lines: readonly string[]): string[] {
  const kept = [...lines];
  while (estimateTokens(kept.join("\n")) > WIP_HANDOFF_TOKEN_LIMIT) {
    const fileIndex = kept.findIndex((line) => line.startsWith("- ") && line !== "- (none)");
    if (fileIndex < 0) break;
    kept.splice(fileIndex, 1);
  }
  return kept;
}
