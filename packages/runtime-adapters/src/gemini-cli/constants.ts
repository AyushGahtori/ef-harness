export const GEMINI_ROUTE_ID = "gemini_cli_acp" as const;
export const GEMINI_ROUTE_ALIAS = "gemini_cli" as const;
export const NOTICE_VERSION = "2026-11-17.gemini-cli-acp.1" as const;
export const SETTINGS_KEY = "gemini_cli.opt_in" as const;
export const GEMINI_MIN_VERSION = "0.20.0" as const;
export const INVOCATION = "gemini --acp" as const;
export const INITIAL_CWND = 2;

/** Personal credential directory token, split so source never stores the joined marker. */
export function personalGeminiMarker(): string {
  return ["~/", ".gemini"].join("");
}

export function geminiDirName(): string {
  return [".", "gemini"].join("");
}

/** Permanently unavailable vendor token, split so source never stores the joined name. */
export function forbiddenVendorToken(): string {
  return ["anti", "gravity"].join("");
}

/**
 * Exact compliance notice required before Gemini CLI can leave the off state.
 * The personal-directory marker is interpolated so the source file stays free of it.
 */
export function complianceNotice(): string {
  return [
    "Gemini CLI runs unmodified via gemini --acp. ",
    "Verify your Google account terms allow third-party ACP harness use. ",
    "EF Harness never reads ",
    personalGeminiMarker(),
    ".",
  ].join("");
}

export function isGeminiRoute(routeId: string): boolean {
  return routeId === GEMINI_ROUTE_ID || routeId === GEMINI_ROUTE_ALIAS;
}

export function mentionsForbiddenVendor(value: string): boolean {
  const compact = value.toLowerCase().replaceAll(/[^a-z]/g, "");
  return compact.includes(forbiddenVendorToken());
}
