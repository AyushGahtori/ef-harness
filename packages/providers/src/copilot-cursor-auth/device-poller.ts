import {
  DEVICE_CODE_GRANT_TYPE,
  DEVICE_FLOW_SLOW_DOWN_INCREMENT_MS,
  GITHUB_DEVICE_TOKEN_URL,
} from "./constants.js";
import {
  DeviceFlowCancelledError,
  DeviceFlowDeniedError,
  DeviceFlowExpiredError,
} from "./errors.js";
import type {
  AbortableSleep,
  Clock,
  DeviceCodeGrant,
  DevicePollResult,
  GitHubDeviceHttp,
  TimerRegistry,
} from "./types.js";

export interface Rfc8628DevicePollerDeps {
  readonly http: GitHubDeviceHttp;
  readonly sleep: AbortableSleep;
  readonly clock: Clock;
  readonly timers: TimerRegistry;
  readonly clientId: string;
}

/**
 * RFC 8628 device-code poller.
 * Waits the server `interval` before every poll, adds 5 seconds on `slow_down`,
 * and stops on `expired_token`, the grant deadline, or cancel.
 */
export class Rfc8628DevicePoller {
  constructor(private readonly deps: Rfc8628DevicePollerDeps) {}

  async poll(grant: DeviceCodeGrant, signal: AbortSignal): Promise<string> {
    let intervalMs = grant.intervalSec * 1000;
    const deadline = this.deps.clock.now() + grant.expiresInSec * 1000;
    const handle = this.deps.timers.set(() => undefined, grant.expiresInSec * 1000);
    try {
      while (true) {
        if (signal.aborted) throw new DeviceFlowCancelledError();
        if (this.deps.clock.now() >= deadline) throw new DeviceFlowExpiredError();
        await this.deps.sleep.sleep(intervalMs, signal);
        if (signal.aborted) throw new DeviceFlowCancelledError();
        if (this.deps.clock.now() >= deadline) throw new DeviceFlowExpiredError();
        const raw = await this.deps.http.post({
          url: GITHUB_DEVICE_TOKEN_URL,
          body: {
            client_id: this.deps.clientId,
            device_code: grant.deviceCode,
            grant_type: DEVICE_CODE_GRANT_TYPE,
          },
        });
        const result = parseDevicePollResponse(raw);
        if (result.status === "authorization_pending") continue;
        if (result.status === "slow_down") {
          intervalMs += DEVICE_FLOW_SLOW_DOWN_INCREMENT_MS;
          continue;
        }
        if (result.status === "expired_token") throw new DeviceFlowExpiredError();
        if (result.status === "access_denied") throw new DeviceFlowDeniedError(result.message);
        return result.accessToken;
      }
    } finally {
      this.deps.timers.clear(handle);
    }
  }
}

export function parseDeviceCodeResponse(body: unknown): DeviceCodeGrant {
  const record = asRecord(body, "GitHub device code response was not an object");
  const userCode = typeof record.user_code === "string" ? record.user_code.toUpperCase() : "";
  if (!/^[A-Z0-9]{8}$/.test(userCode)) {
    throw new Error("GitHub device user code must be 8 characters");
  }
  const deviceCode = typeof record.device_code === "string" ? record.device_code : "";
  if (deviceCode.length < 8) throw new Error("GitHub device code was missing");
  const expiresInSec = record.expires_in;
  const intervalSec = record.interval;
  if (!Number.isInteger(expiresInSec) || typeof expiresInSec !== "number" || expiresInSec <= 0) {
    throw new Error("GitHub device code expiry was missing");
  }
  if (!Number.isInteger(intervalSec) || typeof intervalSec !== "number" || intervalSec < 1) {
    throw new Error("GitHub device code interval must be at least 1 second");
  }
  return { deviceCode, userCode, expiresInSec, intervalSec };
}

export function parseDevicePollResponse(body: unknown): DevicePollResult {
  const record = asRecord(body, "GitHub device poll response was not an object");
  if (typeof record.access_token === "string" && record.access_token.length >= 12) {
    return { status: "success", accessToken: record.access_token };
  }
  const error = typeof record.error === "string" ? record.error : "";
  if (error === "authorization_pending") return { status: "authorization_pending" };
  if (error === "slow_down") return { status: "slow_down" };
  if (error === "expired_token") return { status: "expired_token" };
  if (error === "access_denied") {
    const description =
      typeof record.error_description === "string"
        ? record.error_description
        : "The GitHub sign-in was denied";
    return { status: "access_denied", message: description };
  }
  throw new Error("GitHub device poll response was not recognized");
}

function asRecord(body: unknown, message: string): Record<string, unknown> {
  if (!body || typeof body !== "object") throw new Error(message);
  return body as Record<string, unknown>;
}
