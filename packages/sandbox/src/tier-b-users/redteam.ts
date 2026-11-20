import { buildTierBFirewallRules } from "./firewall.js";
import { readWindowsTierBInspector } from "./host.js";
import { probeTierB } from "./probe.js";
import type { LiveProbeRow, LiveRedTeamReport, TierBHostInspector } from "./types.js";

const PROBE_IDS = ["read_ssh", "read_dpapi", "write_outside_worktree", "write_git", "raw_external_tcp"] as const;

export function tierBLiveOptIn(argv: readonly string[] = process.argv, env: NodeJS.ProcessEnv = process.env): boolean {
  return argv.includes("--tier-b-live") || env.EF_TIER_B_LIVE === "1";
}

function skipped(status: LiveRedTeamReport["status"], reason: string, host: LiveRedTeamReport["host"]): LiveRedTeamReport {
  const probes: LiveProbeRow[] = PROBE_IDS.map((testId) => ({
    testId,
    expectedBlocked: true,
    actuallyBlocked: false,
    executed: false,
    detail: reason,
  }));
  return { status, reason, claimedOsEnforcement: false, probes, host };
}

export async function runTierBLiveRedTeam(options?: {
  readonly inspector?: TierBHostInspector;
  readonly live?: boolean;
  readonly proxyPort?: number;
  readonly mcpPort?: number;
}): Promise<LiveRedTeamReport> {
  const rules = buildTierBFirewallRules({
    proxyPort: options?.proxyPort ?? 4318,
    mcpPort: options?.mcpPort ?? 4320,
  });
  const host = probeTierB(options?.inspector ?? readWindowsTierBInspector(), rules);
  if (!host.available) return skipped("skipped_unprovisioned", "unprovisioned_host", host);
  const live = options?.live ?? tierBLiveOptIn();
  if (!live) return skipped("skipped_not_opted_in", "tier_b_live_not_opted_in", host);
  return skipped("not_run", "os_logon_backend_not_attached", host);
}
