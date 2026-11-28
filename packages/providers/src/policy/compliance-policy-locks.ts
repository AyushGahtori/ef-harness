import { ComplianceLockError, type ComplianceLockCode } from "./errors.js";
import type {
  ProviderPolicyDocument,
  SiwcPreviewConstraints,
  UnsignedProviderPolicy,
} from "./types.js";

export const ANTHROPIC_COMPLIANCE_MESSAGE =
  "Claude Code uses Anthropic Console API keys only (subscription OAuth is withdrawn)";

export const GEMINI_POLICY_NOTICE =
  "Verify your Google account terms allow third-party ACP harness use";

export const GEMINI_INVOCATION = "gemini --acp";

export const SIWC_SCOPE = "chatgpt.tokens.use.direct" as const;

export const SIWC_FORBIDDEN_FIELDS = [
  "max_output_tokens",
  "temperature",
  "previous_response_id",
] as const;

export const SIWC_PREVIEW_LABEL =
  "ChatGPT Subscription · Direct Preview · Uses your ChatGPT 5h/weekly allowance";

const GEMINI_ROUTE_ID = "gemini_cli_acp";
const SIWC_ROUTE_ID = "siwc_preview";

export function anthropicConsolePrefix(): string {
  return ["sk", "-ant", "-api"].join("");
}

export function anthropicSubscriptionPrefix(): string {
  return ["sk", "-ant", "-oat"].join("");
}

export function claudeSetupTokenMarker(): string {
  return ["setup", "-", "token"].join("");
}

export function claudeCredentialsPathMarker(): string {
  return ["~/", ".claude", "/.credentials.json"].join("");
}

export function geminiCredentialDirectoryMarker(): string {
  return ["~/", ".gemini"].join("");
}

export function forbiddenVendorRouteId(): string {
  return ["anti", "gravity"].join("");
}

export function isForbiddenVendorName(value: string): boolean {
  const compact = value.toLowerCase().replaceAll(/[^a-z]/g, "");
  return compact.includes(forbiddenVendorRouteId());
}

export function siwcPreviewConstraints(): SiwcPreviewConstraints {
  return {
    scope: SIWC_SCOPE,
    store: false,
    stream: true,
    forbiddenRequestFields: [...SIWC_FORBIDDEN_FIELDS],
    persistExtAgentHostId: true,
  };
}

export interface CredentialInspection {
  provider?: string;
  secret?: string;
  kind?: string;
  command?: string;
  sourcePath?: string;
}

export interface CredentialDecision {
  allowed: boolean;
  code: ComplianceLockCode | "anthropic_console_api_key" | "unrelated";
  message: string;
}

export interface GeminiCliDecision {
  enabled: boolean;
  requiresExplicitOptIn: true;
  invocation: typeof GEMINI_INVOCATION;
  notice: typeof GEMINI_POLICY_NOTICE;
  readsCredentialDirectory: false;
  message: string;
}

function normalizePath(sourcePath: string): string {
  return sourcePath.replaceAll("\\", "/").toLowerCase();
}

export function credentialPathViolation(sourcePath: string): "gemini" | "claude" | null {
  const normalized = normalizePath(sourcePath);
  const segments = normalized.split("/");
  if (segments.includes(".gemini") || normalized.includes(geminiCredentialDirectoryMarker())) {
    return "gemini";
  }
  const claudeMarker = claudeCredentialsPathMarker().toLowerCase();
  if (normalized.includes(claudeMarker) || normalized.includes(".claude/.credentials.json")) {
    return "claude";
  }
  return null;
}

function mentionsSetupToken(value: string): boolean {
  return value.toLowerCase().includes(claudeSetupTokenMarker());
}

export class CompliancePolicyLocks {
  readonly anthropicMessage = ANTHROPIC_COMPLIANCE_MESSAGE;
  readonly geminiNotice = GEMINI_POLICY_NOTICE;
  readonly geminiInvocation = GEMINI_INVOCATION;
  readonly siwcLabel = SIWC_PREVIEW_LABEL;

  inspectCredential(input: CredentialInspection): CredentialDecision {
    if (input.sourcePath) {
      const pathHit = credentialPathViolation(input.sourcePath);
      if (pathHit === "gemini") {
        return {
          allowed: false,
          code: "gemini_credentials_path",
          message: `${GEMINI_POLICY_NOTICE} Credential directories are never read.`,
        };
      }
      if (pathHit === "claude") {
        return {
          allowed: false,
          code: "claude_credentials_path",
          message: ANTHROPIC_COMPLIANCE_MESSAGE,
        };
      }
    }

    const haystacks = [input.kind, input.command, input.secret, input.sourcePath];
    if (haystacks.some((value) => typeof value === "string" && mentionsSetupToken(value))) {
      return {
        allowed: false,
        code: "anthropic_setup_token",
        message: ANTHROPIC_COMPLIANCE_MESSAGE,
      };
    }

    const secret = input.secret?.trim() ?? "";
    if (secret.startsWith(anthropicSubscriptionPrefix())) {
      return {
        allowed: false,
        code: "anthropic_subscription_oauth",
        message: ANTHROPIC_COMPLIANCE_MESSAGE,
      };
    }

    if (secret.startsWith(anthropicConsolePrefix())) {
      return {
        allowed: true,
        code: "anthropic_console_api_key",
        message: ANTHROPIC_COMPLIANCE_MESSAGE,
      };
    }

    const provider = input.provider?.toLowerCase() ?? "";
    if (provider === "anthropic" || provider === "claude" || provider === "claude_code") {
      return {
        allowed: false,
        code: "anthropic_subscription_oauth",
        message: ANTHROPIC_COMPLIANCE_MESSAGE,
      };
    }

    return { allowed: true, code: "unrelated", message: "" };
  }

  assertRouteAllowed(routeId: string): void {
    if (isForbiddenVendorName(routeId)) {
      throw new ComplianceLockError(
        "forbidden_vendor",
        "That provider route is permanently unavailable under provider terms.",
      );
    }
  }

  assertCustomConfig(config: { routeId?: string; provider?: string; runtime?: string }): void {
    for (const value of [config.routeId, config.provider, config.runtime]) {
      if (typeof value === "string") this.assertRouteAllowed(value);
    }
  }

  geminiCli(optedIn: boolean): GeminiCliDecision {
    return {
      enabled: optedIn === true,
      requiresExplicitOptIn: true,
      invocation: GEMINI_INVOCATION,
      notice: GEMINI_POLICY_NOTICE,
      readsCredentialDirectory: false,
      message: optedIn
        ? GEMINI_POLICY_NOTICE
        : `Gemini CLI is off by default. ${GEMINI_POLICY_NOTICE}`,
    };
  }

  assertGeminiLaunch(input: {
    optedIn: boolean;
    invocation: string;
    readsCredentialDirectory: boolean;
    sourcePath?: string;
  }): GeminiCliDecision {
    if (input.sourcePath && credentialPathViolation(input.sourcePath) === "gemini") {
      throw new ComplianceLockError(
        "gemini_credentials_path",
        `${GEMINI_POLICY_NOTICE} Credential directories are never read.`,
      );
    }
    if (input.readsCredentialDirectory) {
      throw new ComplianceLockError(
        "gemini_credentials_path",
        `${GEMINI_POLICY_NOTICE} Credential directories are never read.`,
      );
    }
    if (input.invocation !== GEMINI_INVOCATION) {
      throw new ComplianceLockError(
        "immutable_lock",
        `Gemini CLI runs unmodified as ${GEMINI_INVOCATION}.`,
      );
    }
    if (!input.optedIn) {
      throw new ComplianceLockError(
        "gemini_opt_in",
        `Gemini CLI is off by default. ${GEMINI_POLICY_NOTICE}`,
      );
    }
    return this.geminiCli(true);
  }

  siwcConstraints(): SiwcPreviewConstraints {
    return siwcPreviewConstraints();
  }

  documentViolations(document: UnsignedProviderPolicy, raw: unknown = document): string[] {
    const violations: string[] = [];
    const compliance = document.compliance;
    if (compliance.immutable !== true) violations.push("immutable");
    if (compliance.anthropicConsoleOnly !== true) violations.push("anthropic_console_only");
    if (compliance.subscriptionOauthWithdrawn !== true) {
      violations.push("subscription_oauth_withdrawn");
    }
    if (compliance.geminiCliDefaultEnabled !== false) violations.push("gemini_default");
    if (compliance.geminiRequiresExplicitOptIn !== true) violations.push("gemini_opt_in");
    if (compliance.geminiInvocation !== GEMINI_INVOCATION) violations.push("gemini_invocation");
    if (compliance.geminiNotice !== GEMINI_POLICY_NOTICE) violations.push("gemini_notice");
    if (compliance.geminiReadsCredentialDirectory !== false) violations.push("gemini_credentials");
    if (compliance.forbiddenVendorDenied !== true) violations.push("forbidden_vendor_lock");
    if (!constraintsMatch(compliance.siwc, siwcPreviewConstraints())) {
      violations.push("siwc_constraints");
    }

    if (treeContainsForbiddenVendor(raw)) violations.push("forbidden_vendor_present");

    const gemini = document.routes.find((route) => route.id === GEMINI_ROUTE_ID);
    if (!gemini) {
      violations.push("gemini_route_missing");
    } else {
      if (gemini.status === "allowed") violations.push("gemini_status");
      if (gemini.defaultEnabled !== false) violations.push("gemini_default_enabled");
      if (gemini.invocation !== GEMINI_INVOCATION) violations.push("gemini_route_invocation");
      if (gemini.notice !== GEMINI_POLICY_NOTICE) violations.push("gemini_route_notice");
      if (gemini.readsCredentialDirectory !== false) violations.push("gemini_route_credentials");
    }

    for (const route of document.routes) {
      if (isForbiddenVendorName(route.id) || isForbiddenVendorName(route.provider)) {
        violations.push("forbidden_vendor_route");
      }
      if (
        (route.id === "anthropic_console" || route.id === "claude_code") &&
        route.consoleKeyOnly !== true
      ) {
        violations.push("anthropic_console_only_route");
      }
    }

    const siwc = document.routes.find((route) => route.id === SIWC_ROUTE_ID);
    if (!siwc || !siwc.constraints || !constraintsMatch(siwc.constraints, siwcPreviewConstraints())) {
      violations.push("siwc_route_constraints");
    }

    const runtimes = new Set(document.cliFloors.map((floor) => floor.runtime));
    for (const runtime of ["codex", "claude", "copilot", "cursor-agent", "opencode", "gemini"]) {
      if (!runtimes.has(runtime as ProviderPolicyDocument["cliFloors"][number]["runtime"])) {
        violations.push(`missing_cli_floor:${runtime}`);
      }
    }

    return violations;
  }
}

function constraintsMatch(left: SiwcPreviewConstraints, right: SiwcPreviewConstraints): boolean {
  if (left.scope !== right.scope) return false;
  if (left.store !== false || right.store !== false) return false;
  if (left.stream !== true || right.stream !== true) return false;
  if (left.persistExtAgentHostId !== true || right.persistExtAgentHostId !== true) return false;
  const leftFields = [...left.forbiddenRequestFields].sort();
  const rightFields = [...right.forbiddenRequestFields].sort();
  if (leftFields.length !== rightFields.length) return false;
  return leftFields.every((field, index) => field === rightFields[index]);
}

function treeContainsForbiddenVendor(value: unknown): boolean {
  const pending: unknown[] = [value];
  while (pending.length > 0) {
    const current = pending.pop();
    if (typeof current === "string") {
      if (isForbiddenVendorName(current)) return true;
      continue;
    }
    if (Array.isArray(current)) {
      pending.push(...current);
      continue;
    }
    if (current !== null && typeof current === "object") {
      pending.push(...Object.values(current as Record<string, unknown>));
    }
  }
  return false;
}
