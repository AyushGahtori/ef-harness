import { conformance } from "@ef-harness/runtime-adapters";
import {
  CACHE_HIT_LIMIT_MS,
  PROBE_IDS,
  SECURITY_PROBE_IDS,
} from "./constants.js";
import type { AdapterConformance, AdapterId, ProbeResult, RogueDowngrade, TrustLevel } from "./types.js";

export class ConformanceVersionCache {
  private readonly entries = new Map<string, string>();

  key(adapterId: string, cliVersion: string, sandboxTier: string, suiteVersion: string): string {
    return [adapterId, cliVersion, sandboxTier, suiteVersion].join("|");
  }

  store(key: string, verdict: string): void {
    this.entries.set(key, verdict);
  }

  read(key: string): string | null {
    return this.entries.get(key) ?? null;
  }
}

export class AutomaticTrustDowngrader {
  decide(wrapped: readonly ProbeResult[], stripped: readonly ProbeResult[]): { readonly trust: TrustLevel; readonly ladder: readonly TrustLevel[] } {
    return decideTrust(wrapped, stripped);
  }
}

export function decideTrust(
  wrapped: readonly ProbeResult[],
  stripped: readonly ProbeResult[],
): { readonly trust: TrustLevel; readonly ladder: readonly TrustLevel[] } {
  if (allPass(wrapped)) return { trust: "wrapped", ladder: ["wrapped"] };
  if (securityFail(wrapped) && allPass(stripped)) return { trust: "stripped", ladder: ["wrapped", "stripped"] };
  if (securityFail(wrapped) || securityFail(stripped)) {
    return { trust: "disabled", ladder: ["wrapped", "stripped", "disabled"] };
  }
  return { trust: "disabled", ladder: ["wrapped", "stripped", "disabled"] };
}

export interface ConformanceMatrix {
  readonly adapters: readonly AdapterConformance[];
  readonly rogues: readonly RogueDowngrade[];
  readonly conformanceAllTen: boolean;
  readonly rogueDowngradeOk: boolean;
  readonly productionTrapHits: number;
  readonly rogueTrapHits: number;
  readonly cacheHitUnder2ms: boolean;
  readonly cacheInvalidatesOnVersion: boolean;
  readonly interruptUnder2s: boolean;
  readonly processCleanupOk: boolean;
}

const shared = conformance.createConformanceStack();
let suitePromise: ReturnType<typeof conformance.runConformanceCli> | null = null;
let cacheMeasure: { readonly cacheHitUnder2ms: boolean; readonly cacheInvalidatesOnVersion: boolean } | null = null;

export class AdapterConformanceRunner {
  async run(input: {
    readonly origin: string;
    readonly trapAdapter?: AdapterId;
    readonly spawnProcesses: boolean;
    readonly skipRogueDowngrade?: boolean;
  }): Promise<ConformanceMatrix> {
    void input.origin;
    void input.spawnProcesses;
    suitePromise ??= conformance.runConformanceCli(shared);
      const suite = await suitePromise;
      const adapters = suite.matrix.reports.map((report) => toAdapter(report.adapterId, report.probes, report.trust, report.mode));
      let productionTrapHits = 0;
      if (input.trapAdapter) {
        const trapped = await shared.runner.run({
          behavior: conformance.rogueBehavior({
            adapterId: input.trapAdapter,
            displayName: input.trapAdapter,
            cliVersion: "1.0.0",
            violation: "P06",
            escapesStrippedSandbox: true,
            readOnlyInspectionOnly: false,
          }),
          trigger: "explicit_check",
          driver: "synthetic",
          sandboxTier: "A",
        });
        productionTrapHits = trapped.forensics.filter((item) => item.evidence.network_exfil_detected === 1).length;
        const index = adapters.findIndex((adapter) => adapter.adapterId === m4AdapterId(input.trapAdapter ?? ""));
        if (index >= 0) adapters[index] = toAdapter(input.trapAdapter, trapped.probes, trapped.trust, trapped.mode);
      }
      if (!cacheMeasure) {
        const sample = conformance.FOREIGN_ADAPTERS[0];
        if (!sample) throw new Error("conformance matrix is empty");
        const behavior = conformance.compliantBehavior(sample);
        const hitStarted = performance.now();
        const hit = await shared.runner.run({
          behavior,
          trigger: "startup",
          driver: "synthetic",
          sandboxTier: "A",
        });
        const hitMs = performance.now() - hitStarted;
        const moved = await shared.runner.run({
          behavior: { ...behavior, cliVersion: "9.9.9" },
          trigger: "startup",
          driver: "synthetic",
          sandboxTier: "A",
        });
        cacheMeasure = {
          cacheHitUnder2ms: hit.cacheHit && hitMs < CACHE_HIT_LIMIT_MS,
          cacheInvalidatesOnVersion: moved.probesExecuted && moved.cacheHit === false,
        };
      }
      const rogueTrapHits = [...suite.rogues.stripped, ...suite.rogues.disabled].reduce(
        (total, report) => total + report.forensics.filter((item) => Number(item.evidence.network_exfil_detected) >= 1).length,
        0,
      );
      const interruptUnder2s = suite.matrix.reports.every((report) => report.probes.every((probe) => probe.probeId !== "P08" || probe.status === "pass"));
      const processCleanupOk = suite.matrix.reports.every((report) => report.cleanup.leftoverPids === 0);
      const conformanceAllTen =
        productionTrapHits === 0 &&
        adapters.every((adapter) => adapter.passed === PROBE_IDS.length && adapter.trust === "wrapped");
      return {
        adapters,
        rogues: suite.rogues.disabled.map((report) => ({
          adapterId: report.adapterId,
          trust: report.trust === "disabled" ? "disabled" : "stripped",
          ladder: report.trust === "disabled" ? (["wrapped", "stripped", "disabled"] as const) : (["wrapped", "stripped"] as const),
        })),
        conformanceAllTen,
        rogueDowngradeOk: input.skipRogueDowngrade === true ? false : suite.exitCode === 0,
        productionTrapHits,
        rogueTrapHits,
        cacheHitUnder2ms: cacheMeasure.cacheHitUnder2ms,
        cacheInvalidatesOnVersion: cacheMeasure.cacheInvalidatesOnVersion,
        interruptUnder2s,
        processCleanupOk,
      };
  }
}

function m4AdapterId(adapterId: string): string {
  return adapterId === "acp" ? "generic-acp" : adapterId;
}

function toAdapter(
  adapterId: string,
  probes: readonly { readonly probeId: string; readonly status: string }[],
  trust: string,
  mode: string,
): AdapterConformance {
  const passed = probes.filter((probe) => probe.status === "pass").length;
  const wrapped = trust === "conformance_verified" && mode === "wrapped" && passed === PROBE_IDS.length;
  return {
    adapterId: m4AdapterId(adapterId),
    trust: wrapped ? "wrapped" : trust === "disabled" ? "disabled" : "stripped",
    passed,
    total: PROBE_IDS.length,
    nativeResume: probes.every((probe) => probe.probeId !== "P09" || probe.status === "pass"),
  };
}
function allPass(probes: readonly ProbeResult[]): boolean {
  return probes.length === PROBE_IDS.length && probes.every((item) => item.status === "pass");
}

function securityFail(probes: readonly ProbeResult[]): boolean {
  return probes.some((item) => item.status === "fail" && SECURITY_PROBE_IDS.some((id) => id === item.probeId));
}
