export type EditFormat = "apply_patch" | "str_replace" | "search_replace";

export type EditToolName =
  | EditFormat
  | "write_new_file"
  | "replace_lines";

export class EditApplyError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = new.target.name;
    this.code = code;
  }
}

export class AmbiguousEditMatchError extends EditApplyError {
  readonly matchLineNumbers: readonly number[];

  constructor(matchLineNumbers: readonly number[]) {
    super(
      "ambiguous_edit_match",
      `Ambiguous edit match at lines ${matchLineNumbers.join(", ")}. Provide more surrounding context.`,
    );
    this.matchLineNumbers = matchLineNumbers;
  }
}

export class SearchTextNotFoundError extends EditApplyError {
  constructor(message = "Search text was not found.") {
    super("search_text_not_found", message);
  }
}

export class EmptySearchTextError extends EditApplyError {
  constructor() {
    super("empty_search_text", "Search text must not be empty.");
  }
}

export class FileAlreadyExistsError extends EditApplyError {
  readonly path: string;

  constructor(editTool: string, path: string) {
    super("file_already_exists", `Use ${editTool} for existing files`);
    this.path = path;
  }
}

export class FileNotFoundForEditError extends EditApplyError {
  readonly path: string;

  constructor(path: string) {
    super("file_not_found", `File does not exist: ${path}`);
    this.path = path;
  }
}

export class BinaryFileEditError extends EditApplyError {
  readonly path: string;

  constructor(path: string) {
    super("binary_file", `Refusing to edit binary file ${path}.`);
    this.path = path;
  }
}

export class WriteScopeDeniedError extends EditApplyError {
  readonly path: string;

  constructor(path: string) {
    super("write_scope_denied", `Path is outside task-packet write_scope: ${path}`);
    this.path = path;
  }
}

export class ProtectedPathError extends EditApplyError {
  readonly path: string;

  constructor(path: string) {
    super("protected_path", `Refusing to edit protected path: ${path}`);
    this.path = path;
  }
}

export class PathEscapeDeniedError extends EditApplyError {
  readonly path: string;

  constructor(path: string, detail: string) {
    super("path_escape_denied", `Path escapes the worktree (${detail}): ${path}`);
    this.path = path;
  }
}

export class ElisionPlaceholderError extends EditApplyError {
  readonly placeholder: string;

  constructor(placeholder: string) {
    super(
      "elision_placeholder",
      `Replacement contains a lazy elision placeholder (${placeholder}). Send the full replacement text.`,
    );
    this.placeholder = placeholder;
  }
}

export class EditToolNotOfferedError extends EditApplyError {
  readonly tool: string;
  readonly editFormat: EditFormat;

  constructor(tool: string, editFormat: EditFormat) {
    super("edit_tool_not_offered", `Tool ${tool} is not offered for edit format ${editFormat}.`);
    this.tool = tool;
    this.editFormat = editFormat;
  }
}

export class ReplaceLinesNotEnabledError extends EditApplyError {
  readonly path: string;

  constructor(path: string) {
    super(
      "replace_lines_not_enabled",
      `replace_lines is not enabled for ${path} until the third consecutive failed edit on that file.`,
    );
    this.path = path;
  }
}

export class ReplaceLinesBoundsError extends EditApplyError {
  readonly path: string;
  readonly start: number;
  readonly end: number;
  readonly lineCount: number;

  constructor(path: string, start: number, end: number, lineCount: number) {
    super(
      "replace_lines_bounds",
      `replace_lines range ${start}..${end} is outside ${path} (${lineCount} lines).`,
    );
    this.path = path;
    this.start = start;
    this.end = end;
    this.lineCount = lineCount;
  }
}

export class StaleRangeHashError extends EditApplyError {
  readonly path: string;
  readonly start: number;
  readonly end: number;
  readonly expectedHash: string;
  readonly currentRangeHash: string;
  readonly currentLines: string;

  constructor(input: {
    readonly path: string;
    readonly start: number;
    readonly end: number;
    readonly expectedHash: string;
    readonly currentRangeHash: string;
    readonly currentLines: string;
  }) {
    super(
      "stale_range_hash",
      `Stale range_hash for ${input.path} lines ${input.start}–${input.end}. Current range_hash is ${input.currentRangeHash}.\n${input.currentLines}`,
    );
    this.path = input.path;
    this.start = input.start;
    this.end = input.end;
    this.expectedHash = input.expectedHash;
    this.currentRangeHash = input.currentRangeHash;
    this.currentLines = input.currentLines;
  }
}

export class FileChangedExternallyError extends EditApplyError {
  readonly path: string;
  readonly numberedView: string;

  constructor(path: string, numberedView: string) {
    super(
      "file_changed_externally",
      `File changed externally: ${path}. Fresh numbered view of the modified region:\n${numberedView}`,
    );
    this.path = path;
    this.numberedView = numberedView;
  }
}

export class NearestCandidateError extends EditApplyError {
  readonly failureIndex = 1 as const;
  readonly path: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly snippet: string;

  constructor(input: {
    readonly path: string;
    readonly startLine: number;
    readonly endLine: number;
    readonly snippet: string;
  }) {
    super(
      "nearest_candidate",
      `Your search text wasn't found. Closest match at lines ${input.startLine}\u2013${input.endLine}: ${input.snippet}`,
    );
    this.path = input.path;
    this.startLine = input.startLine;
    this.endLine = input.endLine;
    this.snippet = input.snippet;
  }
}

export const SMALLER_HUNK_HINT = "Use a smaller hunk.";

export class FreshRegionViewError extends EditApplyError {
  readonly failureIndex = 2 as const;
  readonly path: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly numberedView: string;
  readonly hint = SMALLER_HUNK_HINT;

  constructor(input: {
    readonly path: string;
    readonly startLine: number;
    readonly endLine: number;
    readonly numberedView: string;
  }) {
    super(
      "fresh_region_view",
      `Your search text wasn't found. Fresh numbered view of lines ${input.startLine}\u2013${input.endLine}:\n${input.numberedView}\nHint: ${SMALLER_HUNK_HINT}`,
    );
    this.path = input.path;
    this.startLine = input.startLine;
    this.endLine = input.endLine;
    this.numberedView = input.numberedView;
  }
}

export class ReplaceLinesUnlockedError extends EditApplyError {
  readonly failureIndex = 3 as const;
  readonly path: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly rangeHash: string;
  readonly numberedView: string;

  constructor(input: {
    readonly path: string;
    readonly startLine: number;
    readonly endLine: number;
    readonly rangeHash: string;
    readonly numberedView: string;
  }) {
    super(
      "replace_lines_unlocked",
      `Your search text wasn't found. replace_lines is now enabled for ${input.path} only. replace_lines(path, ${input.startLine}, ${input.endLine}, text, range_hash=${input.rangeHash})\n${input.numberedView}`,
    );
    this.path = input.path;
    this.startLine = input.startLine;
    this.endLine = input.endLine;
    this.rangeHash = input.rangeHash;
    this.numberedView = input.numberedView;
  }
}

export class EditStuckEscalation extends EditApplyError {
  readonly failureIndex = 4 as const;
  readonly attemptId: string;
  readonly filePath: string;
  readonly failureCount: number;

  constructor(attemptId: string, filePath: string, failureCount: number) {
    super(
      "edit_stuck",
      `Edit stuck on ${filePath} after ${failureCount} consecutive failed edits. Checkpoint and feed the loop fingerprint ladder.`,
    );
    this.attemptId = attemptId;
    this.filePath = filePath;
    this.failureCount = failureCount;
  }
}

export class PatchParseError extends EditApplyError {
  readonly line: number;

  constructor(line: number, message: string) {
    super("patch_parse", `Invalid apply_patch at line ${line}: ${message}`);
    this.line = line;
  }
}

export class SearchReplaceParseError extends EditApplyError {
  readonly line: number;

  constructor(line: number, message: string) {
    super("search_replace_parse", `Invalid search_replace block at line ${line}: ${message}`);
    this.line = line;
  }
}

export class OverlappingHunkError extends EditApplyError {
  readonly path: string;

  constructor(path: string) {
    super("overlapping_hunks", `Hunks overlap in ${path}. Nothing was written.`);
    this.path = path;
  }
}
