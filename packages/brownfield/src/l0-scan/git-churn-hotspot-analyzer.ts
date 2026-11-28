import type { MinGitRepoInspectorPort } from "./git-exec.js";
import { gitOk } from "./git-exec.js";
import type { ChurnAnalysis, CoChangePair, ChurnFileHotspot } from "./types.js";

function numstatLimit(): number {
  return process.env.EF_L0_FAST_CHURN === "1" ? 50 : 300;
}

function parseNumstat(stdout: string): Map<string, number> {
  const counts = new Map<string, number>();
  const lines = stdout.split(/\r?\n/);
  let pendingCommit = true;
  for (const line of lines) {
    if (line.startsWith("commit ")) {
      pendingCommit = true;
      continue;
    }
    if (!line.trim()) continue;
    const parts = line.split("\t");
    if (parts.length < 3) {
      if (pendingCommit && !/^\d+\t\d+\t/.test(line)) pendingCommit = false;
      continue;
    }
    const path = parts[2]?.trim();
    if (!path || path === "/dev/null") continue;
    counts.set(path, (counts.get(path) ?? 0) + 1);
    pendingCommit = false;
  }
  return counts;
}

function parseCoChange(stdout: string): CoChangePair[] {
  const pairCounts = new Map<string, number>();
  const filesInCommit: string[] = [];
  const flush = () => {
    if (filesInCommit.length < 2) {
      filesInCommit.length = 0;
      return;
    }
    const unique = [...new Set(filesInCommit)].sort();
    for (let i = 0; i < unique.length; i += 1) {
      for (let j = i + 1; j < unique.length; j += 1) {
        const key = `${unique[i]!}\0${unique[j]!}`;
        pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
      }
    }
    filesInCommit.length = 0;
  };

  for (const line of stdout.split(/\r?\n/)) {
    if (line.startsWith("commit ")) {
      flush();
      continue;
    }
    const parts = line.split("\t");
    if (parts.length >= 3 && parts[2]) {
      const p = parts[2].trim();
      if (p && p !== "/dev/null") filesInCommit.push(p);
    }
  }
  flush();

  return [...pairCounts.entries()]
    .map(([key, togetherCommits]) => {
      const [a, b] = key.split("\0");
      return { a: a!, b: b!, togetherCommits };
    })
    .filter((p) => p.togetherCommits >= 2)
    .sort((x, y) => y.togetherCommits - x.togetherCommits)
    .slice(0, 20);
}

export class GitChurnHotspotAnalyzer {
  constructor(private readonly git: MinGitRepoInspectorPort) {}

  analyze(root: string, isGit: boolean): ChurnAnalysis {
    if (!isGit) {
      return {
        churnAvailable: false,
        hotspotFiles: [],
        coChangePairs: [],
        recentCommitStyles: [],
        branchNameSamples: [],
      };
    }

    const head = this.git.headSha(root);
    if (!head) {
      return {
        churnAvailable: false,
        hotspotFiles: [],
        coChangePairs: [],
        recentCommitStyles: [],
        branchNameSamples: [],
      };
    }

    const count = gitOk(this.git.runner, root, ["rev-list", "--count", "HEAD"]);
    if (count === "0" || count === "1") {
      return {
        churnAvailable: false,
        hotspotFiles: [],
        coChangePairs: [],
        recentCommitStyles: [],
        branchNameSamples: [],
      };
    }

    const numstat = gitOk(this.git.runner, root, [
      "log",
      `--numstat`,
      `-n`,
      String(numstatLimit()),
      "--no-merges",
      "--since=90.days.ago",
      "--format=commit %H",
    ]);
    if (!numstat) {
      return {
        churnAvailable: false,
        hotspotFiles: [],
        coChangePairs: [],
        recentCommitStyles: [],
        branchNameSamples: [],
      };
    }

    const counts = parseNumstat(numstat);
    const hotspotFiles: ChurnFileHotspot[] = [...counts.entries()]
      .map(([path, changeCount]) => ({ path, changeCount }))
      .sort((a, b) => b.changeCount - a.changeCount)
      .slice(0, 25);

    const coChangePairs = parseCoChange(numstat);

    const subjects = gitOk(this.git.runner, root, ["log", "-n", "20", "--no-merges", "--format=%s"]);
    const recentCommitStyles = subjects ? subjects.split(/\r?\n/).filter(Boolean) : [];

    const branches = gitOk(this.git.runner, root, ["for-each-ref", "--format=%(refname:short)", "refs/heads/", "-n", "15"]);
    const branchNameSamples = branches ? branches.split(/\r?\n/).filter(Boolean) : [];

    return {
      churnAvailable: true,
      hotspotFiles,
      coChangePairs,
      recentCommitStyles,
      branchNameSamples,
    };
  }
}