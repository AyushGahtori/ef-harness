import type { TierCapabilityFlags, WrappedVendor } from "./types.js";

export const SANDBOX_OFFLINE_ACCOUNT = "EFHarnessSandboxOffline";
export const SANDBOX_ONLINE_ACCOUNT = "EFHarnessSandboxOnline";
export const SANDBOX_ACCOUNTS = [SANDBOX_OFFLINE_ACCOUNT, SANDBOX_ONLINE_ACCOUNT] as const;

export const DEFAULT_OFFLINE_SID = "S-1-5-21-42424242-1-1001";
export const DEFAULT_ONLINE_SID = "S-1-5-21-42424242-1-1002";

export const TIER_B_CAPABILITIES: TierCapabilityFlags = {
  fileWritesEnforced: true,
  secretReadsDenied: true,
  networkEnforced: true,
  requiresAdmin: true,
};

export const VOLUME_GUIDANCE = "Move project to local NTFS/Dev Drive, or use Tier A/D";

export const DEFAULT_JOB_MEMORY_BYTES = 2 * 1024 * 1024 * 1024;
export const DEFAULT_ACTIVE_PROCESS_LIMIT = 64;
export const DEFAULT_POOL_SIZE = 2;

export const VENDOR_PROVIDER_HOSTS: Readonly<Record<WrappedVendor, readonly string[]>> = {
  codex: ["api.openai.com", "chatgpt.com"],
  claude_code: ["api.anthropic.com"],
  copilot: ["api.githubcopilot.com"],
  cursor: ["api2.cursor.sh"],
  gemini: ["generativelanguage.googleapis.com"],
  opencode: [],
};

export const VENDOR_TOKEN_ENV: Readonly<Record<WrappedVendor, string | null>> = {
  codex: "ACCESS_TOKEN",
  claude_code: "ANTHROPIC_API_KEY",
  cursor: "CURSOR_API_KEY",
  copilot: "GITHUB_TOKEN",
  gemini: null,
  opencode: null,
};

export const VENDOR_SDK_FIELD: Readonly<Record<WrappedVendor, string | null>> = {
  codex: "ACCESS_TOKEN",
  claude_code: "ANTHROPIC_API_KEY",
  cursor: "CURSOR_API_KEY",
  copilot: "gitHubToken",
  gemini: null,
  opencode: null,
};

export const IPV4_NON_LOOPBACK = ["0.0.0.0-126.255.255.255", "128.0.0.0-255.255.255.255"] as const;
export const IPV6_NON_LOOPBACK = ["::", "::2-ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff"] as const;
export const IPV4_LOOPBACK = ["127.0.0.0/8"] as const;
export const IPV6_LOOPBACK = ["::1"] as const;
