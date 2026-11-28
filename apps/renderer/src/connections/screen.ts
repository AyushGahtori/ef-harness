import {
  CLAUDE_CODE_NOTICE,
  GEMINI_CLI_INVOCATION,
  GEMINI_POLICY_NOTICE,
  LOUD_FALLBACK_WARNING,
  NO_CONNECTIONS_BANNER,
  ORACLE_FAMILY_NOTE,
  PRIMARY_CARDS,
  ROLES,
  type RoleId,
} from "./catalog.js";
import { formatMicroUsd } from "./format.js";
import { moveFocus, type KeyInput } from "./keyboard.js";
import { anthropicPasteRejection, detectPastedKeyProvider, pastedProviderLabel } from "./key-detect.js";
import type { ConnectionsViewModel, HealthRowModel } from "./model.js";
import {
  probeKindFor,
  type ConnectionProbePort,
  type FallbackGuardPort,
  type GuardBillingClass,
  type GuardConnectionStatus,
  type GuardConnectionView,
  type RouteComplianceStatus,
} from "./ports.js";
import { EphemeralKeyBuffer, type ConnectionKeyHandoff } from "./secrets.js";
import { layoutForWidth } from "./theme.js";

export interface ScreenConnection {
  readonly id: string;
  readonly label: string;
  readonly provider: string;
  readonly family: string;
  readonly authMode: string;
  readonly billingTypeBadge: "Subscription" | "Pay-per-token" | "Local Free";
  readonly maskedKeyOrEmail: string;
  readonly statusBadge: string;
  readonly allowanceLabel: string;
  readonly allowanceRatio: number;
  readonly activeCwnd: number;
  readonly expiresAtMs: number | null;
  readonly conformanceStatus: string | null;
  readonly monthlySoftMicroUsd: number | null;
  readonly monthlyHardMicroUsd: number | null;
}

export interface ExplicitFallbackRule {
  readonly fromConnectionId: string;
  readonly toConnectionId: string;
  readonly capMicroUsd: number;
}

interface LiveConnection {
  id: string;
  label: string;
  provider: string;
  family: string;
  authMode: string;
  billingTypeBadge: ScreenConnection["billingTypeBadge"];
  maskedKeyOrEmail: string;
  statusBadge: string;
  allowanceLabel: string;
  allowanceRatio: number;
  activeCwnd: number;
  expiresAtMs: number | null;
  conformanceStatus: string | null;
  soft: number | null;
  hard: number | null;
  reservePercent: number | null;
  paused: boolean;
  removed: boolean;
}

export interface ConnectionsScreenOptions {
  readonly connections?: readonly ScreenConnection[];
  readonly buildPaused?: boolean;
  readonly nowMs?: number;
  readonly theme?: "light" | "dark";
  readonly width?: number;
  readonly guard?: FallbackGuardPort;
  readonly probe?: ConnectionProbePort;
  readonly geminiCompliance?: RouteComplianceStatus;
}

function copyConnection(input: ScreenConnection): LiveConnection {
  return {
    id: input.id,
    label: input.label,
    provider: input.provider,
    family: input.family,
    authMode: input.authMode,
    billingTypeBadge: input.billingTypeBadge,
    maskedKeyOrEmail: input.maskedKeyOrEmail,
    statusBadge: input.statusBadge,
    allowanceLabel: input.allowanceLabel,
    allowanceRatio: input.allowanceRatio,
    activeCwnd: input.activeCwnd,
    expiresAtMs: input.expiresAtMs,
    conformanceStatus: input.conformanceStatus,
    soft: input.monthlySoftMicroUsd,
    hard: input.monthlyHardMicroUsd,
    reservePercent: input.billingTypeBadge === "Subscription" ? 50 : null,
    paused: false,
    removed: false,
  };
}

function billingClassFor(badge: ScreenConnection["billingTypeBadge"]): GuardBillingClass {
  if (badge === "Local Free") return "local_free";
  if (badge === "Subscription") return "subscription";
  return "pay_per_token";
}

function guardStatus(row: LiveConnection): GuardConnectionStatus {
  if (row.paused) return "paused";
  const badge = row.statusBadge.toLowerCase();
  if (badge.includes("revoked")) return "route_revoked";
  if (badge.includes("exhaust")) return "exhausted";
  if (badge.includes("expired")) return "expired";
  if (badge.includes("crash")) return "crashed";
  if (badge.includes("fail")) return "failed";
  return "healthy";
}

function guardConnection(row: LiveConnection): GuardConnectionView {
  const billingClass = billingClassFor(row.billingTypeBadge);
  const status = guardStatus(row);
  return {
    id: row.id,
    label: row.label,
    provider: row.provider,
    family: row.family,
    billingClass,
    costRank: billingClass === "local_free" ? 0 : billingClass === "subscription" ? 1 : 2,
    costEstimate: row.allowanceLabel,
    status,
    routable: status === "healthy",
  };
}

function expiryWarning(row: LiveConnection, nowMs: number): string | null {
  if (row.provider !== "cursor" || row.expiresAtMs === null) return null;
  const days = Math.ceil((row.expiresAtMs - nowMs) / 86_400_000);
  if (days < 0 || days > 7) return null;
  return `Cursor key expires in ${days} days`;
}

export class ConnectionsManagementScreen {
  private readonly rows: LiveConnection[];
  private readonly buffer = new EphemeralKeyBuffer();
  private readonly guard: FallbackGuardPort | null;
  private probe: ConnectionProbePort | null;
  private buildPaused: boolean;
  private nowMs: number;
  private themeName: "light" | "dark";
  private width: number;
  private neverFallbackWithoutAsking = true;
  private pasteRejection: string | null = null;
  private geminiNoticeAccepted = false;
  private geminiEnabled = false;
  private geminiBlockReason: string | null = null;
  private readonly geminiCompliance: RouteComplianceStatus;
  private rules: ExplicitFallbackRule[] = [];
  private assignments: Record<RoleId, string | null> = {
    discoveryPlanning: null,
    seniorCoding: null,
    juniorCoding: null,
    oracleReview: null,
  };
  private activeConnectionId: string | null;
  private banner: string | null = null;
  private resumeBlocked = false;
  private detectedProvider: string | null = null;
  private maskedDraft: string | null = null;
  private drawer: ConnectionsViewModel["drawer"] = null;
  private stopCard: ConnectionsViewModel["stopCard"] = null;
  private focusId = "card:siwc";

  constructor(options: ConnectionsScreenOptions = {}) {
    this.rows = (options.connections ?? []).map(copyConnection);
    this.buildPaused = options.buildPaused ?? false;
    this.nowMs = options.nowMs ?? 0;
    this.themeName = options.theme ?? "light";
    this.width = options.width ?? 1280;
    this.guard = options.guard ?? null;
    this.probe = options.probe ?? null;
    this.geminiCompliance = options.geminiCompliance ?? "opt_in_with_notice";
    this.activeConnectionId = this.live()[0]?.id ?? null;
  }

  setProbe(probe: ConnectionProbePort): void {
    this.probe = probe;
  }

  setNow(nowMs: number): void {
    this.nowMs = nowMs;
  }

  setTheme(theme: "light" | "dark"): void {
    this.themeName = theme;
  }

  setWidth(width: number): void {
    this.width = width;
  }

  secretHeld(): string | null {
    return this.buffer.held();
  }

  beginPaste(raw: string): { readonly provider: string | null; readonly message: string | null } {
    const rejection = anthropicPasteRejection(raw);
    this.maskedDraft = null;
    if (rejection) {
      this.buffer.clear();
      this.detectedProvider = null;
      this.pasteRejection = rejection;
      return { provider: null, message: rejection };
    }
    this.pasteRejection = null;
    this.buffer.set(raw);
    const detected = detectPastedKeyProvider(raw);
    this.detectedProvider = detected ? pastedProviderLabel(detected) : null;
    return { provider: this.detectedProvider, message: null };
  }

  savePaste(handoff: ConnectionKeyHandoff): { readonly vaultRef: string; readonly masked: string; readonly provider: string | null } {
    if (this.pasteRejection) throw new Error(this.pasteRejection);
    const raw = this.buffer.held();
    const detected = raw ? detectPastedKeyProvider(raw) : null;
    if (!raw || !detected) throw new Error("No key to save");
    const saved = this.buffer.save(handoff, detected);
    this.maskedDraft = saved.masked;
    const provider = this.detectedProvider;
    if (provider) {
      const id = `pasted-${this.rows.length + 1}`;
      this.rows.push({
        id,
        label: provider,
        provider: provider.toLowerCase().replaceAll(" ", "-"),
        family: provider.toLowerCase().split(" ")[0] ?? "api",
        authMode: "api_key",
        billingTypeBadge: "Pay-per-token",
        maskedKeyOrEmail: saved.masked,
        statusBadge: "Healthy",
        allowanceLabel: formatMicroUsd(0),
        allowanceRatio: 0,
        activeCwnd: 1,
        expiresAtMs: null,
        conformanceStatus: null,
        soft: null,
        hard: null,
        reservePercent: null,
        paused: false,
        removed: false,
      });
      this.activeConnectionId = this.activeConnectionId ?? id;
    }
    return { vaultRef: saved.vaultRef, masked: saved.masked, provider };
  }

  setNeverFallbackWithoutAsking(value: boolean): void {
    this.neverFallbackWithoutAsking = value;
  }

  setReserve(connectionId: string, percent: number): void {
    const row = this.requireLive(connectionId);
    if (row.billingTypeBadge !== "Subscription") {
      throw new Error("Reserve applies to subscription connections");
    }
    if (!Number.isInteger(percent) || percent < 0 || percent > 100) {
      throw new Error("Reserve percent must be an integer from 0 to 100");
    }
    row.reservePercent = percent;
  }

  setSpendCaps(connectionId: string, softMicroUsd: number, hardMicroUsd: number): void {
    const row = this.requireLive(connectionId);
    if (row.billingTypeBadge !== "Pay-per-token") {
      throw new Error("Spend caps apply to pay-per-token keys");
    }
    if (!Number.isInteger(softMicroUsd) || !Number.isInteger(hardMicroUsd) || softMicroUsd < 0 || hardMicroUsd < softMicroUsd) {
      throw new Error("Hard cap must be an integer at least as large as the soft cap");
    }
    row.soft = softMicroUsd;
    row.hard = hardMicroUsd;
  }

  setFallbackRule(rule: ExplicitFallbackRule): void {
    if (!Number.isInteger(rule.capMicroUsd) || rule.capMicroUsd < 0) {
      throw new Error("Fallback cap must be a non-negative integer micro-USD amount");
    }
    this.rules = this.rules.filter(
      (item) => item.fromConnectionId !== rule.fromConnectionId || item.toConnectionId !== rule.toConnectionId,
    );
    this.rules.push(rule);
  }

  fallbackPolicy(): {
    readonly neverFallbackWithoutAsking: boolean;
    readonly explicitFallbackOrder: readonly ExplicitFallbackRule[];
  } {
    return {
      neverFallbackWithoutAsking: this.neverFallbackWithoutAsking,
      explicitFallbackOrder: this.rules.map((rule) => ({ ...rule })),
    };
  }

  assignRole(role: RoleId, connectionId: string | null): void {
    if (connectionId !== null) this.requireLive(connectionId);
    this.assignments[role] = connectionId;
  }

  pause(connectionId: string): void {
    const row = this.requireLive(connectionId);
    row.paused = true;
    row.statusBadge = "Paused";
  }

  refresh(connectionId: string): void {
    const row = this.requireLive(connectionId);
    if (row.statusBadge.toLowerCase().includes("revoked")) return;
    row.paused = false;
    row.statusBadge = "Healthy";
  }

  remove(connectionId: string): void {
    const row = this.requireLive(connectionId);
    row.removed = true;
    const remaining = this.live();
    this.activeConnectionId = remaining[0]?.id ?? null;
    for (const role of ROLES) {
      if (this.assignments[role.id] === connectionId) this.assignments[role.id] = null;
    }
    if (remaining.length === 0 && this.buildPaused) {
      this.banner = NO_CONNECTIONS_BANNER;
      this.resumeBlocked = true;
    }
  }

  setGeminiNoticeAccepted(accepted: boolean): void {
    this.geminiNoticeAccepted = accepted;
    if (!accepted) {
      this.geminiEnabled = false;
      this.geminiBlockReason = null;
    }
  }

  setGeminiEnabled(enabled: boolean): { readonly ok: boolean; readonly reason: string | null } {
    if (
      enabled &&
      (this.geminiCompliance === "disabled_by_policy" || this.geminiCompliance === "route_revoked")
    ) {
      this.geminiEnabled = false;
      this.geminiBlockReason = "Gemini CLI is disabled by signed provider policy.";
      return { ok: false, reason: this.geminiBlockReason };
    }
    if (enabled && !this.geminiNoticeAccepted) {
      this.geminiEnabled = false;
      this.geminiBlockReason = "Gemini CLI stays off until the policy notice is accepted.";
      return { ok: false, reason: this.geminiBlockReason };
    }
    this.geminiEnabled = enabled;
    this.geminiBlockReason = null;
    return { ok: true, reason: null };
  }

  async testConnection(connectionId: string): Promise<void> {
    const row = this.requireLive(connectionId);
    if (!this.probe) throw new Error("No connection probe is configured");
    const result = await this.probe.probe({ id: row.id, provider: row.provider, authMode: row.authMode });
    this.drawer = {
      connectionId: row.id,
      kind: probeKindFor(row.provider, row.authMode),
      latencyMs: result.latencyMs,
      discoveredModelCount: result.discoveredModelCount,
      diagnostic: result.diagnostic,
    };
    this.focusId = "drawer:diagnostic";
  }

  previewSwitch(candidateId: string, reason: string, spentMicroUsd = 0, incomingMicroUsd = 0): void {
    if (!this.guard) throw new Error("No fallback guard is configured");
    const activeId = this.activeConnectionId;
    if (!activeId) throw new Error("No active connection");
    this.requireLive(candidateId);
    const decision = this.guard.evaluate({
      activeId,
      candidateId,
      reason,
      neverFallbackWithoutAsking: this.neverFallbackWithoutAsking,
      explicitFallbackOrder: this.rules.map((rule) => ({ ...rule })),
      spentMicroUsd,
      incomingMicroUsd,
      userConsent: false,
      connections: this.guardConnections(),
    });
    if (decision.outcome === "block") {
      this.stopCard = {
        message: decision.message,
        costEstimate: decision.costEstimate,
        action: "Switch Connection",
        parked: true,
      };
      this.resumeBlocked = decision.parked;
      return;
    }
    this.stopCard = null;
    this.activeConnectionId = candidateId;
  }

  consentSwitch(candidateId: string, reason: string, spentMicroUsd = 0, incomingMicroUsd = 0): void {
    if (!this.guard) throw new Error("No fallback guard is configured");
    const activeId = this.activeConnectionId;
    if (!activeId) throw new Error("No active connection");
    const decision = this.guard.evaluate({
      activeId,
      candidateId,
      reason,
      neverFallbackWithoutAsking: this.neverFallbackWithoutAsking,
      explicitFallbackOrder: this.rules.map((rule) => ({ ...rule })),
      spentMicroUsd,
      incomingMicroUsd,
      userConsent: true,
      connections: this.guardConnections(),
    });
    if (decision.outcome === "block") {
      this.stopCard = {
        message: decision.message,
        costEstimate: decision.costEstimate,
        action: "Switch Connection",
        parked: true,
      };
      return;
    }
    this.stopCard = null;
    this.activeConnectionId = candidateId;
    this.resumeBlocked = false;
  }

  handleKey(input: KeyInput): void {
    if (input.key === "Enter" || input.key === " ") {
      this.activate(this.focusId);
      return;
    }
    this.focusId = moveFocus(this.focusOrder(), this.focusId, input);
  }

  snapshot(): ConnectionsViewModel {
    const live = this.live();
    const families = new Set(live.map((row) => row.family));
    const oracleId = this.assignments.oracleReview;
    const codingIds = [this.assignments.seniorCoding, this.assignments.juniorCoding].filter(
      (id): id is string => id !== null,
    );
    let oracleNote: string | null = null;
    if (oracleId && families.size >= 2) {
      const oracleFamily = live.find((row) => row.id === oracleId)?.family;
      const sameFamily = codingIds.some((id) => live.find((row) => row.id === id)?.family === oracleFamily);
      if (sameFamily) oracleNote = ORACLE_FAMILY_NOTE;
    }
    const dangling = ROLES.map((role) => this.assignments[role.id]).filter((id): id is string => {
      if (id === null) return false;
      return !live.some((row) => row.id === id);
    });
    const rows: HealthRowModel[] = live.map((row) => ({
      id: row.id,
      label: row.label,
      provider: row.provider,
      authMode: row.authMode,
      billingTypeBadge: row.billingTypeBadge,
      maskedKeyOrEmail: row.maskedKeyOrEmail,
      statusBadge: row.statusBadge,
      allowanceLabel: row.allowanceLabel,
      allowanceRatio: row.allowanceRatio,
      activeCwnd: row.activeCwnd,
      expiryWarning: expiryWarning(row, this.nowMs),
      conformanceStatus: row.conformanceStatus,
      reservePercent: row.reservePercent,
      softCap: row.soft === null ? null : formatMicroUsd(row.soft),
      hardCap: row.hard === null ? null : formatMicroUsd(row.hard),
      paused: row.paused,
      testFocusId: `row:${row.id}:test`,
      refreshFocusId: `row:${row.id}:refresh`,
      pauseFocusId: `row:${row.id}:pause`,
      removeFocusId: `row:${row.id}:remove`,
    }));
    return {
      routeId: "settings/connections",
      themeName: this.themeName,
      layout: layoutForWidth(this.width),
      cards: PRIMARY_CARDS.map((card) => ({ id: card.id, title: card.title, focusId: `card:${card.id}` })),
      geminiEnabled: this.geminiEnabled,
      geminiNoticeAccepted: this.geminiNoticeAccepted,
      geminiNotice: GEMINI_POLICY_NOTICE,
      geminiInvocation: GEMINI_CLI_INVOCATION,
      geminiCompliance: this.geminiCompliance,
      geminiBlockReason: this.geminiBlockReason,
      claudeCodeNotice: CLAUDE_CODE_NOTICE,
      rows,
      neverFallbackWithoutAsking: this.neverFallbackWithoutAsking,
      loudWarning: this.neverFallbackWithoutAsking ? null : LOUD_FALLBACK_WARNING,
      roles: ROLES.map((role) => {
        const connectionId = this.assignments[role.id];
        return {
          id: role.id,
          label: role.label,
          connectionId,
          connectionLabel: live.find((row) => row.id === connectionId)?.label ?? null,
          focusId: `role:${role.id}`,
        };
      }),
      oracleNote,
      banner: this.banner,
      resumeBlocked: this.resumeBlocked,
      activeConnectionId: this.activeConnectionId,
      danglingConnectionIds: dangling,
      detectedProvider: this.detectedProvider,
      maskedDraft: this.maskedDraft,
      holdingSecret: this.buffer.held() !== null,
      drawer: this.drawer,
      stopCard: this.stopCard,
      focusId: this.focusId,
      focusOrder: this.focusOrder(),
    };
  }

  private guardConnections(): GuardConnectionView[] {
    return this.live().map((row) => guardConnection(row));
  }

  private live(): LiveConnection[] {
    return this.rows.filter((row) => !row.removed);
  }

  private requireLive(id: string): LiveConnection {
    const row = this.rows.find((item) => item.id === id && !item.removed);
    if (!row) throw new Error(`Unknown connection ${id}`);
    return row;
  }

  private focusOrder(): string[] {
    const order = [
      ...PRIMARY_CARDS.map((card) => `card:${card.id}`),
      "key:field",
      "key:save",
      "gemini:notice",
      "gemini:enable",
      "card:claude-code",
      "policy:never-fallback",
    ];
    for (const row of this.live()) {
      order.push(`row:${row.id}:test`, `row:${row.id}:refresh`, `row:${row.id}:pause`, `row:${row.id}:remove`);
      if (row.billingTypeBadge === "Subscription") order.push(`row:${row.id}:reserve`);
      if (row.billingTypeBadge === "Pay-per-token") {
        order.push(`row:${row.id}:soft`, `row:${row.id}:hard`);
      }
    }
    for (const role of ROLES) order.push(`role:${role.id}`);
    if (this.drawer) order.push("drawer:diagnostic");
    if (this.stopCard) order.push("stop:consent");
    return order;
  }

  private activate(focusId: string): void {
    if (focusId === "policy:never-fallback") {
      this.neverFallbackWithoutAsking = !this.neverFallbackWithoutAsking;
      return;
    }
    if (focusId === "gemini:notice") {
      this.setGeminiNoticeAccepted(!this.geminiNoticeAccepted);
      return;
    }
    if (focusId === "gemini:enable") {
      this.setGeminiEnabled(!this.geminiEnabled);
      return;
    }
    const rowAction = /^row:([^:]+):([^:]+)$/.exec(focusId);
    const connectionId = rowAction?.[1];
    const action = rowAction?.[2];
    if (!connectionId || !action) return;
    if (action === "pause") this.pause(connectionId);
    if (action === "refresh") this.refresh(connectionId);
    if (action === "remove") this.remove(connectionId);
    if (action === "test" && this.probe) {
      void this.testConnection(connectionId);
    }
  }
}
