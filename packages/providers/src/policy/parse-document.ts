import { PolicyDocumentError } from "./errors.js";
import type {
  BillingKind,
  CliDenylistRange,
  CliFloor,
  CliRuntime,
  ComplianceDeclaration,
  ModelTier,
  PolicyModel,
  PolicyRoute,
  PolicySignature,
  ProviderPolicyDocument,
  RouteComplianceStatus,
  SiwcPreviewConstraints,
  UnsignedProviderPolicy,
} from "./types.js";
import { BILLING_KINDS, CLI_GATE_EFFECTS, CLI_RUNTIMES, MODEL_TIERS, ROUTE_STATUSES } from "./types.js";

export function parsePolicyDocument(record: Record<string, unknown>): ProviderPolicyDocument {
  const unsigned = parseUnsigned(record);
  const signature = parseSignature(record.signature);
  return { ...unsigned, signature };
}

function parseUnsigned(record: Record<string, unknown>): UnsignedProviderPolicy {
  if (!isSafeInt(record.policyVersion) || (record.policyVersion as number) < 1) {
    throw new PolicyDocumentError("malformed", "policyVersion must be a positive integer");
  }
  if (typeof record.publishedAt !== "string" || !Number.isFinite(Date.parse(record.publishedAt))) {
    throw new PolicyDocumentError("malformed", "publishedAt must be an ISO timestamp");
  }
  if (typeof record.refreshUrl !== "string" || !record.refreshUrl.startsWith("https://")) {
    throw new PolicyDocumentError("malformed", "refreshUrl must be https");
  }
  if (!Array.isArray(record.routes) || !Array.isArray(record.cliFloors) || !Array.isArray(record.models)) {
    throw new PolicyDocumentError("malformed", "routes, cliFloors, and models must be arrays");
  }
  return {
    policyVersion: record.policyVersion as number,
    publishedAt: record.publishedAt,
    refreshUrl: record.refreshUrl,
    compliance: parseCompliance(record.compliance),
    routes: record.routes.map((route) => parseRoute(route)),
    cliFloors: record.cliFloors.map((floor) => parseFloor(floor)),
    models: record.models.map((model) => parseModel(model)),
  };
}

function parseSignature(value: unknown): PolicySignature {
  if (!isRecord(value)) throw new PolicyDocumentError("malformed", "signature is missing");
  if (value.alg !== "Ed25519" || typeof value.keyId !== "string" || typeof value.sig !== "string") {
    throw new PolicyDocumentError("malformed", "signature fields are invalid");
  }
  return { alg: "Ed25519", keyId: value.keyId, sig: value.sig };
}

function parseCompliance(value: unknown): ComplianceDeclaration {
  if (!isRecord(value) || !isRecord(value.siwc)) {
    throw new PolicyDocumentError("malformed", "compliance block is missing");
  }
  const siwc = value.siwc;
  return {
    immutable: requireBoolean(value.immutable, "compliance.immutable"),
    anthropicConsoleOnly: requireBoolean(value.anthropicConsoleOnly, "compliance.anthropicConsoleOnly"),
    subscriptionOauthWithdrawn: requireBoolean(
      value.subscriptionOauthWithdrawn,
      "compliance.subscriptionOauthWithdrawn",
    ),
    geminiCliDefaultEnabled: requireBoolean(
      value.geminiCliDefaultEnabled,
      "compliance.geminiCliDefaultEnabled",
    ),
    geminiRequiresExplicitOptIn: requireBoolean(
      value.geminiRequiresExplicitOptIn,
      "compliance.geminiRequiresExplicitOptIn",
    ),
    geminiInvocation: requireString(value.geminiInvocation, "compliance.geminiInvocation"),
    geminiNotice: requireString(value.geminiNotice, "compliance.geminiNotice"),
    geminiReadsCredentialDirectory: requireBoolean(
      value.geminiReadsCredentialDirectory,
      "compliance.geminiReadsCredentialDirectory",
    ),
    forbiddenVendorDenied: requireBoolean(value.forbiddenVendorDenied, "compliance.forbiddenVendorDenied"),
    siwc: parseConstraints(siwc),
  };
}

function parseConstraints(value: Record<string, unknown>): SiwcPreviewConstraints {
  if (typeof value.scope !== "string" || value.scope.length === 0) {
    throw new PolicyDocumentError("malformed", "siwc scope is invalid");
  }
  if (
    typeof value.store !== "boolean" ||
    typeof value.stream !== "boolean" ||
    typeof value.persistExtAgentHostId !== "boolean"
  ) {
    throw new PolicyDocumentError("malformed", "siwc wire constraints are invalid");
  }
  if (
    !Array.isArray(value.forbiddenRequestFields) ||
    value.forbiddenRequestFields.some((field) => typeof field !== "string")
  ) {
    throw new PolicyDocumentError("malformed", "siwc forbidden fields are invalid");
  }
  return {
    scope: value.scope,
    store: value.store,
    stream: value.stream,
    forbiddenRequestFields: value.forbiddenRequestFields.filter(
      (field): field is string => typeof field === "string",
    ),
    persistExtAgentHostId: value.persistExtAgentHostId,
  };
}

function parseRoute(value: unknown): PolicyRoute {
  if (!isRecord(value)) throw new PolicyDocumentError("malformed", "route must be an object");
  const status = requireString(value.status, "route.status");
  if (!isRouteStatus(status)) throw new PolicyDocumentError("malformed", `unknown route status ${status}`);
  const billing = requireString(value.billing, "route.billing");
  if (!isBilling(billing)) throw new PolicyDocumentError("malformed", `unknown billing ${billing}`);
  return {
    id: requireString(value.id, "route.id"),
    provider: requireString(value.provider, "route.provider"),
    authFlow: requireString(value.authFlow, "route.authFlow"),
    status,
    billing,
    revocationNotice: requireNullableString(value.revocationNotice, "route.revocationNotice"),
    alternatives: requireStringArray(value.alternatives, "route.alternatives"),
    defaultEnabled: requireBoolean(value.defaultEnabled, "route.defaultEnabled"),
    invocation: requireNullableString(value.invocation, "route.invocation"),
    notice: requireNullableString(value.notice, "route.notice"),
    readsCredentialDirectory: requireBoolean(
      value.readsCredentialDirectory,
      "route.readsCredentialDirectory",
    ),
    consoleKeyOnly: requireBoolean(value.consoleKeyOnly, "route.consoleKeyOnly"),
    constraints: value.constraints === null ? null : parseConstraints(requireRecord(value.constraints, "route.constraints")),
  };
}

function parseFloor(value: unknown): CliFloor {
  if (!isRecord(value)) throw new PolicyDocumentError("malformed", "cli floor must be an object");
  const runtime = requireString(value.runtime, "cli.runtime");
  if (!isCliRuntime(runtime)) throw new PolicyDocumentError("malformed", `unknown runtime ${runtime}`);
  if (!Array.isArray(value.denylist)) throw new PolicyDocumentError("malformed", "cli denylist must be an array");
  return {
    runtime,
    minVersion: requireString(value.minVersion, "cli.minVersion"),
    denylist: value.denylist.map((entry) => parseDenylist(entry)),
  };
}

function parseDenylist(value: unknown): CliDenylistRange {
  if (!isRecord(value)) throw new PolicyDocumentError("malformed", "denylist entry must be an object");
  const effect = requireString(value.effect, "denylist.effect");
  if (!isGateEffect(effect)) throw new PolicyDocumentError("malformed", `unknown denylist effect ${effect}`);
  return {
    from: requireString(value.from, "denylist.from"),
    to: requireString(value.to, "denylist.to"),
    effect,
    reason: requireString(value.reason, "denylist.reason"),
  };
}

function parseModel(value: unknown): PolicyModel {
  if (!isRecord(value)) throw new PolicyDocumentError("malformed", "model must be an object");
  const tier = requireString(value.tier, "model.tier");
  if (!isTier(tier)) throw new PolicyDocumentError("malformed", `unknown tier ${tier}`);
  if (!isRecord(value.defaultPassPriors)) {
    throw new PolicyDocumentError("malformed", "defaultPassPriors must be an object");
  }
  const priors: Record<string, number> = {};
  for (const [key, prior] of Object.entries(value.defaultPassPriors)) {
    if (typeof prior !== "number" || !Number.isFinite(prior)) {
      throw new PolicyDocumentError("malformed", `prior ${key} must be a finite number`);
    }
    priors[key] = prior;
  }
  return {
    modelId: requireString(value.modelId, "model.modelId"),
    family: requireString(value.family, "model.family"),
    provider: requireString(value.provider, "model.provider"),
    tier,
    contextWindow: requireInt(value.contextWindow, "model.contextWindow"),
    supportsTools: requireBoolean(value.supportsTools, "model.supportsTools"),
    supportsStructuredJson: requireBoolean(value.supportsStructuredJson, "model.supportsStructuredJson"),
    supportsVision: requireBoolean(value.supportsVision, "model.supportsVision"),
    inputMicroUsdPer1M: requireInt(value.inputMicroUsdPer1M, "model.inputMicroUsdPer1M"),
    outputMicroUsdPer1M: requireInt(value.outputMicroUsdPer1M, "model.outputMicroUsdPer1M"),
    cachedInputMicroUsdPer1M: requireInt(
      value.cachedInputMicroUsdPer1M,
      "model.cachedInputMicroUsdPer1M",
    ),
    defaultPassPriors: priors,
    deprecatedAfter: requireNullableString(value.deprecatedAfter, "model.deprecatedAfter"),
    replacementModelId: requireNullableString(value.replacementModelId, "model.replacementModelId"),
    revoked: requireBoolean(value.revoked, "model.revoked"),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new PolicyDocumentError("malformed", `${label} must be an object`);
  return value;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new PolicyDocumentError("malformed", `${label} must be a string`);
  }
  return value;
}

function requireNullableString(value: unknown, label: string): string | null {
  if (value === null) return null;
  if (typeof value !== "string") throw new PolicyDocumentError("malformed", `${label} must be a string or null`);
  return value;
}

function requireBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new PolicyDocumentError("malformed", `${label} must be boolean`);
  return value;
}

function requireInt(value: unknown, label: string): number {
  if (!isSafeInt(value) || (value as number) < 0) {
    throw new PolicyDocumentError("malformed", `${label} must be a non-negative integer`);
  }
  return value as number;
}

function requireStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new PolicyDocumentError("malformed", `${label} must be a string array`);
  }
  return [...value];
}

function isSafeInt(value: unknown): boolean {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function isRouteStatus(value: string): value is RouteComplianceStatus {
  return (ROUTE_STATUSES as readonly string[]).includes(value);
}

function isBilling(value: string): value is BillingKind {
  return (BILLING_KINDS as readonly string[]).includes(value);
}

function isCliRuntime(value: string): value is CliRuntime {
  return (CLI_RUNTIMES as readonly string[]).includes(value);
}

function isGateEffect(value: string): value is CliDenylistRange["effect"] {
  return (CLI_GATE_EFFECTS as readonly string[]).includes(value);
}

function isTier(value: string): value is ModelTier {
  return (MODEL_TIERS as readonly string[]).includes(value);
}
