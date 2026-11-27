import type { GitRunner } from "./git-runner.js";
import { stripTrailingNewline } from "./git-runner.js";
import { GitCommandError, InvalidRefLeaseArgumentError, MissingGitIdentityError } from "./errors.js";

export interface GitIdentity {
  readonly name: string;
  readonly email: string;
}

export type CommitAuthor =
  | { readonly kind: "agent"; readonly role: string; readonly agentId: string }
  | { readonly kind: "human"; readonly name?: string; readonly email?: string };

const ROLE_RE = /^[A-Za-z]+(?: [A-Za-z]+)*$/;
const AGENT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export async function readCommitterIdentity(
  git: GitRunner,
  repoPath: string,
  env?: NodeJS.ProcessEnv,
): Promise<GitIdentity> {
  const name = await readConfig(git, repoPath, "user.name", env);
  const email = await readConfig(git, repoPath, "user.email", env);
  const missing: ("user.name" | "user.email")[] = [];
  if (!name) missing.push("user.name");
  if (!email) missing.push("user.email");
  if (missing.length > 0) {
    throw new MissingGitIdentityError(missing);
  }
  return { name, email };
}

export function resolveCommitIdentities(
  author: CommitAuthor,
  committer: GitIdentity,
  env?: NodeJS.ProcessEnv,
): { readonly author: GitIdentity; readonly committer: GitIdentity } {
  if (author.kind === "agent") {
    if (!ROLE_RE.test(author.role) || !AGENT_ID_RE.test(author.agentId)) {
      throw new InvalidRefLeaseArgumentError(
        "Agent authorship requires a role and an agent id such as Worker A0014.",
      );
    }
    return {
      author: {
        name: `${author.role} ${author.agentId}`,
        email: `${author.agentId}@harness.local`,
      },
      committer,
    };
  }
  if (author.name !== undefined || author.email !== undefined) {
    if (!author.name || !author.email || /[\r\n\0]/.test(author.name) || /[\r\n\0]/.test(author.email)) {
      throw new InvalidRefLeaseArgumentError("Human authorship needs both a name and an email.");
    }
    return { author: { name: author.name, email: author.email }, committer };
  }
  const envName = env?.GIT_AUTHOR_NAME ?? process.env.GIT_AUTHOR_NAME;
  const envEmail = env?.GIT_AUTHOR_EMAIL ?? process.env.GIT_AUTHOR_EMAIL;
  if (envName && envEmail && !/[\r\n\0]/.test(envName) && !/[\r\n\0]/.test(envEmail)) {
    return { author: { name: envName, email: envEmail }, committer };
  }
  return { author: committer, committer };
}

export function identityEnv(
  author: GitIdentity,
  committer: GitIdentity,
  nowMs: number,
  base?: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const seconds = Math.floor(nowMs / 1000);
  const stamp = `${seconds} +0000`;
  return {
    ...base,
    GIT_AUTHOR_NAME: author.name,
    GIT_AUTHOR_EMAIL: author.email,
    GIT_COMMITTER_NAME: committer.name,
    GIT_COMMITTER_EMAIL: committer.email,
    GIT_AUTHOR_DATE: stamp,
    GIT_COMMITTER_DATE: stamp,
  };
}

async function readConfig(
  git: GitRunner,
  repoPath: string,
  key: "user.name" | "user.email",
  env?: NodeJS.ProcessEnv,
): Promise<string> {
  const result = await git.execGit({
    cwd: repoPath,
    args: ["config", "--get", key],
    ...(env !== undefined ? { env } : {}),
  });
  if (result.exitCode === 0) {
    return stripTrailingNewline(result.stdout).trim();
  }
  if (result.exitCode === 1 && result.stdout.trim() === "") {
    return "";
  }
  throw new GitCommandError(`config --get ${key}`, result.exitCode, result.stderr);
}
