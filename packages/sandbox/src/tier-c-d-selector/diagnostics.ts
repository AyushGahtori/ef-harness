import type { SandboxTierId, TierProbeResult } from "./types.js";
import { TIER_PREFERENCE } from "./types.js";

export const FOREIGN_RUNTIMES = [
  "Copilot",
  "Cursor",
  "Claude Code",
  "Codex",
  "Gemini CLI",
  "OpenCode",
] as const;

export interface TierDiagnostic {
  readonly tier: SandboxTierId;
  readonly title: string;
  readonly available: boolean;
  readonly active: boolean;
  readonly protects: readonly string[];
  readonly doesNotProtect: readonly string[];
  readonly requiresAdmin: boolean;
  readonly reason?: string;
}

export interface SettingsDiagnosticMatrix {
  readonly activeTier: SandboxTierId | "none";
  readonly tiers: readonly TierDiagnostic[];
  readonly restrictedForeignRuntimes: readonly string[];
  readonly summary: string;
}

const COPY: Record<
  SandboxTierId,
  { readonly title: string; readonly protects: readonly string[]; readonly doesNotProtect: readonly string[] }
> = {
  A: {
    title: "MXC",
    protects: ["file writes", "secret reads", "network, with loopback allowed"],
    doesNotProtect: ["a machine whose Windows build does not include Microsoft Execution Containers"],
  },
  B: {
    title: "Sandbox users",
    protects: ["file writes", "secret reads", "network via firewall rules"],
    doesNotProtect: ["setup before the one-time admin provisioning step"],
  },
  D: {
    title: "Container / WSL2",
    protects: ["file writes", "secret reads", "network with --network none", "Linux CI parity"],
    doesNotProtect: ["enforcement while the Docker daemon is stopped; WSL2 memory is reported and .wslconfig is never edited"],
  },
  C: {
    title: "Restricted token",
    protects: ["file writes inside the attempt worktree and temp directory"],
    doesNotProtect: [
      "secret reads",
      "network (HTTP_PROXY, HTTPS_PROXY, NO_PROXY, and GIT_SSH_COMMAND are advisory only)",
      "dependency installs",
      "untrusted dev servers",
      "wrapped foreign agents",
    ],
  },
};

export function buildDiagnosticMatrix(input: {
  readonly probes: ReadonlyMap<SandboxTierId, TierProbeResult>;
  readonly activeTier: SandboxTierId | "none";
}): SettingsDiagnosticMatrix {
  const tiers = TIER_PREFERENCE.map((tier) => {
    const probe = input.probes.get(tier);
    const copy = COPY[tier];
    const row: TierDiagnostic = {
      tier,
      title: copy.title,
      available: probe?.available ?? false,
      active: input.activeTier === tier,
      protects: copy.protects,
      doesNotProtect: copy.doesNotProtect,
      requiresAdmin: probe?.requiresAdmin ?? tier === "B",
    };
    return probe?.reason ? { ...row, reason: probe.reason } : row;
  });
  const restricted =
    input.activeTier === "C" || input.activeTier === "none" ? [...FOREIGN_RUNTIMES] : [];
  const lines = [
    "Sandbox tiers on this machine",
    `Active tier: ${input.activeTier === "none" ? "none" : `${input.activeTier} · ${COPY[input.activeTier].title}`}`,
  ];
  for (const tier of tiers) {
    const state = tier.active ? "active" : tier.available ? "available" : "unavailable";
    lines.push(
      `Tier ${tier.tier} · ${tier.title}: ${state}. Protects ${tier.protects.join(", ")}. Does not protect ${tier.doesNotProtect.join(", ")}.${tier.reason ? ` Reason: ${tier.reason}.` : ""}`,
    );
  }
  if (input.activeTier === "C") {
    lines.push(
      "Tier C shows a yellow weaker-sandbox badge. It never claims secret-read or network enforcement.",
    );
  }
  lines.push(
    restricted.length === 0
      ? "Foreign runtimes are not restricted to stripped mode on this machine."
      : `Foreign runtimes restricted on this machine: ${restricted.join(", ")}. They may run only in Mode S (stripped), and only for Tier C-eligible tasks.`,
  );
  return {
    activeTier: input.activeTier,
    tiers,
    restrictedForeignRuntimes: restricted,
    summary: lines.join("\n"),
  };
}
