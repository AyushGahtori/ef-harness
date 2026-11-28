import type { ProjectStateDb } from "@ef-harness/db";

import { nodeCommandRunner } from "./command-runner.js";
import { HumanStepError } from "./errors.js";
import { nodeDnsResolver, nodeHttpProbe } from "./external-probe.js";
import { ChildProcessJobSupervisor } from "./job-supervisor.js";
import { ConsentedTerminalInstaller } from "./installer.js";
import {
  SqliteKnowledgeGraphPort,
  SqliteQuestionArbiter,
  openHumanStepDatabase,
} from "./local-ports.js";
import { AttestedVsVerifiedBadgePolicy } from "./policy.js";
import type {
  CommandRunner,
  DnsResolver,
  HttpProbe,
  KnowledgeGraphPort,
  ProbeLogger,
  SharedQuestionArbiter,
  WindowsDpapiSecretsVault,
  WindowsJobSupervisor,
} from "./ports.js";
import { silentProbeLogger } from "./ports.js";
import type { ChromiumLaunch } from "./playwright-probe.js";
import { HumanStepProbeRegistry } from "./registry.js";
import { HumanStepReentryHook } from "./reentry.js";
import { positionalDb } from "./sql-port.js";
import { HumanStepStateStore } from "./store.js";
import type {
  AttestationDecision,
  CreateHumanStepInput,
  HumanStepRecord,
  ProbeResult,
} from "./types.js";

export interface OpenHumanStepsOptions {
  readonly database?: ProjectStateDb;
  readonly now?: () => number;
  readonly timeoutMs?: number;
  readonly graph?: KnowledgeGraphPort;
  readonly questions?: SharedQuestionArbiter;
  readonly vault?: WindowsDpapiSecretsVault;
  readonly runner?: CommandRunner;
  readonly supervisor?: WindowsJobSupervisor;
  readonly logger?: ProbeLogger;
  readonly dns?: DnsResolver;
  readonly http?: HttpProbe;
  readonly launchChromium?: ChromiumLaunch;
  readonly buildId?: string;
}

export interface AttestOutcome {
  readonly allowed: boolean;
  readonly decision: AttestationDecision;
  readonly step: HumanStepRecord;
}

export class HumanStepRuntime {
  readonly store: HumanStepStateStore;
  readonly registry: HumanStepProbeRegistry;
  readonly policy: AttestedVsVerifiedBadgePolicy;
  readonly installer: ConsentedTerminalInstaller;
  readonly reentry: HumanStepReentryHook;
  readonly graph: KnowledgeGraphPort;
  readonly questions: SharedQuestionArbiter;
  private readonly ownsDatabase: boolean;
  private readonly database: ProjectStateDb;
  private readonly buildId: string;

  constructor(options: OpenHumanStepsOptions = {}) {
    const now = options.now ?? (() => Date.now());
    this.database = options.database ?? openHumanStepDatabase();
    this.ownsDatabase = options.database === undefined;
    const sql = positionalDb(this.database.writer);
    this.store = new HumanStepStateStore(this.database, now);
    this.graph = options.graph ?? new SqliteKnowledgeGraphPort(sql);
    this.questions = options.questions ?? new SqliteQuestionArbiter(sql, now);
    this.policy = new AttestedVsVerifiedBadgePolicy();
    this.buildId = options.buildId ?? "build-local";
    this.registry = new HumanStepProbeRegistry({
      store: this.store,
      runner: options.runner ?? nodeCommandRunner(),
      vault: options.vault ?? emptyVault,
      graph: this.graph,
      questions: this.questions,
      logger: options.logger ?? silentProbeLogger,
      now,
      timeoutMs: options.timeoutMs ?? 10_000,
      dns: options.dns ?? nodeDnsResolver(),
      http: options.http ?? nodeHttpProbe(),
      ...(options.launchChromium === undefined ? {} : { launchChromium: options.launchChromium }),
    });
    this.installer = new ConsentedTerminalInstaller(options.supervisor ?? new ChildProcessJobSupervisor(), this.registry);
    this.reentry = new HumanStepReentryHook(this.store, this.registry);
  }

  createStep(input: CreateHumanStepInput): HumanStepRecord {
    return this.store.create(input, (step) => {
      const graphNodeId = this.graph.allocateEntityId("S-");
      this.graph.commitChangeSet({
        origin: "kernel",
        author: "human-steps",
        summary: step.title,
        nodes: [
          {
            op: "create",
            id: graphNodeId,
            kind: "comment",
            title: step.title,
            text: step.plainEnglishInstructions.join("\n"),
            status: "active",
            fields: {
              humanStep: true,
              stepId: step.stepId,
              stepType: step.stepType,
              hardLocal: step.hardLocal,
            },
          },
        ],
      });
      this.store.setQuestionId(step.stepId, this.submitQuestion(step));
      this.store.setGraphNode(step.stepId, graphNodeId);
    });
  }

  checkAgain(stepId: string): Promise<ProbeResult> {
    return this.registry.checkAgain(stepId);
  }

  attest(stepId: string, note: string): AttestOutcome {
    const current = this.store.require(stepId);
    const decision = this.policy.decideAttestation(current);
    if (!decision.allowed) return { allowed: false, decision, step: current };
    const step = this.store.commitAttestation(stepId, note, () => {
      const fresh = this.store.require(stepId);
      if (fresh.graphNodeId) {
        const node = this.graph.getNode(fresh.graphNodeId);
        if (node) {
          this.graph.recordEvidence({
            node: node.id,
            nodeVersion: node.version,
            sourceKind: "repo",
            sourceRef: `human-step:${stepId}`,
            locator: { stepId },
            quote: note.trim(),
            verified: false,
          });
        }
      }
      if (fresh.questionId) this.questions.retireQuestion(fresh.questionId, "attestation", note.trim());
    });
    return { allowed: true, decision: this.policy.decideAttestation(step), step };
  }

  skipFeature(stepId: string): HumanStepRecord {
    return this.store.commitFeatureSkip(stepId);
  }

  close(): void {
    if (this.ownsDatabase) this.database.close();
  }

  private submitQuestion(step: HumanStepRecord): string {
    const waitingTaskId = step.blockingTaskIds[0];
    if (!waitingTaskId) {
      throw new HumanStepError("blocking_tasks", "A human step needs a blocking task");
    }
    return this.questions.submit({
      buildId: this.buildId,
      workerId: "kernel",
      waitingTaskId,
      waitingRole: "owner",
      text: `${step.title}\n${step.plainEnglishInstructions.join("\n")}`,
      kind: "human_step",
    }).questionId;
  }
}

export function openHumanSteps(options: OpenHumanStepsOptions = {}): HumanStepRuntime {
  return new HumanStepRuntime(options);
}

const emptyVault: WindowsDpapiSecretsVault = {
  readSecret(): null {
    return null;
  },
};
