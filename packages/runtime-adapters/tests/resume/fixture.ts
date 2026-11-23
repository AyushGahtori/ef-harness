import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { mustGit } from "../../src/resume/git-work.js";
import type {
  CompiledBrief,
  ForeignAdapterPort,
  FreshSessionSpec,
  FreshSessionStart,
  ResumeCallResult,
} from "../../src/resume/index.js";

export function initRepo(): { readonly root: string; readonly repo: string; cleanup(): void } {
  const root = mkdtempSync(path.join(tmpdir(), "ef-resume-"));
  const repo = path.join(root, "repo");
  mkdirSync(repo);
  mustGit(repo, ["init", "-b", "main"]);
  return {
    root,
    repo,
    cleanup() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

export function commitFile(repo: string, file: string, content: string, message: string): string {
  writeFileSync(path.join(repo, file), content);
  mustGit(repo, ["add", "--", file]);
  mustGit(repo, [
    "-c",
    "user.name=Harness Kernel",
    "-c",
    "user.email=kernel@harness.local",
    "commit",
    "-m",
    message,
  ]);
  return mustGit(repo, ["rev-parse", "HEAD"]).trim();
}

export function indexSha256(repo: string): string {
  const gitDir = mustGit(repo, ["rev-parse", "--absolute-git-dir"]).trim();
  return createHash("sha256").update(readFileSync(path.join(gitDir, "index"))).digest("hex");
}

export function readSlot(slot: string, file: string): string {
  return readFileSync(path.join(slot, file), "utf8");
}

export function slotExists(slot: string, file: string): boolean {
  try {
    readFileSync(path.join(slot, file));
    return true;
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
    if (code === "ENOENT") return false;
    throw error;
  }
}

export class FakeAdapter implements ForeignAdapterPort {
  resumeCalls = 0;
  lastResume: { readonly nativeSessionId: string; readonly checkpointRef: string } | null = null;
  readonly started: FreshSessionSpec[] = [];
  readonly steered: { readonly sessionId: string; readonly note: string }[] = [];
  resumeResult: ResumeCallResult = { ok: true, sessionId: "thread-1" };
  hang = false;

  constructor(
    readonly adapterId: string,
    readonly version: string,
    readonly nativeResumeSupported = true,
  ) {}

  async resume(nativeSessionId: string, checkpointRef: string): Promise<ResumeCallResult> {
    this.resumeCalls += 1;
    this.lastResume = { nativeSessionId, checkpointRef };
    if (this.hang) return new Promise(() => undefined);
    return this.resumeResult;
  }

  async startSession(spec: FreshSessionSpec): Promise<FreshSessionStart> {
    this.started.push(spec);
    return { sessionId: `fresh-${this.adapterId}-${this.started.length}`, pid: 4_000 + this.started.length };
  }

  async steer(sessionId: string, note: string): Promise<void> {
    this.steered.push({ sessionId, note });
  }
}

export function brief(patch: Partial<CompiledBrief> & Pick<CompiledBrief, "text" | "sliceSha256">): CompiledBrief {
  return {
    requirements: patch.requirements ?? ["ship the feature"],
    changeKind: patch.changeKind ?? "none",
    deltaNote: patch.deltaNote ?? "",
    contradictedTokens: patch.contradictedTokens ?? [],
    text: patch.text,
    sliceSha256: patch.sliceSha256,
  };
}
