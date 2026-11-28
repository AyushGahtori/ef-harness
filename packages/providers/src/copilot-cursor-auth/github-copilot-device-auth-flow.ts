import { cliReuseLabel, COPY_AND_OPEN_BUTTON_LABEL, GITHUB_DEVICE_CODE_URL, GITHUB_DEVICE_VERIFICATION_URL } from "./constants.js";
import { Rfc8628DevicePoller, parseDeviceCodeResponse } from "./device-poller.js";
import {
  DeviceFlowCancelledError,
  NoCopilotEntitlementError,
  OrgPolicyBlockedError,
} from "./errors.js";
import { assertNoRawCredential, type RedactingAuditLog } from "./redact.js";
import type {
  AbortableSleep,
  CliAuthProbe,
  CliReuseOffer,
  Clock,
  CopilotSeatVerifier,
  GitHubDeviceHttp,
  GlobalConnectionRecord,
  GlobalDbConnectionsPort,
  TimerRegistry,
  UserAgentActions,
  WindowsDpapiSecretsVault,
} from "./types.js";
import { isVaultReference, maskedPreview } from "./types.js";

export interface GitHubCopilotDeviceAuthDeps {
  readonly clientId: string;
  readonly scope: string;
  readonly http: GitHubDeviceHttp;
  readonly sleep: AbortableSleep;
  readonly clock: Clock;
  readonly timers: TimerRegistry;
  readonly vault: WindowsDpapiSecretsVault;
  readonly connections: GlobalDbConnectionsPort;
  readonly seat: CopilotSeatVerifier;
  readonly cli: CliAuthProbe;
  readonly log: RedactingAuditLog;
  readonly agent: UserAgentActions;
}

export interface DeviceFlowPrompt {
  readonly userCode: string;
  readonly verificationUrl: typeof GITHUB_DEVICE_VERIFICATION_URL;
  readonly buttonLabel: typeof COPY_AND_OPEN_BUTTON_LABEL;
  activateCopyAndOpen(): { readonly copiedText: string; readonly openedUrl: string };
}

export interface DeviceFlowSession {
  readonly sessionId: string;
  readonly prompt: DeviceFlowPrompt;
  waitForAuthorization(): Promise<EstablishedCopilotConnection>;
}

export interface EstablishedCopilotConnection {
  readonly connection: GlobalConnectionRecord;
}

export class GitHubCopilotDeviceAuthFlow {
  private readonly poller: Rfc8628DevicePoller;
  private readonly sessions = new Map<string, AbortController>();
  private readonly pendingCliTokens = new Map<string, string>();
  private nextSession = 1;

  constructor(private readonly deps: GitHubCopilotDeviceAuthDeps) {
    this.poller = new Rfc8628DevicePoller({
      http: deps.http,
      sleep: deps.sleep,
      clock: deps.clock,
      timers: deps.timers,
      clientId: deps.clientId,
    });
  }

  async probeCliReuse(): Promise<readonly CliReuseOffer[]> {
    const snapshot = await this.deps.cli.probe();
    this.pendingCliTokens.clear();
    const offers: CliReuseOffer[] = [];
    for (const source of ["gh", "copilot"] as const) {
      const entry = snapshot[source];
      if (!entry.authenticated || !entry.login || !entry.token || !entry.version) continue;
      if (!/^[A-Za-z0-9-]{1,64}$/.test(entry.login)) continue;
      this.deps.log.seal(entry.token);
      this.pendingCliTokens.set(`${source}:${entry.login}`, entry.token);
      offers.push({
        source,
        login: entry.login,
        version: entry.version,
        label: cliReuseLabel(entry.login),
      });
    }
    this.deps.log.record("cli_reuse_probed", { offers: offers.length });
    assertNoRawCredential("cli reuse offers", JSON.stringify(offers), [...this.pendingCliTokens.values()]);
    return offers;
  }

  async acceptCliReuse(
    source: "gh" | "copilot",
    login: string,
  ): Promise<EstablishedCopilotConnection> {
    const key = `${source}:${login}`;
    const token = this.pendingCliTokens.get(key);
    if (!token) throw new Error("No signed-in CLI session is waiting for that account");
    this.pendingCliTokens.delete(key);
    return this.establish({
      token,
      deviceCode: null,
      authMode: "github_cli_reuse",
      signal: null,
    });
  }

  async beginDeviceFlow(): Promise<DeviceFlowSession> {
    const raw = await this.deps.http.post({
      url: GITHUB_DEVICE_CODE_URL,
      body: { client_id: this.deps.clientId, scope: this.deps.scope },
    });
    const grant = parseDeviceCodeResponse(raw);
    const sessionId = `device-${this.deps.clock.now()}-${this.nextSession}`;
    this.nextSession += 1;
    const controller = new AbortController();
    this.sessions.set(sessionId, controller);
    const prompt = this.createPrompt(grant.userCode);
    const completion = this.completeDeviceFlow(sessionId, grant, controller.signal);
    return {
      sessionId,
      prompt,
      waitForAuthorization: () => completion,
    };
  }

  cancel(sessionId: string): void {
    this.sessions.get(sessionId)?.abort();
  }

  cancelPendingDeviceFlows(): void {
    for (const controller of this.sessions.values()) controller.abort();
  }

  pendingDeviceFlowCount(): number {
    return this.sessions.size;
  }

  disconnect(connectionId: string): void {
    this.cancelPendingDeviceFlows();
    for (const token of this.pendingCliTokens.values()) this.deps.log.seal(token);
    this.pendingCliTokens.clear();
    const row = this.deps.connections.get(connectionId);
    if (row?.vaultRef) this.deps.vault.deleteSecret(row.vaultRef);
    if (row) this.deps.connections.delete(connectionId);
    this.deps.log.record("copilot_disconnected", { connectionId });
  }

  private async completeDeviceFlow(
    sessionId: string,
    grant: { deviceCode: string; userCode: string; expiresInSec: number; intervalSec: number },
    signal: AbortSignal,
  ): Promise<EstablishedCopilotConnection> {
    try {
      const token = await this.poller.poll(grant, signal);
      if (signal.aborted) throw new DeviceFlowCancelledError();
      return await this.establish({
        token,
        deviceCode: grant.deviceCode,
        authMode: "github_device_flow",
        signal,
      });
    } finally {
      this.sessions.delete(sessionId);
    }
  }

  private createPrompt(userCode: string): DeviceFlowPrompt {
    return {
      userCode,
      verificationUrl: GITHUB_DEVICE_VERIFICATION_URL,
      buttonLabel: COPY_AND_OPEN_BUTTON_LABEL,
      activateCopyAndOpen: () => {
        this.deps.agent.copy(userCode);
        this.deps.agent.openExternal(GITHUB_DEVICE_VERIFICATION_URL, "os_browser");
        return { copiedText: userCode, openedUrl: GITHUB_DEVICE_VERIFICATION_URL };
      },
    };
  }

  private async establish(input: {
    readonly token: string;
    readonly deviceCode: string | null;
    readonly authMode: "github_device_flow" | "github_cli_reuse";
    readonly signal: AbortSignal | null;
  }): Promise<EstablishedCopilotConnection> {
    if (input.signal?.aborted) throw new DeviceFlowCancelledError();
    const seat = await this.deps.seat.verifySeat(input.token);
    if (input.signal?.aborted) throw new DeviceFlowCancelledError();
    if (!seat.ok) {
      if (seat.code === "no_copilot_entitlement") throw new NoCopilotEntitlementError(seat.message);
      throw new OrgPolicyBlockedError(seat.message);
    }
    if (!/^[A-Za-z0-9-]{1,64}$/.test(seat.login)) {
      throw new Error("GitHub login was not usable");
    }
    if (input.signal?.aborted) throw new DeviceFlowCancelledError();
    const connectionId = this.allocateId(seat.login);
    const now = this.deps.clock.now();
    const secretId = `vault:gitHubToken:${connectionId}:${now}`;
    if (!isVaultReference(secretId)) throw new Error("Vault reference was rejected");
    const secrets = input.deviceCode ? [input.token, input.deviceCode] : [input.token];
    for (const secret of secrets) this.deps.log.seal(secret);
    const written = this.deps.vault.writeSecret({
      secretId,
      name: "gitHubToken",
      plaintext: input.token,
      providerHint: "github_copilot",
    });
    const record: GlobalConnectionRecord = {
      id: connectionId,
      provider: "github_copilot",
      route: "copilot_sdk",
      plan: seat.plan,
      vaultRef: written.secretId,
      currency: seat.billingMode === "byok_api_key" ? "usd" : `allowance:${connectionId}`,
      scale: 1,
      enabled: 1,
      createdAt: now,
      metadata: {
        kind: "copilot",
        authMode: input.authMode,
        billingMode: seat.billingMode,
        accountLogin: seat.login,
        allowedModels: [...seat.allowedModels],
        orgPolicyMessage: seat.orgPolicyMessage,
        maskedPreview: maskedPreview(written.lastFourMasked),
        verifiedAt: now,
        status: "active",
        overageApprovedForReset: null,
      },
    };
    try {
      assertNoRawCredential("connection record", JSON.stringify(record), secrets);
      this.deps.connections.upsert(record);
      this.deps.log.record("copilot_connected", {
        connectionId,
        login: seat.login,
        authMode: input.authMode,
        billingMode: seat.billingMode,
      });
      assertNoRawCredential("global.db", this.deps.connections.exportSnapshot(), secrets);
      assertNoRawCredential("logs", this.deps.log.text(), secrets);
      assertNoRawCredential("dpapi at rest", this.deps.vault.exportAtRest(), secrets);
    } catch (error) {
      this.deps.vault.deleteSecret(written.secretId);
      this.deps.connections.delete(connectionId);
      throw error;
    }
    const stored = this.deps.connections.get(connectionId);
    if (!stored) throw new Error("Copilot connection was not stored");
    return { connection: stored };
  }

  private allocateId(login: string): string {
    const base = `copilot-${login}`;
    if (!this.deps.connections.get(base)) return base;
    let suffix = 2;
    while (this.deps.connections.get(`${base}-${suffix}`)) suffix += 1;
    return `${base}-${suffix}`;
  }
}
