import fs from "node:fs";
import path from "node:path";

import { gitOrThrow, refExists, runGit } from "./git-repo.js";
import {
  ProtectedBranchExportError,
  WIP_COMMIT_PREFIX,
  type HandoffPlacement,
  type WipExportInput,
  type WipExportResult,
} from "./types.js";

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Builds `wip/<slug>-<date>` from the verified `harness/integration` HEAD.
 * Never force-updates, never pushes, and never moves `main` or `harness/integration`.
 */
export class WipBranchHandoffExporter {
  exportBundle(input: WipExportInput): WipExportResult {
    validate(input);
    const integrationRef = "refs/heads/harness/integration";
    const mainRef = "refs/heads/main";
    const integrationBefore = gitOrThrow(input.repoPath, ["rev-parse", integrationRef]);
    const mainBefore = gitOrThrow(input.repoPath, ["rev-parse", mainRef]);
    const branchBefore = runGit(input.repoPath, ["branch", "--show-current"]).stdout.trim();
    const branch = nextBranchName(input.repoPath, `wip/${input.projectSlug}-${input.date}`);
    if (branch === "main" || branch === "master" || branch === "harness/integration" || !branch.startsWith("wip/")) {
      throw new ProtectedBranchExportError(`refusing to export onto ${branch}`);
    }
    fs.mkdirSync(input.worktreeDirectory, { recursive: true });
    const worktreePath = path.join(input.worktreeDirectory, branch.replaceAll("/", "-"));
    if (fs.existsSync(worktreePath)) {
      throw new ProtectedBranchExportError(`worktree path already exists: ${worktreePath}`);
    }
    gitOrThrow(input.repoPath, ["worktree", "add", "-b", branch, worktreePath, integrationBefore]);
    try {
      for (const sha of input.verifiedUnmergedShas) {
        if (runGit(input.repoPath, ["merge-base", "--is-ancestor", sha, integrationBefore]).status === 0) {
          continue;
        }
        gitOrThrow(worktreePath, ["cherry-pick", sha]);
      }
      const wipCommits: { taskId: string; sha: string; subject: string }[] = [];
      for (const task of input.partialTasks) {
        for (const file of task.files) {
          assertRepoPath(file.path);
          const full = path.join(worktreePath, file.path);
          fs.mkdirSync(path.dirname(full), { recursive: true });
          fs.writeFileSync(full, file.contents, "utf8");
        }
        gitOrThrow(worktreePath, ["add", "--all"]);
        const subject = `${WIP_COMMIT_PREFIX}: ${task.taskId}]`;
        gitOrThrow(worktreePath, ["-c", "commit.gpgsign=false", "commit", "-m", subject]);
        wipCommits.push({
          taskId: task.taskId,
          sha: gitOrThrow(worktreePath, ["rev-parse", "HEAD"]),
          subject,
        });
      }
      const markdown = renderHandoff(input, branch);
      const handoffPath = path.join(worktreePath, "HANDOFF.md");
      fs.writeFileSync(handoffPath, markdown, "utf8");
      placeHandoff(worktreePath, input.handoffPlacement);
      const integrationAfter = gitOrThrow(input.repoPath, ["rev-parse", integrationRef]);
      const mainAfter = gitOrThrow(input.repoPath, ["rev-parse", mainRef]);
      const branchAfter = runGit(input.repoPath, ["branch", "--show-current"]).stdout.trim();
      if (integrationAfter !== integrationBefore || mainAfter !== mainBefore || branchAfter !== branchBefore) {
        throw new ProtectedBranchExportError("export moved main, harness/integration, or the checkout branch");
      }
      const taskIds = [
        ...input.partialTasks.map((task) => task.taskId),
        ...input.remaining.map((task) => task.taskId),
      ];
      return {
        branch,
        worktreePath,
        headSha: gitOrThrow(worktreePath, ["rev-parse", "HEAD"]),
        integrationSha: integrationAfter,
        mainSha: mainAfter,
        handoffPath,
        handoffMarkdown: markdown,
        openInVsCodeCommand: vscodeCommand(worktreePath),
        wipCommits,
        fixedItMyself: {
          compatible: true,
          phrase: "I Fixed It Myself",
          branch,
          taskIds,
        },
      };
    } catch (error) {
      runGit(input.repoPath, ["worktree", "remove", "--force", worktreePath]);
        if (refExists(input.repoPath, `refs/heads/${branch}`)) {
          const tip = gitOrThrow(input.repoPath, ["rev-parse", `refs/heads/${branch}`]);
          if (tip === integrationBefore) {
            runGit(input.repoPath, ["branch", "-d", branch]);
          }
        }
      throw error;
    }
  }
}

export function vscodeCommand(repoPath: string): string {
  return `code ${quoteArg(repoPath)}`;
}

export function wipCommitSubject(taskId: string): string {
  return `${WIP_COMMIT_PREFIX}: ${taskId}]`;
}

function validate(input: WipExportInput): void {
  if (!SLUG.test(input.projectSlug)) {
    throw new ProtectedBranchExportError("project slug must be lowercase words separated by hyphens");
  }
  if (!DATE.test(input.date)) {
    throw new ProtectedBranchExportError("export date must be YYYY-MM-DD");
  }
  if (input.projectSlug === "main" || input.projectSlug === "master") {
    throw new ProtectedBranchExportError("refusing to export a protected slug");
  }
}

function nextBranchName(repo: string, base: string): string {
  if (!refExists(repo, `refs/heads/${base}`)) return base;
  for (let suffix = 2; suffix < 100; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!refExists(repo, `refs/heads/${candidate}`)) return candidate;
  }
  throw new ProtectedBranchExportError(`no free branch name near ${base}`);
}

function placeHandoff(worktree: string, placement: HandoffPlacement): void {
  if (placement === "commit") {
    gitOrThrow(worktree, ["add", "--", "HANDOFF.md"]);
    gitOrThrow(worktree, ["-c", "commit.gpgsign=false", "commit", "-m", "Add HANDOFF.md"]);
    return;
  }
  if (placement === "excluded") {
    const excludePath = path.resolve(worktree, gitOrThrow(worktree, ["rev-parse", "--git-path", "info/exclude"]));
    fs.mkdirSync(path.dirname(excludePath), { recursive: true });
    const prior = fs.existsSync(excludePath) ? fs.readFileSync(excludePath, "utf8") : "";
    if (!prior.split(/\r?\n/).includes("HANDOFF.md")) {
      fs.appendFileSync(excludePath, `${prior.endsWith("\n") || prior.length === 0 ? "" : "\n"}HANDOFF.md\n`, "utf8");
    }
  }
}

function renderHandoff(input: WipExportInput, branch: string): string {
  const done = input.done.length
    ? input.done.map((feature) => `- ${feature.title} — DONE`).join("\n")
    : "- Nothing merged yet.";
  const remaining = input.remaining.length
    ? input.remaining.map((task) => formatTask(task.taskId, task.title, task.acceptanceCriteria)).join("\n\n")
    : "No unchecked tasks.";
  const partials = input.partialTasks.length
    ? input.partialTasks.map((task) => formatPartial(task)).join("\n\n")
    : "No partial edits.";
  const taskIds = [...input.partialTasks.map((task) => task.taskId), ...input.remaining.map((task) => task.taskId)];
  return [
    `# Handoff for ${input.projectSlug}`,
    "",
    "Your finished work on harness/integration is unchanged. This branch is only the unfinished part.",
    "",
    "## Already built and passing",
    "",
    done,
    "",
    "## Still to do",
    "",
    remaining,
    "",
    "## In progress",
    "",
    partials,
    "",
    "## Commands",
    "",
    `Run tests: \`${input.testCommand}\``,
    `Preview locally: \`${input.previewCommand}\``,
    "",
    "## After you finish",
    "",
    "Open this branch in the editor, finish the tasks above, then come back and choose \"I Fixed It Myself\".",
    "EF Harness will verify your work and can accept the tasks that pass.",
    "This export did not change main or harness/integration.",
    "",
    `ef-fixed-it-myself: ${branch} tasks ${taskIds.join(", ")}`,
    "",
  ].join("\n");
}

function formatTask(taskId: string, title: string, criteria: readonly string[]): string {
  const bullets = criteria.map((item) => `- ${item}`).join("\n");
  return `### ${taskId} ${title}\n${bullets}`;
}

function formatPartial(task: WipExportInput["partialTasks"][number]): string {
  const files = task.files.map((file) => `- ${file.path}`).join("\n");
  return [
    `### ${task.taskId} ${task.title}`,
    "These edits are not verified.",
    "",
    "Files:",
    files,
    "",
    "Last failing test:",
    fence(task.failingTestOutput),
    "",
    "Acceptance:",
    task.acceptanceCriteria.map((item) => `- ${item}`).join("\n"),
  ].join("\n");
}

function fence(body: string): string {
  let size = 3;
  while (body.includes("`".repeat(size))) size += 1;
  const ticks = "`".repeat(size);
  return `${ticks}\n${body}\n${ticks}`;
}

function quoteArg(value: string): string {
  if (!/[\s"]/.test(value)) return value;
  return `"${value.replaceAll("\"", "\\\"")}"`;
}

function assertRepoPath(filePath: string): void {
  if (path.isAbsolute(filePath) || filePath.split(/[\\/]/).includes("..")) {
    throw new ProtectedBranchExportError(`refusing path ${filePath}`);
  }
}
