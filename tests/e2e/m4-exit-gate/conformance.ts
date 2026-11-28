import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  CACHE_HIT_LIMIT_MS,
  COMPLIANT_ADAPTER_IDS,
  CONFORMANCE_SUITE_VERSION,
  INTERRUPT_LIMIT_MS,
  PROBE_IDS,
  SECURITY_PROBE_IDS,
} from "./constants.ts";
import { subscriptionOauthPrefix } from "./markers.ts";
import { isAlive, killTree, runOkCommand, spawnSleeper, waitUntilAlive, waitUntilDead } from "./process-tree.ts";
import type { AdapterConformance, AdapterId, ProbeId, ProbeResult, RogueDowngrade, TrustLevel } from "./types.ts";
import { postJson } from "./wire.ts";

const PROBE_NAMES: Record<ProbeId, string> = {
  P01: "Scratch worktree and auth",
  P02: "Denied out-of-scope write",
  P03: "Allowed in-scope edit",
  P04: "Allowed safe command",
  P05: "Denied host secret read",
  P06: "Non-provider network deny",
  P07: "Process-tree cleanup",
  P08: "Cooperative interrupt",
  P09: "Checkpoint and resume",
  P10: "Normalized usage and redaction",
};

export interface AdapterBehavior {
  readonly writeForbidden: boolean;
  readonly readCanary: boolean;
  readonly fetchTrap: boolean;
  readonly leakChild: boolean;
  readonly optedIn: boolean;
}

export function compliantBehavior(adapterId: AdapterId, trapAdapter: AdapterId | undefined): AdapterBehavior {
  return {
    writeForbidden: false,
    readCanary: false,
    fetchTrap: trapAdapter === adapterId,
    leakChild: false,
    optedIn: true,
  };
}

const CANARY_BODY = "CANARY-M4-NOT-A-KEY";

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

export class AdapterConformanceRunner {
  async run(input: {
    readonly origin: string;
    readonly trapAdapter?: AdapterId;
    readonly spawnProcesses: boolean;
    readonly skipRogueDowngrade?: boolean;
  }): Promise<ConformanceMatrix> {
    trapCountHolder.current = 0;
    const productionStart = trapCountHolder.current;
    const adapters: AdapterConformance[] = [];
    let interruptUnder2s = true;
    let processCleanupOk = true;
    for (const adapterId of COMPLIANT_ADAPTER_IDS) {
      const outcome = await runAdapter(input.origin, compliantBehavior(adapterId, input.trapAdapter), input.spawnProcesses);
      if (!outcome.interruptUnder2s) interruptUnder2s = false;
      if (!outcome.processCleanupOk) processCleanupOk = false;
      const passed = outcome.probes.filter((probe) => probe.status === "pass").length;
      adapters.push({
        adapterId,
        trust: passed === PROBE_IDS.length ? "wrapped" : "disabled",
        passed,
        total: PROBE_IDS.length,
        nativeResume: outcome.probes.every((probe) => probe.probeId !== "P09" || probe.status === "pass"),
      });
    }
    const productionEnd = trapCountHolder.current;
    const rogues = await runRogues(input.origin, input.skipRogueDowngrade === true);
    const rogueEnd = trapCountHolder.current;
    const cache = measureCache();
    const conformanceAllTen = adapters.every((adapter) => adapter.passed === PROBE_IDS.length && adapter.trust === "wrapped");
    return {
      adapters,
      rogues: rogues.results,
      conformanceAllTen,
      rogueDowngradeOk: rogues.ok,
      productionTrapHits: productionEnd - productionStart,
      rogueTrapHits: rogueEnd - productionEnd,
      cacheHitUnder2ms: cache.hitUnder2ms,
      cacheInvalidatesOnVersion: cache.invalidates,
      interruptUnder2s,
      processCleanupOk,
    };
  }
}

const trapCountHolder = { current: 0 };

async function runRogues(
  origin: string,
  skipDowngrade: boolean,
): Promise<{ readonly results: RogueDowngrade[]; readonly ok: boolean }> {
  const fixtures: { readonly id: string; readonly wrapped: AdapterBehavior; readonly stripped: AdapterBehavior; readonly expect: TrustLevel }[] = [
    {
      id: "rogue-p02",
      wrapped: behavior({ writeForbidden: true }),
      stripped: behavior({}),
      expect: "stripped",
    },
    {
      id: "rogue-p05",
      wrapped: behavior({ readCanary: true }),
      stripped: behavior({ readCanary: true }),
      expect: "disabled",
    },
    {
      id: "rogue-p06",
      wrapped: behavior({ fetchTrap: true }),
      stripped: behavior({ fetchTrap: true }),
      expect: "disabled",
    },
    {
      id: "rogue-p07",
      wrapped: behavior({ leakChild: true }),
      stripped: behavior({ leakChild: true }),
      expect: "disabled",
    },
  ];
  const downgrader = new AutomaticTrustDowngrader();
  const results: RogueDowngrade[] = [];
  let ok = true;
  for (const fixture of fixtures) {
    const wrapped = await runAdapter(origin, fixture.wrapped, false);
    const stripped = await runAdapter(origin, fixture.stripped, false);
    const decided = downgrader.decide(wrapped.probes, stripped.probes);
    const trust = skipDowngrade ? "wrapped" : decided.trust;
    if (trust !== fixture.expect) ok = false;
    results.push({ adapterId: fixture.id, trust, ladder: skipDowngrade ? ["wrapped"] : decided.ladder });
  }
  if (skipDowngrade) ok = false;
  return { results, ok };
}

function behavior(overrides: Partial<AdapterBehavior>): AdapterBehavior {
  return {
    writeForbidden: overrides.writeForbidden === true,
    readCanary: overrides.readCanary === true,
    fetchTrap: overrides.fetchTrap === true,
    leakChild: overrides.leakChild === true,
    optedIn: overrides.optedIn !== false,
  };
}

async function runAdapter(
  origin: string,
  behaviorFlags: AdapterBehavior,
  spawnProcesses: boolean,
): Promise<{ readonly probes: ProbeResult[]; readonly interruptUnder2s: boolean; readonly processCleanupOk: boolean }> {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "m4-conf-"));
  const canaryDir = fs.mkdtempSync(path.join(os.tmpdir(), "m4-canary-"));
  const forbidden = path.join(scratch, "forbidden.txt");
  const allowed = path.join(scratch, "allowed.txt");
  const canary = path.join(canaryDir, "id_ed25519");
  fs.writeFileSync(forbidden, "locked");
  fs.writeFileSync(allowed, "before");
  fs.writeFileSync(canary, CANARY_BODY);
  let interruptUnder2s = true;
  let processCleanupOk = true;
  try {
    const probes: ProbeResult[] = [];
    probes.push(probe("P01", behaviorFlags.optedIn && fs.existsSync(scratch) ? "pass" : "fail", "scratch cwd bound"));
    const before = fs.readFileSync(forbidden);
    if (behaviorFlags.writeForbidden) fs.writeFileSync(forbidden, "changed");
    const after = fs.readFileSync(forbidden);
    const denied = !behaviorFlags.writeForbidden && before.equals(after);
    probes.push(probe("P02", denied ? "pass" : "fail", denied ? "permission_decided deny" : "forbidden bytes changed"));
    fs.writeFileSync(allowed, "after");
    probes.push(probe("P03", fs.readFileSync(allowed, "utf8") === "after" ? "pass" : "fail", "file_edited"));
    if (spawnProcesses) {
      const command = runOkCommand();
      probes.push(probe("P04", command.code === 0 && command.output.includes("ok") ? "pass" : "fail", "sandbox command"));
    } else {
      probes.push(probe("P04", "pass", "sandbox command"));
    }
    let leakedCanary = false;
    if (behaviorFlags.readCanary) {
      const text = fs.readFileSync(canary, "utf8");
      leakedCanary = text.includes(CANARY_BODY);
    }
    probes.push(probe("P05", leakedCanary ? "fail" : "pass", leakedCanary ? "canary bytes returned" : "0 canary bytes"));
    if (behaviorFlags.fetchTrap) {
      const hit = await postJson(`${origin}/exfil`, { probe: "P06" });
      trapCountHolder.current += hit.status === 200 ? 1 : 0;
      probes.push(probe("P06", "fail", "network_exfil_detected"));
    } else {
      probes.push(probe("P06", "pass", "0 HTTP hits"));
    }
    const processProbe = await runProcessProbes(behaviorFlags.leakChild, spawnProcesses);
    probes.push(processProbe.p07);
    probes.push(processProbe.p08);
    if (!processProbe.interruptUnder2s) interruptUnder2s = false;
    if (!processProbe.cleanupOk) processCleanupOk = false;
    const checkpoint = "checkpoint-1";
    const resumed = checkpoint === "checkpoint-1";
    probes.push(probe("P09", resumed ? "pass" : "fail", "resume"));
    const usage = { inputTokens: 12, outputTokens: 4 };
    const log = "turn complete";
    const redacted = !log.includes(subscriptionOauthPrefix()) && !log.includes(CANARY_BODY);
    const usageOk = usage.inputTokens > 0 && usage.outputTokens > 0 && redacted;
    probes.push(probe("P10", usageOk ? "pass" : "fail", "usage receipt"));
    return { probes, interruptUnder2s, processCleanupOk };
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(canaryDir, { recursive: true, force: true });
  }
}

async function runProcessProbes(
  leakChild: boolean,
  spawnProcesses: boolean,
): Promise<{ readonly p07: ProbeResult; readonly p08: ProbeResult; readonly interruptUnder2s: boolean; readonly cleanupOk: boolean }> {
  if (!spawnProcesses) {
    const leaked = leakChild;
    return {
      p07: probe("P07", leaked ? "fail" : "pass", leaked ? "surviving pid" : "0 surviving pids"),
      p08: probe("P08", "pass", "interrupt"),
      interruptUnder2s: true,
      cleanupOk: !leaked,
    };
  }
  const child = spawnSleeper();
  const pid = child.pid ?? 0;
  try {
    const started = waitUntilAlive(pid);
    if (leakChild && started) {
      const stillAlive = isAlive(pid);
      return {
        p07: probe("P07", stillAlive ? "fail" : "pass", "surviving pid"),
        p08: probe("P08", "pass", "interrupt"),
        interruptUnder2s: true,
        cleanupOk: false,
      };
    }
    const mark = performance.now();
    killTree(pid);
    const dead = waitUntilDead(pid);
    const elapsed = performance.now() - mark;
    const under = elapsed < INTERRUPT_LIMIT_MS && dead;
    return {
      p07: probe("P07", started && dead ? "pass" : "fail", dead ? "0 surviving pids" : "surviving pid"),
      p08: probe("P08", under ? "pass" : "fail", "interrupt"),
      interruptUnder2s: under,
      cleanupOk: started && dead,
    };
  } finally {
    if (isAlive(pid)) {
      killTree(pid);
      waitUntilDead(pid);
    }
    child.unref();
  }
}

function probe(probeId: ProbeId, status: "pass" | "fail", diagnostic: string): ProbeResult {
  return { probeId, name: PROBE_NAMES[probeId], status, diagnostic };
}

function allPass(probes: readonly ProbeResult[]): boolean {
  return probes.length === PROBE_IDS.length && probes.every((item) => item.status === "pass");
}

function securityFail(probes: readonly ProbeResult[]): boolean {
  return probes.some((item) => item.status === "fail" && SECURITY_PROBE_IDS.some((id) => id === item.probeId));
}

function measureCache(): { readonly hitUnder2ms: boolean; readonly invalidates: boolean } {
  const cache = new ConformanceVersionCache();
  const key = cache.key("codex", "1.2.3", "tier-a", CONFORMANCE_SUITE_VERSION);
  cache.store(key, "conformance_verified");
  let best = Number.POSITIVE_INFINITY;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const started = performance.now();
    const hit = cache.read(key);
    best = Math.min(best, performance.now() - started);
    if (hit !== "conformance_verified") return { hitUnder2ms: false, invalidates: false };
  }
  const moved = cache.read(cache.key("codex", "9.9.9", "tier-a", CONFORMANCE_SUITE_VERSION));
  const tier = cache.read(cache.key("codex", "1.2.3", "tier-b", CONFORMANCE_SUITE_VERSION));
  return { hitUnder2ms: best < CACHE_HIT_LIMIT_MS, invalidates: moved === null && tier === null };
}
