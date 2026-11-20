import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { onTestFinished } from "vitest";
import {
  EditToolDispatcher,
  MemoryReadObservationCache,
  type EditFormat,
  type EditToolDispatcherOptions,
} from "../../src/edits/index.js";

export function tempWorktree(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ef-edit-"));
  onTestFinished(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });
  return root;
}

export function writeFile(root: string, relativePath: string, content: string): string {
  const absolute = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, content);
  return absolute;
}

export function readFile(root: string, relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

export function harness(input: {
  readonly root: string;
  readonly editFormat: EditFormat;
  readonly writeScope?: readonly string[];
  readonly attemptId?: string;
  readonly reader?: MemoryReadObservationCache;
}): { readonly edit: EditToolDispatcher; readonly reader: MemoryReadObservationCache } {
  const reader = input.reader ?? new MemoryReadObservationCache();
  const options: EditToolDispatcherOptions = {
    worktreePath: input.root,
    writeScope: input.writeScope ?? ["**"],
    attemptId: input.attemptId ?? "attempt-1",
    modelProfile: { editFormat: input.editFormat },
    fileReader: reader,
  };
  return { edit: new EditToolDispatcher(options), reader };
}

export function capture<T>(run: () => unknown): T {
  try {
    run();
  } catch (error) {
    return error as T;
  }
  throw new Error("expected the edit to throw");
}

export function searchReplaceDocument(blocks: readonly { path: string; search: string; replace: string }[]): string {
  return blocks
    .map((block) =>
      [
        block.path,
        `${"<".repeat(7)} SEARCH`,
        block.search,
        "=".repeat(7),
        block.replace,
        `${">".repeat(7)} REPLACE`,
      ].join("\n"),
    )
    .join("\n");
}
