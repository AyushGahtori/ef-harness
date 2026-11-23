import { spawnSync } from "node:child_process";
import { GitCommandError } from "./errors.js";
import type { ChangedFile, DeveloperIdentity } from "./types.js";
import {
  HUMAN_AUTHOR_MODE_VALUE,
  HUMAN_FIX_TRAILER_AUTHOR_MODE,
  HUMAN_FIX_TRAILER_TASK,
} from "./constants.js";

export interface GitResult {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

const FORBIDDEN = new Set(["reset", "rebase", "filter-branch", "filter-repo"]);

function assertAllowed(args: readonly string[]): void {
  const sub = args[0];
  if (sub && FORBIDDEN.has(sub)) {
    throw new Error(`forbidden git command: ${sub}`);
  }
}

export function runGit(repo: string, args: readonly string[], identity?: DeveloperIdentity, input?: string): GitResult {
  assertAllowed(args);
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (identity) {
    env.GIT_AUTHOR_NAME = identity.name;
    env.GIT_AUTHOR_EMAIL = identity.email;
    env.GIT_COMMITTER_NAME = identity.name;
    env.GIT_COMMITTER_EMAIL = identity.email;
  }
  const extra: string[] = [
    "-c",
    "core.autocrlf=false",
    "-c",
    "core.longpaths=true",
    "-c",
    "core.quotepath=false",
    "-c",
    "commit.gpgsign=false",
  ];
  if (identity) {
    extra.push("-c", `user.name=${identity.name}`, "-c", `user.email=${identity.email}`);
  }
  const result = spawnSync("git", ["-C", repo, ...extra, ...args], {
    encoding: "utf8",
    windowsHide: true,
    input,
    env,
  });
  return {
    status: result.status ?? 1,
    stdout: (result.stdout ?? "").replace(/\r\n/g, "\n"),
    stderr: (result.stderr ?? "").replace(/\r\n/g, "\n"),
  };
}

export class GitRepo {
  constructor(
    readonly repo: string,
    readonly commands: string[] = [],
  ) {}

  child(repo: string): GitRepo {
    return new GitRepo(repo, this.commands);
  }

  run(args: readonly string[], identity?: DeveloperIdentity, input?: string): GitResult {
    this.commands.push(args.join(" "));
    return runGit(this.repo, args, identity, input);
  }

  ok(args: readonly string[], identity?: DeveloperIdentity, input?: string): GitResult {
    const result = this.run(args, identity, input);
    if (result.status !== 0) {
      throw new GitCommandError(args[0] ?? "git", result.status, result.stderr || result.stdout);
    }
    return result;
  }

  revParse(ref: string): string {
    return this.ok(["rev-parse", "--verify", ref]).stdout.trim();
  }

  readIdentity(): DeveloperIdentity {
    const name = this.ok(["config", "user.name"]).stdout.trim();
    const email = this.ok(["config", "user.email"]).stdout.trim();
    return { name, email };
  }

  setIdentity(identity: DeveloperIdentity): void {
    this.ok(["config", "user.name", identity.name]);
    this.ok(["config", "user.email", identity.email]);
  }

  commitWithHumanTrailers(
    identity: DeveloperIdentity,
    taskId: string,
    message: string,
    paths?: readonly string[],
  ): string {
    if (paths && paths.length > 0) {
      this.ok(["add", "--", ...paths], identity);
    } else {
      this.ok(["add", "-A"], identity);
    }
    const body = [
      message,
      "",
      `${HUMAN_FIX_TRAILER_AUTHOR_MODE}: ${HUMAN_AUTHOR_MODE_VALUE}`,
      `${HUMAN_FIX_TRAILER_TASK}: ${taskId}`,
    ].join("\n");
    this.ok(["commit", "-m", body], identity);
    return this.revParse("HEAD");
  }

  parseAuthor(sha: string): DeveloperIdentity {
    const raw = this.ok(["log", "-1", "--format=%an <%ae>", sha]).stdout.trim();
    const match = /^(.+) <([^>]+)>$/.exec(raw);
    if (!match) {
      return { name: raw, email: "" };
    }
    return { name: match[1] ?? raw, email: match[2] ?? "" };
  }

  messageBody(sha: string): string {
    return this.ok(["log", "-1", "--format=%B", sha]).stdout;
  }

  diffNameOnly(base: string, head = "HEAD"): string[] {
    const result = this.ok(["diff", "--name-only", base, head]);
    return result.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  }

  statusPorcelain(): ChangedFile[] {
    const raw = this.ok(["status", "--porcelain"]).stdout;
    const out: ChangedFile[] = [];
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      const code = line.slice(0, 2);
      const path = line.slice(3).trim().replace(/^"(.*)"$/, "$1");
      if (code === "??") {
        out.push({ path, status: "added", untracked: true });
        continue;
      }
      const x = code[0];
      const y = code[1];
      if (x === "D" || y === "D") {
        out.push({ path, status: "deleted" });
      } else if (x === "A" || y === "A" || code === "??") {
        out.push({ path, status: "added" });
      } else {
        out.push({ path, status: "modified" });
      }
    }
    return out;
  }

  parseTrailer(sha: string, key: string): string | undefined {
    const body = this.messageBody(sha);
    const pattern = new RegExp(`^${key}:\\s*(.+)$`, "m");
    const match = pattern.exec(body);
    return match?.[1]?.trim();
  }
}