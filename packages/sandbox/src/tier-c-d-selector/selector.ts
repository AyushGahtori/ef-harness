import { buildDiagnosticMatrix } from "./diagnostics.js";
import type { SettingsDiagnosticMatrix } from "./diagnostics.js";
import { TaskHeldError, TierCHonestyError, WrappedModeForbiddenOnTierCError } from "./errors.js";
import { isTaskEligibleForTierC } from "./eligibility.js";
import { classifyPathSyntax } from "./paths.js";
import { TIER_C_CAPABILITIES } from "./tier-c-provider.js";
import type {
  CommandSpec,
  ExecutionMode,
  PathClass,
  ProjectSandboxSettings,
  ReceiptTier,
  RuntimeDispatch,
  SandboxInstance,
  SandboxLaunchSpec,
  SandboxTierId,
  SandboxTierProvider,
  TaskCardStamp,
  TaskHold,
  TaskSandboxSpec,
  TierCEligibility,
  TierProbeResult,
  VerificationReceipt,
  WeakerSandboxBadge,
} from "./types.js";
import { TIER_PREFERENCE } from "./types.js";

export const TIER_INSUFFICIENT_OFFERS = [
  { id: "setup_tier_b", label: "Set up Tier B (one-time admin)" },
  { id: "install_docker_tier_d", label: "Install Docker (Tier D)" },
  { id: "unsandboxed_red_warning_override", label: "Run unsandboxed for this project (red warning)" },
] as const;

export interface SelectorProviders {
  readonly tierA?: SandboxTierProvider;
  readonly tierB?: SandboxTierProvider;
  readonly tierC?: SandboxTierProvider;
  readonly tierD?: SandboxTierProvider;
}

export interface SelectorDependencies {
  readonly providers: SelectorProviders;
  readonly settings?: ProjectSandboxSettings;
  readonly pathClassifier?: (target: string) => Promise<PathClass> | PathClass;
  readonly now?: () => string;
  readonly unsandboxedRunner?: (task: TaskSandboxSpec, command: CommandSpec) => Promise<void>;
}

export interface RunDecision {
  readonly kind: "run";
  readonly tier: ReceiptTier;
  readonly mode: ExecutionMode;
  readonly redBannerWarning: boolean;
  readonly badge?: WeakerSandboxBadge;
  readonly executed: false;
  readonly explanation: string;
  readonly provider?: SandboxTierProvider;
}

export interface HoldDecision {
  readonly kind: "hold";
  readonly executed: false;
  readonly hold: TaskHold;
}

export type ResolveDecision = RunDecision | HoldDecision;

export interface ExecutionOutcome {
  readonly decision: RunDecision;
  readonly receipt: VerificationReceipt;
  readonly taskCard: TaskCardStamp;
}

interface ResolveInput {
  readonly task: TaskSandboxSpec;
  readonly runtime: RuntimeDispatch;
  readonly command: CommandSpec;
}

function assertTierCHonesty(provider: SandboxTierProvider): void {
  const caps = provider.capabilities;
  if (
    provider.tier !== "C" ||
    caps.fileWritesEnforced !== true ||
    caps.secretReadsDenied !== false ||
    caps.networkEnforced !== false ||
    caps.badge !== TIER_C_CAPABILITIES.badge
  ) {
    throw new TierCHonestyError(
      "Tier C must advertise fileWritesEnforced, must not advertise secret-read or network enforcement, and must carry the yellow weaker-sandbox badge.",
    );
  }
}

function modeFor(tier: SandboxTierId, runtime: RuntimeDispatch): ExecutionMode {
  if (runtime.kind === "own_loop") return "own_loop";
  if (tier === "C") return "stripped";
  return runtime.requestedMode === "stripped" ? "stripped" : "wrapped";
}

export class SandboxTierSelector {
  readonly settings: ProjectSandboxSettings;
  private readonly providers: SelectorProviders;
  private readonly pathClassifier: SelectorDependencies["pathClassifier"];
  private readonly now: () => string;
  private readonly unsandboxedRunner: SelectorDependencies["unsandboxedRunner"];
  private readonly probes = new Map<SandboxTierId, TierProbeResult>();
  private probed = false;
  private readonly receiptLog: VerificationReceipt[] = [];
  private readonly cardLog: TaskCardStamp[] = [];

  constructor(deps: SelectorDependencies) {
    this.providers = deps.providers;
    this.settings = deps.settings ?? { runUnsandboxed: false, pinTierDForLinuxParity: false };
    this.pathClassifier = deps.pathClassifier;
    this.now = deps.now ?? (() => new Date().toISOString());
    this.unsandboxedRunner = deps.unsandboxedRunner;
    if (deps.providers.tierC) assertTierCHonesty(deps.providers.tierC);
  }

  get receipts(): readonly VerificationReceipt[] {
    return this.receiptLog;
  }

  get taskCards(): readonly TaskCardStamp[] {
    return this.cardLog;
  }

  setRunUnsandboxed(enabled: boolean): void {
    this.settings.runUnsandboxed = enabled;
  }

  async ensureProbed(): Promise<void> {
    if (this.probed) return;
    const entries: Array<readonly [SandboxTierId, SandboxTierProvider | undefined]> = [
      ["A", this.providers.tierA],
      ["B", this.providers.tierB],
      ["D", this.providers.tierD],
      ["C", this.providers.tierC],
    ];
    await Promise.all(
      entries.map(async ([tier, provider]) => {
        if (!provider) return;
        if (provider.tier === "C") assertTierCHonesty(provider);
        this.probes.set(tier, await provider.probe());
      }),
    );
    const docker = this.probes.get("D");
    if (docker?.available && this.providers.tierD && "reconcileManagedContainers" in this.providers.tierD) {
      const reconciler = this.providers.tierD as SandboxTierProvider & {
        reconcileManagedContainers?: () => Promise<unknown>;
      };
      if (reconciler.reconcileManagedContainers) await reconciler.reconcileManagedContainers();
    }
    this.probed = true;
  }

  activeTier(): SandboxTierId | "none" {
    if (this.settings.pinTierDForLinuxParity) {
      return this.probes.get("D")?.available ? "D" : "none";
    }
    for (const tier of TIER_PREFERENCE) {
      if (this.probes.get(tier)?.available) return tier;
    }
    return "none";
  }

  async diagnosticMatrix(): Promise<SettingsDiagnosticMatrix> {
    await this.ensureProbed();
    return buildDiagnosticMatrix({ probes: this.probes, activeTier: this.activeTier() });
  }

  async resolve(input: ResolveInput): Promise<ResolveDecision> {
    await this.ensureProbed();
    if (this.settings.runUnsandboxed) {
      return {
        kind: "run",
        tier: "UNSANDBOXED",
        mode: input.runtime.kind === "foreign_agent" && input.runtime.requestedMode === "stripped" ? "stripped" : input.runtime.kind === "own_loop" ? "own_loop" : input.runtime.requestedMode === "wrapped" ? "wrapped" : "own_loop",
        redBannerWarning: true,
        executed: false,
        explanation:
          "The developer explicitly enabled run unsandboxed for this project. Every task card and verification receipt keeps the red warning and the UNSANDBOXED stamp.",
      };
    }
    const eligibility = isTaskEligibleForTierC(input.task, input.runtime);
    const pathClass = await this.classify(input.task.projectPath);
    const networkPath = pathClass !== "local";
    this.assertWrappedAllowed(input.runtime, eligibility, networkPath);
    const order = this.settings.pinTierDForLinuxParity ? (["D"] as const) : TIER_PREFERENCE;
    for (const tier of order) {
      const provider = this.provider(tier);
      const probe = this.probes.get(tier);
      if (!provider || !probe?.available) continue;
      if (!this.tierUsable(provider, networkPath, eligibility)) continue;
      const mode = modeFor(tier, input.runtime);
      const decision: RunDecision = {
        kind: "run",
        tier,
        mode,
        redBannerWarning: false,
        executed: false,
        provider,
        explanation: `Selected Tier ${tier} in mode ${mode}.`,
      };
      if (tier === "C") return { ...decision, badge: "weaker_sandbox_yellow" };
      return decision;
    }
    return { kind: "hold", executed: false, hold: this.hold(input, eligibility, networkPath) };
  }

  async execute(input: ResolveInput): Promise<ExecutionOutcome> {
    const decision = await this.resolve(input);
    if (decision.kind === "hold") throw new TaskHeldError(decision.hold);
    if (decision.tier === "UNSANDBOXED") {
      if (!this.settings.runUnsandboxed) {
        throw new Error("Refusing unsandboxed execution without the explicit red-warning opt-in.");
      }
      if (this.unsandboxedRunner) await this.unsandboxedRunner(input.task, input.command);
    } else if (decision.provider) {
      const launch = this.launchSpec(input, decision.mode);
      const instance = await decision.provider.acquireWarmInstance(launch);
      if (decision.mode === "wrapped") await decision.provider.spawnWrappedProcess(launch);
      else await decision.provider.executeCommand(instance, input.command);
    }
    const receipt = this.recordReceipt(input, decision);
    const taskCard = this.recordCard(input, decision);
    return { decision, receipt, taskCard };
  }

  private assertWrappedAllowed(
    runtime: RuntimeDispatch,
    eligibility: TierCEligibility,
    networkPath: boolean,
  ): void {
    if (runtime.kind !== "foreign_agent" || runtime.requestedMode !== "wrapped") return;
    const stronger = TIER_PREFERENCE.some((tier) => {
      if (tier === "C") return false;
      const provider = this.provider(tier);
      const probe = this.probes.get(tier);
      return Boolean(provider && probe?.available && this.tierUsable(provider, networkPath, eligibility));
    });
    const tierC = this.probes.get("C");
    if (!stronger && tierC?.available) throw new WrappedModeForbiddenOnTierCError(runtime.runtimeId);
  }

  private tierUsable(provider: SandboxTierProvider, networkPath: boolean, eligibility: TierCEligibility): boolean {
    if (provider.tier === "C") {
      assertTierCHonesty(provider);
      if (networkPath || !eligibility.eligible) return false;
      return true;
    }
    if (networkPath && provider.tier === "B") return false;
    if (!eligibility.eligible && !provider.capabilities.networkEnforced) return false;
    return provider.capabilities.fileWritesEnforced;
  }

  private hold(input: ResolveInput, eligibility: TierCEligibility, networkPath: boolean): TaskHold {
    const parts: string[] = [];
    if (this.settings.pinTierDForLinuxParity && !this.probes.get("D")?.available) {
      parts.push("Tier D is pinned for Linux parity, but no enforcing Docker daemon is available.");
    }
    if (networkPath) {
      parts.push(
        "Tier C is rejected on this UNC or network path because write ACLs are unsupported. Tier A or Tier D is required, or the project has to move to a local disk.",
      );
    }
    if (!eligibility.eligible) {
      parts.push(eligibility.explanation);
      parts.push("Nothing will run pnpm install, an untrusted dev server, or an untrusted package under Tier C.");
    }
    if (input.runtime.kind === "foreign_agent") {
      parts.push(
        "The foreign agent was not started in wrapped mode. Non-qualifying work is routed to the native worker loop, which is also held, with this explanation.",
      );
    }
    parts.push("The task is held. SandboxTierSelector did not execute it unsandboxed.");
    return {
      held: true,
      executed: false,
      reason: "sandbox_tier_insufficient",
      explanation: parts.join(" "),
      offers: TIER_INSUFFICIENT_OFFERS,
      alternative: input.runtime.kind === "foreign_agent" ? "native_worker_loop_held" : "held",
    };
  }

  private async classify(target: string): Promise<PathClass> {
    if (classifyPathSyntax(target) === "unc") return "unc";
    if (this.pathClassifier) return this.pathClassifier(target);
    return "local";
  }

  private provider(tier: SandboxTierId): SandboxTierProvider | undefined {
    if (tier === "A") return this.providers.tierA;
    if (tier === "B") return this.providers.tierB;
    if (tier === "D") return this.providers.tierD;
    return this.providers.tierC;
  }

  private launchSpec(input: ResolveInput, mode: ExecutionMode): SandboxLaunchSpec {
    return {
      projectId: input.task.projectId,
      attemptId: input.task.attemptId,
      taskId: input.task.taskId,
      worktreePath: input.task.worktreePath,
      tempPath: input.task.tempPath,
      projectPath: input.task.projectPath,
      mode,
      ...(input.task.packageStorePath ? { packageStorePath: input.task.packageStorePath } : {}),
    };
  }

  private recordReceipt(input: ResolveInput, decision: RunDecision): VerificationReceipt {
    const receipt: VerificationReceipt = {
      taskId: input.task.taskId,
      attemptId: input.task.attemptId,
      commandId: input.command.commandId,
      tier: decision.tier,
      mode: decision.mode,
      sandboxTier: decision.tier,
      redBannerWarning: decision.tier === "UNSANDBOXED" || decision.redBannerWarning,
      recordedAt: this.now(),
      ...(decision.badge ? { badge: decision.badge } : {}),
    };
    const frozen = Object.freeze(receipt);
    this.receiptLog.push(frozen);
    return frozen;
  }

  private recordCard(input: ResolveInput, decision: RunDecision): TaskCardStamp {
    const unsandboxed = this.settings.runUnsandboxed || decision.tier === "UNSANDBOXED";
    const card: TaskCardStamp = {
      taskId: input.task.taskId,
      sandboxTier: unsandboxed ? "UNSANDBOXED" : decision.tier,
      redBannerWarning: unsandboxed,
      mode: decision.mode,
      held: false,
      ...(decision.badge && !unsandboxed ? { badge: decision.badge } : {}),
    };
    const frozen = Object.freeze(card);
    this.cardLog.push(frozen);
    return frozen;
  }
}

export function placeholderInstance(id: string, tier: SandboxTierId): SandboxInstance {
  return { id, tier };
}
