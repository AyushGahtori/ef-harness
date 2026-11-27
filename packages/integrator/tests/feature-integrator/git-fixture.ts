import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { gitOk, revParse } from "../../src/feature-integrator/git.js";
import type { HttpMethod, IntegratorWiringNeed, SeamId, WiringKind } from "../../src/feature-integrator/types.js";

export function initRepo(): string {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "ef-fi-"));
  gitOk({ repo, args: ["init", "-b", "main"] });
  return repo;
}

export function removeRepo(repo: string): void {
  fs.rmSync(repo, { recursive: true, force: true });
}

export function commitAll(
  repo: string,
  branch: string,
  files: Readonly<Record<string, string>>,
  message: string,
  startAt?: string,
): string {
  gitOk({
    repo,
    args: startAt ? ["checkout", "-B", branch, startAt] : ["checkout", "-B", branch],
  });
  for (const [file, text] of Object.entries(files)) {
    const full = path.join(repo, file);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, text.endsWith("\n") ? text : `${text}\n`, "utf8");
  }
  gitOk({ repo, args: ["add", "--", ...Object.keys(files)] });
  gitOk({ repo, args: ["commit", "-m", message] });
  return revParse(repo, "HEAD");
}

export function pointRef(repo: string, ref: string, sha: string): void {
  gitOk({ repo, args: ["update-ref", ref, sha] });
}

export function porcelain(repo: string): string {
  return gitOk({ repo, args: ["status", "--porcelain"] }).stdout;
}

export function wiringNeed(input: {
  readonly kind: WiringKind;
  readonly path: string;
  readonly taskId: string;
  readonly component?: string | null;
  readonly method?: HttpMethod;
  readonly seamId?: SeamId | null;
  readonly effects?: IntegratorWiringNeed["effects"];
}): IntegratorWiringNeed {
  return {
    kind: input.kind,
    path: input.path,
    component: input.component ?? null,
    taskId: input.taskId,
    method: input.method ?? "GET",
    seamId: input.seamId ?? null,
    effects: input.effects ?? null,
  };
}
