/**
 * Capability cells copied from sandbox-and-security.md "The Windows sandbox, in tiers".
 * Tier C never reports network or secret-read enforcement.
 */

const FILE_WRITES = "Enforced";
const SECRET_READS_ENFORCED = "Enforced";
const SECRET_READS_TIER_C = "Not enforced for paths the user can read";

export const TIER_ORDER = ["A", "B", "C", "D"];

export const REDTEAM_TEST_IDS = [
  "read-secret",
  "write-outside",
  "mutate-git-head",
  "raw-tcp",
  "background-sleeper",
];

export const TIER_CAPABILITIES = {
  A: {
    tier: "A",
    name: "MXC",
    mechanism:
      "Microsoft Execution Containers (Windows 11 24H2/25H2 builds that include it), the same mechanism Codex prefers",
    needsAdmin: "No",
    requiresAdmin: false,
    fileWrites: FILE_WRITES,
    secretReads: SECRET_READS_ENFORCED,
    network: "Enforced; loopback allowed",
    fileWritesEnforced: true,
    secretReadsDenied: true,
    networkEnforced: true,
    advisory: false,
    badge: null,
  },
  B: {
    tier: "B",
    name: "Sandbox users",
    mechanism:
      "One-time setup creates two low-privilege local users (offline, online), ACLs on the worktree root, firewall rules blocking the offline user except a loopback proxy port, restricted tokens",
    needsAdmin: "Yes, once",
    requiresAdmin: true,
    users: ["EFHarnessSandboxOffline", "EFHarnessSandboxOnline"],
    fileWrites: FILE_WRITES,
    secretReads: SECRET_READS_ENFORCED,
    network: "Enforced",
    fileWritesEnforced: true,
    secretReadsDenied: true,
    networkEnforced: true,
    advisory: false,
    badge: null,
    setupWhenMissing: "requires one-time admin consent",
  },
  C: {
    tier: "C",
    name: "Restricted token",
    mechanism: "Write-restricted token with a synthetic SID; ACLs grant that SID write only to the worktree",
    needsAdmin: "No",
    requiresAdmin: false,
    fileWrites: FILE_WRITES,
    secretReads: SECRET_READS_TIER_C,
    network: "Advisory only (proxy environment variables)",
    fileWritesEnforced: true,
    secretReadsDenied: false,
    networkEnforced: false,
    advisory: true,
    badge: "weaker sandbox",
    eligibility: "advisory/restricted",
  },
  D: {
    tier: "D",
    name: "Container / WSL2",
    mechanism: "Dev container or WSL2 distro per project",
    needsAdmin: "Docker/WSL2 installed",
    requiresAdmin: false,
    optional: true,
    fileWrites: FILE_WRITES,
    secretReads: SECRET_READS_ENFORCED,
    network: "Enforced; also gives Linux parity with CI",
    fileWritesEnforced: true,
    secretReadsDenied: true,
    networkEnforced: true,
    advisory: false,
    badge: null,
  },
};

export function assertHonestTierC(descriptor) {
  if (!descriptor || descriptor.tier !== "C") {
    throw new Error("honest tier check requires the Tier C descriptor");
  }
  if (descriptor.networkEnforced !== false) {
    throw new Error("Tier C must not report networkEnforced");
  }
  if (descriptor.secretReadsDenied !== false) {
    throw new Error("Tier C must not report secretReadsDenied");
  }
  if (descriptor.network !== TIER_CAPABILITIES.C.network) {
    throw new Error("Tier C network cell does not match sandbox-and-security.md");
  }
  if (descriptor.secretReads !== TIER_CAPABILITIES.C.secretReads) {
    throw new Error("Tier C secret-read cell does not match sandbox-and-security.md");
  }
  if (descriptor.fileWrites !== TIER_CAPABILITIES.C.fileWrites) {
    throw new Error("Tier C file-write cell does not match sandbox-and-security.md");
  }
  if (descriptor.mechanism !== TIER_CAPABILITIES.C.mechanism) {
    throw new Error("Tier C mechanism cell does not match sandbox-and-security.md");
  }
  if (descriptor.needsAdmin !== "No" || descriptor.requiresAdmin !== false) {
    throw new Error("Tier C admin cell does not match sandbox-and-security.md");
  }
  return descriptor;
}

assertHonestTierC(TIER_CAPABILITIES.C);
