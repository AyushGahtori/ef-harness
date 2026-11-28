import {
  complianceNotice,
  isGeminiRoute,
  mentionsForbiddenVendor,
  NOTICE_VERSION,
  SETTINGS_KEY,
} from "./constants.js";
import { GeminiOptInRequiredError, GeminiRouteRevokedError } from "./errors.js";
import {
  MemoryGlobalSettingsStore,
  type GlobalSettingsStore,
  type OptInRecord,
} from "./ports.js";

export interface SignedRouteRevocation {
  readonly kind: "route_revoked";
  readonly routeId: string;
  readonly notice: string;
}

function parseRecord(raw: string | null): OptInRecord | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const row = parsed as Record<string, unknown>;
  if (typeof row.optedInAt !== "string" || typeof row.noticeVersion !== "string") return null;
  if (typeof row.enabled !== "boolean") return null;
  return {
    optedInAt: row.optedInAt,
    noticeVersion: row.noticeVersion,
    enabled: row.enabled,
    revoked: row.revoked === true,
    revocationNotice: typeof row.revocationNotice === "string" ? row.revocationNotice : null,
  };
}

/**
 * Off-by-default gate. Gemini CLI stays disabled until the exact compliance
 * notice is accepted and `{ optedInAt, noticeVersion }` is stored.
 */
export class GeminiOptInComplianceGate {
  private readonly store: GlobalSettingsStore;
  private readonly now: () => string;

  constructor(deps?: { readonly store?: GlobalSettingsStore; readonly now?: () => string }) {
    this.store = deps?.store ?? new MemoryGlobalSettingsStore();
    this.now = deps?.now ?? (() => new Date().toISOString());
  }

  snapshot(): OptInRecord | null {
    return parseRecord(this.store.get(SETTINGS_KEY));
  }

  get optedIn(): boolean {
    const record = this.snapshot();
    return record !== null && record.noticeVersion === NOTICE_VERSION && record.optedInAt.length > 0;
  }

  get enabled(): boolean {
    const record = this.snapshot();
    return (
      record !== null &&
      record.noticeVersion === NOTICE_VERSION &&
      record.enabled === true &&
      record.revoked !== true
    );
  }

  acceptNotice(noticeText: string): OptInRecord {
    if (mentionsForbiddenVendor(noticeText)) {
      throw new GeminiOptInRequiredError("forbidden_vendor");
    }
    if (noticeText !== complianceNotice()) {
      throw new GeminiOptInRequiredError("notice_mismatch");
    }
    const record: OptInRecord = {
      optedInAt: this.now(),
      noticeVersion: NOTICE_VERSION,
      enabled: true,
      revoked: false,
      revocationNotice: null,
    };
    this.store.set(SETTINGS_KEY, JSON.stringify(record));
    return record;
  }

  disable(): OptInRecord | null {
    const current = this.snapshot();
    if (!current) return null;
    const next: OptInRecord = { ...current, enabled: false };
    this.store.set(SETTINGS_KEY, JSON.stringify(next));
    return next;
  }

  applyRouteRevoked(revocation: SignedRouteRevocation): void {
    if (revocation.kind !== "route_revoked" || !isGeminiRoute(revocation.routeId)) return;
    if (mentionsForbiddenVendor(revocation.notice) || mentionsForbiddenVendor(revocation.routeId)) {
      throw new GeminiOptInRequiredError("forbidden_vendor");
    }
    const current = this.snapshot();
    const next: OptInRecord = {
      optedInAt: current?.optedInAt ?? "",
      noticeVersion: current?.noticeVersion ?? "",
      enabled: false,
      revoked: true,
      revocationNotice: revocation.notice,
    };
    this.store.set(SETTINGS_KEY, JSON.stringify(next));
  }

  assertCanStart(): void {
    const record = this.snapshot();
    if (record?.revoked) {
      throw new GeminiRouteRevokedError(record.revocationNotice ?? "gemini_cli_acp was revoked by signed policy.");
    }
    if (!this.optedIn) throw new GeminiOptInRequiredError("opt_in_required");
    if (!this.enabled) throw new GeminiOptInRequiredError("disabled");
  }
}
