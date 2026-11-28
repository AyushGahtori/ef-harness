import type { GlobalBrokerDb, ProjectStateDb } from "@ef-harness/db";
import { GitSafetyScanner, execGit } from "@ef-harness/git-engine";
import { LandingSummaryGenerator, type LandingSummaryInput } from "@ef-harness/integrator";
import { SqliteShipRunStore } from "./ci-loop/sqlite-ship-run-store.js";
import type { ExternalEffectLedger as CiEffectLedger, SafetyScanner } from "./ci-loop/contracts.js";
import { ExternalEffectLedger } from "./effects/ledger.js";
import { SqliteEffectStore } from "./effects/store.js";
import { githubRateStoreForBroker } from "./github/rate-state.js";
import { GitHubRateAwareQueue, type GitHubTransport } from "./github/rate-queue.js";
import { registerGitHubEffectReconcilers } from "./github/reconcilers.js";
import type { MinGitRepoInspectorPort } from "./github/types.js";

export function createMinGitRepoInspector(): MinGitRepoInspectorPort {
  return {
    async lsRemote(repoPath, ref) {
      const result = await execGit({
        cwd: repoPath,
        args: ["rev-parse", "--verify", ref],
        developerCheckout: false,
      });
      if (result.exitCode !== 0) return null;
      const sha = result.stdout.trim();
      return sha.length > 0 ? sha : null;
    },
    async diffNameOnly(repoPath, range) {
      const result = await execGit({
        cwd: repoPath,
        args: ["diff", "--name-only", range],
        developerCheckout: false,
      });
      if (result.exitCode !== 0) return [];
      return result.stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
    },
  };
}

export function createGitSafetyScannerPort(root: string): SafetyScanner {
  const scanner = new GitSafetyScanner({ root });
  return {
    async scanCommitRange(baseRef, headRef) {
      const report = await scanner.scanCommitDiffForSecrets(baseRef, headRef);
      return report.findings.map((finding) => ({
        ruleId: finding.ruleId,
        file: finding.file,
        line: finding.line,
      }));
    },
  };
}

export function landingParagraph(input: LandingSummaryInput, featureId: string): string {
  const summary = new LandingSummaryGenerator().generate(input);
  const feature = summary.whatWasBuilt.features.find((item) => item.id === featureId);
  const routes = feature ? feature.routes.join(", ") : "";
  return `${summary.title}. ${summary.verdict}. ${featureId}. ${routes}`.trim();
}

/** CI repair records git pushes on the external effect ledger. */
export function adaptLedgerForCi(ledger: ExternalEffectLedger): CiEffectLedger {
  return {
    recordGitPush(effectId, meta) {
      const fence = ledger.store.readRuntimeFence();
      ledger.recordPlanned({
        effectType: "git_push",
        targetEnv: "git_remote",
        payload: meta,
        idempotencyKey: effectId,
        writerEpoch: fence.writerEpoch,
      });
    },
  };
}

export interface ShipDeployBindings {
  readonly ledger: ExternalEffectLedger;
  readonly ciLedger: CiEffectLedger;
  readonly queue: GitHubRateAwareQueue;
  readonly shipRuns: SqliteShipRunStore;
  readonly scanner: SafetyScanner;
  readonly minGit: MinGitRepoInspectorPort;
}

export function bindShipDeploy(input: {
  readonly state: ProjectStateDb;
  readonly globalDb: GlobalBrokerDb;
  readonly accountKey: string;
  readonly transport: GitHubTransport;
  readonly owner: string;
  readonly repo: string;
  readonly repoRoot: string;
}): ShipDeployBindings {
  const ledger = new ExternalEffectLedger({
    store: new SqliteEffectStore({ connection: input.state.writer }),
  });
  const queue = new GitHubRateAwareQueue({
    accountKey: input.accountKey,
    transport: input.transport,
    rateStore: githubRateStoreForBroker(input.globalDb),
  });
  const minGit = createMinGitRepoInspector();
  registerGitHubEffectReconcilers({
    registrar: {
      register(effectType, fn) {
        ledger.reconciler.register(effectType, (probe) =>
          fn({
            effectType: probe.effectType,
            idempotencyKey: probe.idempotencyKey,
            payload: probe.payload,
          }),
        );
      },
    },
    queue,
    minGit,
    owner: input.owner,
    repo: input.repo,
  });
  return {
    ledger,
    ciLedger: adaptLedgerForCi(ledger),
    queue,
    shipRuns: new SqliteShipRunStore(input.state.writer),
    scanner: createGitSafetyScannerPort(input.repoRoot),
    minGit,
  };
}
