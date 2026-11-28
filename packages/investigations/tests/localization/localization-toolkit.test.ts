import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CrossBrowserDiffRunner,
  DeltaDebuggingInputShrinker,
  FlakeSafeGitBisector,
  FlakyReproBlocksBisectError,
  HypothesisLoopGuard,
  DuplicateFalsifiedHypothesisError,
  SymptomPatchDetector,
  fingerprintsMatch,
  normalizeFailureFingerprint,
  type BrowserRunSnapshot,
  type ReproOutcome,
} from "../../src/localization/index.js";

const REGRESSION_FP = "REGRESSION_SUM_MISMATCH";
const SYNTAX_FP = "SYNTAX_ERROR_UNRELATED";

type SeedRepo = {
  readonly dir: string;
  readonly commits: readonly string[];
  readonly regressionCommit: string;
  readonly brokenSyntaxCommit: string;
};

function git(dir: string, args: string[]): string {
  return execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
}

function commit(dir: string, message: string): string {
  git(dir, ["commit", "-m", message]);
  return git(dir, ["rev-parse", "HEAD"]);
}

function seedTenCommitRepo(): SeedRepo {
  const dir = mkdtempSync(path.join(os.tmpdir(), "ef-bisect-"));
  git(dir, ["init", "-b", "main"]);
  git(dir, ["config", "user.email", "agent@ef-harness.local"]);
  git(dir, ["config", "user.name", "EF Harness"]);

  const calcPath = path.join(dir, "calc.mjs");
  const reproPath = path.join(dir, "repro.mjs");

  writeFileSync(
    reproPath,
    `import { add } from './calc.mjs';
const value = add(2, 3);
if (value === 5) {
  process.exit(0);
}
throw new Error('REGRESSION_SUM_MISMATCH expected 5 got ' + value);
`,
    "utf8",
  );

  const commits: string[] = [];
  const writeGood = () => {
    writeFileSync(
      calcPath,
      `export function add(a, b) { return a + b; }\n`,
      "utf8",
    );
  };

  writeGood();
  git(dir, ["add", "calc.mjs", "repro.mjs"]);
  commits.push(commit(dir, "c1 good baseline"));

  for (let i = 2; i <= 3; i += 1) {
    writeFileSync(calcPath, `export function add(a, b) { return a + b; } // v${i}\n`, "utf8");
    git(dir, ["add", "calc.mjs"]);
    commits.push(commit(dir, `c${i} good tweak`));
  }

  writeFileSync(calcPath, `export function add(a, b) { return a + // broken\n`, "utf8");
  git(dir, ["add", "calc.mjs"]);
  const brokenSyntaxCommit = commit(dir, "c4 broken syntax");
  commits.push(brokenSyntaxCommit);

  writeGood();
  git(dir, ["add", "calc.mjs"]);
  commits.push(commit(dir, "c5 repair syntax"));

  writeFileSync(calcPath, `export function add(a, b) { return a - b; }\n`, "utf8");
  git(dir, ["add", "calc.mjs"]);
  const regressionCommit = commit(dir, "c6 introduce regression");
  commits.push(regressionCommit);

  for (let i = 7; i <= 10; i += 1) {
    writeFileSync(calcPath, `export function add(a, b) { return a - b; } // v${i}\n`, "utf8");
    git(dir, ["add", "calc.mjs"]);
    commits.push(commit(dir, `c${i} still bad`));
  }

  return { dir, commits, regressionCommit, brokenSyntaxCommit };
}

async function runReproInRepo(repoDir: string): Promise<ReproOutcome> {
  try {
    const output = execFileSync("node", ["repro.mjs"], {
      cwd: repoDir,
      encoding: "utf8",
    });
    return { exitCode: 0, output, fingerprint: "PASS" };
  } catch (error) {
    const err = error as { status?: number; stdout?: string; stderr?: string };
    const output = `${err.stdout ?? ""}${err.stderr ?? ""}`;
    if (/SyntaxError|Unexpected token|Invalid or unexpected token/i.test(output)) {
      return { exitCode: 2, output, fingerprint: SYNTAX_FP };
    }
    if (/REGRESSION_SUM_MISMATCH/.test(output)) {
      return { exitCode: 1, output, fingerprint: REGRESSION_FP };
    }
    return { exitCode: err.status ?? 1, output, fingerprint: output.slice(0, 120) };
  }
}

const tempRepos: string[] = [];
afterEach(() => {
  tempRepos.length = 0;
});

describe("FlakeSafeGitBisector", () => {
  it("enforces 5/5 stability, skips broken #4, isolates regression #6, and verifies parent", async () => {
    const repo = seedTenCommitRepo();
    tempRepos.push(repo.dir);
    const bisector = new FlakeSafeGitBisector();
    const goodRef = repo.commits[0] ?? "HEAD";
    const badRef = repo.commits[repo.commits.length - 1] ?? "HEAD";

    const result = await bisector.run({
      repoPath: repo.dir,
      goodRef,
      badRef,
      runRepro: () => runReproInRepo(repo.dir),
    });

    expect(result.skippedCommitCount).toBeGreaterThanOrEqual(1);
    expect(result.suspectCommit).toBe(repo.regressionCommit);
    expect(result.revertVerified).toBe(true);
    expect(result.stability.badRuns).toHaveLength(5);
    expect(result.stability.goodRuns).toHaveLength(5);
    expect(
      result.stability.badRuns.every(
        (run) => run.exitCode !== 0 && fingerprintsMatch(REGRESSION_FP, run.fingerprint),
      ),
    ).toBe(true);
  }, 120_000);

  it("refuses flaky reproductions", async () => {
    const repo = seedTenCommitRepo();
    let flip = 0;
    await expect(
      new FlakeSafeGitBisector().run({
        repoPath: repo.dir,
        badRef: repo.commits.at(-1) ?? "HEAD",
        goodRef: repo.commits[0] ?? "HEAD",
        runRepro: async () => {
          flip += 1;
          if (flip % 2 === 0) {
            return { exitCode: 0, output: "", fingerprint: "PASS" };
          }
          return { exitCode: 1, output: "fail", fingerprint: REGRESSION_FP };
        },
      }),
    ).rejects.toBeInstanceOf(FlakyReproBlocksBisectError);
  }, 120_000);
});

describe("DeltaDebuggingInputShrinker", () => {
  it("shrinks 200 items to minimal {42,189} within budget", async () => {
    const target = "DUPLICATE_KEY";
    const items = [42, 189, ...Array.from({ length: 198 }, (_, i) => i + 1)];
    const shrinker = new DeltaDebuggingInputShrinker();
    const result = await shrinker.shrink({
      input: items,
      targetFingerprint: target,
      runWithSubset: async (subset) => {
        const hasPair = subset.includes(42) && subset.includes(189);
        if (hasPair) {
          return { exitCode: 1, output: "DUPLICATE_KEY", fingerprint: target };
        }
        return { exitCode: 0, output: "ok", fingerprint: "PASS" };
      },
    });

    expect(result.evaluations).toBeLessThanOrEqual(40);
    expect(result.minimalInput).toContain(42);
    expect(result.minimalInput).toContain(189);
    expect(result.minimalInput.length).toBe(2);
    expect(result.fingerprint).toBe(normalizeFailureFingerprint(target));
  });
});

describe("SymptomPatchDetector", () => {
  const cases: Array<{ name: string; diff: string; kind: string }> = [
    {
      name: "empty catch",
      diff: "+    try { run(); } catch (e) {}\n",
      kind: "empty_catch",
    },
    {
      name: "sleep mask",
      diff: "+    await new Promise((r) => setTimeout(r, 500));\n",
      kind: "arbitrary_delay",
    },
    {
      name: "crash-site paper-over",
      diff: "+    return foo?.bar?.baz ?? [];\n",
      kind: "crash_site_guard",
    },
    {
      name: "test weakening",
      diff: "+  test.retries(5);\n",
      kind: "test_weakening",
    },
  ];

  for (const testCase of cases) {
    it(`flags ${testCase.name}`, () => {
      const audit = new SymptomPatchDetector().analyze({ unifiedDiff: testCase.diff });
      expect(audit.flagged).toBe(true);
      expect(audit.findings.some((f) => f.kind === testCase.kind)).toBe(true);
    });
  }

  it("allows legitimate upstream fix diff", () => {
    const diff = `+    const cutoff = loadCutoff(session);\n+    if (!cutoff) throw new Error('missing cutoff');\n`;
    const audit = new SymptomPatchDetector().analyze({ unifiedDiff: diff });
    expect(audit.flagged).toBe(false);
  });
});

describe("HypothesisLoopGuard", () => {
  it("blocks duplicate falsified hypotheses", () => {
    const guard = new HypothesisLoopGuard();
    guard.load([
      {
        hypothesisId: "h-css-1",
        statement: "orders panel z-index is wrong",
        subsystem: "styles/orders.css",
        prediction: "raise z-index",
        experiment: "toggle z-index",
        result: "falsified",
      },
    ]);
    expect(() =>
      guard.propose({
        hypothesisId: "h-css-2",
        statement: "orders panel z index is wrong",
        subsystem: "styles/orders.css",
        prediction: "raise z-index again",
        experiment: "toggle z-index",
      }),
    ).toThrow(DuplicateFalsifiedHypothesisError);
  });

  it("triggers tunnel vision pivot after 3 narrow falsified guesses", () => {
    const guard = new HypothesisLoopGuard();
    guard.load([
      {
        hypothesisId: "h1",
        statement: "styles/orders.css z-index too low",
        subsystem: "styles/orders.css",
        prediction: "p1",
        experiment: "e1",
        result: "falsified",
      },
      {
        hypothesisId: "h2",
        statement: "styles/orders.css stacking context bug",
        subsystem: "styles/orders.css",
        prediction: "p2",
        experiment: "e2",
        result: "falsified",
      },
      {
        hypothesisId: "h3",
        statement: "styles/orders.css opacity layer hides cutoff",
        subsystem: "styles/orders.css",
        prediction: "p3",
        experiment: "e3",
        result: "falsified",
      },
    ]);

    const decision = guard.propose({
      hypothesisId: "h4",
      statement: "styles/orders.css transform creates containing block",
      subsystem: "styles/orders.css",
      prediction: "p4",
      experiment: "e4",
    });
    expect(decision.ok).toBe(false);
    if (!decision.ok) {
      expect(decision.reason).toBe("tunnel_vision_trigger");
    }
  });
});

describe("CrossBrowserDiffRunner", () => {
  it("captures chromium vs webkit divergence and missing webkit hint", async () => {
    const snapshots: Record<string, BrowserRunSnapshot> = {
      chromium: {
        engine: "chromium",
        passed: true,
        consoleErrors: [],
        networkStatuses: [200],
        computedStyles: { color: "rgb(0, 0, 0)" },
        boundingBoxes: { root: { x: 0, y: 0, w: 10, h: 10 } },
      },
      webkit: {
        engine: "webkit",
        passed: false,
        consoleErrors: ["Invalid Date"],
        networkStatuses: [200],
        computedStyles: { color: "rgb(255, 0, 0)" },
        boundingBoxes: { root: { x: 0, y: 0, w: 10, h: 10 } },
        errorMessage: "Invalid Date",
      },
    };

    const diff = await new CrossBrowserDiffRunner().run({
      scriptRef: "repro/date-parse.spec.ts",
      browsers: ["chromium", "webkit"],
      runner: {
        isEngineInstalled: (engine) => engine === "chromium" || engine === "webkit",
        runPlaywrightRepro: async (engine) => snapshots[engine] ?? snapshots.chromium,
      },
    });

    expect(diff.chromium?.passed).toBe(true);
    expect(diff.webkit?.passed).toBe(false);
    expect(diff.divergences.length).toBeGreaterThan(0);
    expect(diff.webkitMissing).toBe(false);

    const missing = await new CrossBrowserDiffRunner().run({
      scriptRef: "repro/date-parse.spec.ts",
      browsers: ["chromium", "webkit"],
      runner: {
        isEngineInstalled: (engine) => engine === "chromium",
        runPlaywrightRepro: async (engine) => snapshots[engine] ?? snapshots.chromium,
      },
    });
    expect(missing.webkitMissing).toBe(true);
    expect(missing.toolCardHint).toMatch(/WebKit/i);
  });
});

describe("failure fingerprint normalizer", () => {
  it("strips volatile tokens deterministically", () => {
    const a = normalizeFailureFingerprint(
      "Error at C:\\Users\\agent\\AppData\\Local\\Temp\\repro abc 2026-11-19T10:30:00Z",
    );
    const b = normalizeFailureFingerprint(
      "Error at C:\\Users\\agent\\AppData\\Local\\Temp\\repro abc 2026-11-20T11:31:11Z",
    );
    expect(a).toBe(b);
  });
});