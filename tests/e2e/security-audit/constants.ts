export const REPORT_SCHEMA = "security-audit-certification/1" as const;

export const PURGE_STEP_LABELS = [
  "sqlite-delete-rows",
  "cas-blob-purge",
  "fts-rebuild",
  "wal-truncate",
  "vacuum",
  "log-rewrite",
  "view-re-export",
  "telemetry-scrub",
] as const;

export const RED_TEAM_VECTORS = [
  "readme-prompt-injection",
  "test-edit-oracle-gaming",
  "malicious-postinstall",
  "hidden-web-fact-injection",
  "poisoned-skill-config-override",
  "vault-canary-multi-sink",
] as const;

export const ELECTRON_SECURITY_TARGETS = ["main", "pop-out", "preview-webview"] as const;

export const SILENT_FALLBACK_SCENARIOS = [
  "local-to-paid",
  "subscription-to-paid",
  "copilot-to-overage",
  "subscription-capped",
  "route-revoked",
] as const;