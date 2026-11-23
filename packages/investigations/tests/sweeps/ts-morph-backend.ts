import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CodemodBackendPort } from "../../src/sweeps/ports.js";
import type { CodemodRunResult } from "../../src/sweeps/types.js";

const rootPackage = path.join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "package.json");
const rootRequire = createRequire(rootPackage);

type SourceFileLike = {
  getFilePath: () => string;
  getText: () => string;
  replaceWithText: (text: string) => void;
  getFunction: (name: string) => { rename: (name: string) => void } | undefined;
  getFunctions: () => Array<{ getName: () => string | undefined; rename: (name: string) => void }>;
};

type TsMorphProject = {
  addSourceFilesAtPaths: (pattern: string | string[]) => unknown[];
  addSourceFileAtPath: (filePath: string) => SourceFileLike;
  getSourceFiles: () => SourceFileLike[];
  save: () => Promise<void>;
};

type TsMorphModule = {
  Project: new (opts: { skipAddingFilesFromTsConfig?: boolean }) => TsMorphProject;
};

function loadTsMorph(): TsMorphModule | null {
  try {
    return rootRequire("ts-morph") as TsMorphModule;
  } catch {
    return null;
  }
}

export function createTsMorphCodemodBackend(): CodemodBackendPort | null {
  const tsMorph = loadTsMorph();
  if (!tsMorph) return null;

  return {
    async runTsMorphRename(input): Promise<CodemodRunResult> {
      try {
        const project = new tsMorph.Project({ skipAddingFilesFromTsConfig: true });
        project.addSourceFilesAtPaths(path.join(input.projectRoot, "**/*.ts"));
        let filesChanged = 0;
        let linesAdded = 0;
        let linesRemoved = 0;
        const samplePaths: string[] = [];

        for (const source of project.getSourceFiles()) {
          const before = source.getText();
          let touched = false;
          const named = source.getFunction(input.oldName);
          if (named) {
            named.rename(input.newName);
            touched = true;
          }
          for (const fn of source.getFunctions()) {
            if (fn.getName() === input.oldName) {
              fn.rename(input.newName);
              touched = true;
            }
          }
          const after = source.getText();
          if (touched && before !== after) {
            filesChanged += 1;
            samplePaths.push(path.relative(input.projectRoot, source.getFilePath()).replaceAll("\\", "/"));
            linesAdded += Math.max(0, after.split("\n").length - before.split("\n").length);
            linesRemoved += Math.max(0, before.split("\n").length - after.split("\n").length);
            if (input.dryRun) {
              source.replaceWithText(before);
            }
          }
        }
        if (!input.dryRun) {
          await project.save();
        }
        return {
          ok: true,
          preview: {
            filesChanged,
            linesAdded,
            linesRemoved,
            samplePaths: Object.freeze(samplePaths.slice(0, 5)),
          },
          applied: !input.dryRun,
        };
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        return { ok: false, reason: "sandbox_error", detail };
      }
    },
    async runAstGrepRule(): Promise<CodemodRunResult> {
      return {
        ok: true,
        preview: { filesChanged: 0, linesAdded: 0, linesRemoved: 0, samplePaths: [] },
        applied: false,
      };
    },
  };
}