import type { WrappedVendor } from "./types.js";

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

export const MXC_HELPER_PIN = {
  name: "ef-mxc-launch",
  source: "openai/codex",
  crate: "codex-rs/mxc-sandbox",
  tag: "rust-v0.162.1",
  license: "Apache-2.0",
  transitiveSdk: "microsoft/mxc",
  transitiveLicense: "MIT",
  manifestPath: "spikes/windows-sandbox/CODEX_EVAL.md",
} as const;

export const MXC_24H2_BUILD = 26100;
export const MXC_25H2_BUILD = 26200;
export const MXC_REVISION = 9278;
export const DEFAULT_JOB_MEMORY_BYTES = 2 * 1024 * 1024 * 1024;
export const DEFAULT_ACTIVE_PROCESS_LIMIT = 64;
export const DEFAULT_COMMAND_TIMEOUT_MS = 120_000;
