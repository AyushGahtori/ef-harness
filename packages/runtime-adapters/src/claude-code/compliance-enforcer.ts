import {
  CONSOLE_KEY_REQUIRED_MESSAGE,
  consoleKeyPrefix,
  credentialsFileSuffix,
  oauthTokenEnvName,
  subscriptionOauthPrefix,
  subscriptionSetupMarker,
} from "./markers.js";

export type ComplianceCode =
  | "missing_console_key"
  | "subscription_oauth"
  | "setup_flow"
  | "oauth_env"
  | "credentials_file"
  | "invalid_prefix";

export type ComplianceVerdict =
  | { readonly ok: true; readonly secret: string; readonly delivery: "env" | "proxy" }
  | { readonly ok: false; readonly code: ComplianceCode; readonly message: string };

export interface ComplianceInput {
  readonly secret: string | null;
  readonly hostEnv: Readonly<Record<string, string | undefined>>;
  readonly sourcePaths?: readonly string[];
  readonly delivery: "env" | "proxy";
}

/**
 * Console API key only. Refuses subscription OAuth, setup flows, and personal credential files.
 * Does not read those files.
 */
export class ClaudeConsoleKeyComplianceEnforcer {
  evaluate(input: ComplianceInput): ComplianceVerdict {
    const oauthName = oauthTokenEnvName();
    if (Object.prototype.hasOwnProperty.call(input.hostEnv, oauthName) && input.hostEnv[oauthName] !== undefined) {
      return refuse("oauth_env");
    }
    for (const value of Object.values(input.hostEnv)) {
      if (typeof value === "string" && value.toLowerCase().includes(subscriptionSetupMarker())) {
        return refuse("setup_flow");
      }
    }
    for (const sourcePath of input.sourcePaths ?? []) {
      if (pathIsPersonalCredentials(sourcePath)) return refuse("credentials_file");
    }

    const secret = input.secret?.trim() ?? "";
    if (!secret) return refuse("missing_console_key");
    if (secret.toLowerCase().includes(subscriptionSetupMarker())) return refuse("setup_flow");
    if (secret.startsWith(subscriptionOauthPrefix())) return refuse("subscription_oauth");
    if (secret.includes("\n") || secret.includes("\r")) return refuse("invalid_prefix");
    if (!secret.startsWith(consoleKeyPrefix())) return refuse("invalid_prefix");
    return { ok: true, secret, delivery: input.delivery };
  }
}

export function pathIsPersonalCredentials(sourcePath: string): boolean {
  const normalized = sourcePath.replaceAll("\\", "/").toLowerCase();
  return normalized.endsWith(credentialsFileSuffix().toLowerCase()) || normalized.includes("/.claude/.credentials.json");
}

function refuse(code: ComplianceCode): ComplianceVerdict {
  return { ok: false, code, message: CONSOLE_KEY_REQUIRED_MESSAGE };
}
