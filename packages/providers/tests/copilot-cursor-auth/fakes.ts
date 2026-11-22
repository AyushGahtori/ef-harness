import { CursorAuthCancelledError, DeviceFlowCancelledError } from "../../src/copilot-cursor-auth/errors.js";
import {
  GITHUB_DEVICE_CODE_URL,
  GITHUB_DEVICE_TOKEN_URL,
} from "../../src/copilot-cursor-auth/constants.js";
import type {
  AbortableSleep,
  AccountCardNotice,
  AccountCardSink,
  CliAuthProbe,
  CommandResult,
  CommandRunner,
  CopilotAccountClient,
  CopilotCheckpointStopCard,
  CopilotPacingFeed,
  CopilotPacingSignal,
  CopilotQuota,
  CopilotSeatVerifier,
  CursorAuthLoginPort,
  CursorDispatchParker,
  CursorModelProbe,
  CursorUsageProbe,
  ExpiryReminderCard,
  GitHubDeviceHttp,
  NoSilentPaidFallbackPort,
  ReminderCardSink,
  SeatDecision,
  UserAgentActions,
} from "../../src/copilot-cursor-auth/types.js";
import { ManualClock } from "../../src/copilot-cursor-auth/local-ports.js";

export const COPILOT_TOKEN = "fixture-copilot-user-token-alpha";
export const COPILOT_TOKEN_OTHER = "fixture-copilot-user-token-bravo";
export const CURSOR_KEY = "fixture-cursor-user-key-bravo";
export const CURSOR_KEY_NEXT = "fixture-cursor-user-key-charlie";
export const DEVICE_CODE = "device-fixture-code-alpha";

export function flush(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

interface Waiter {
  ms: number;
  settled: boolean;
  resolve: () => void;
  reject: (error: Error) => void;
  signal: AbortSignal;
  onAbort: () => void;
}

export class ControllableSleep implements AbortableSleep {
  readonly delays: number[] = [];
  private readonly waiters: Waiter[] = [];

  sleep(ms: number, signal: AbortSignal): Promise<void> {
    this.delays.push(ms);
    if (signal.aborted) return Promise.reject(new DeviceFlowCancelledError());
    return new Promise((resolve, reject) => {
      const waiter: Waiter = {
        ms,
        settled: false,
        resolve,
        reject,
        signal,
        onAbort: () => undefined,
      };
      const onAbort = (): void => {
        if (waiter.settled) return;
        waiter.settled = true;
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) this.waiters.splice(index, 1);
        reject(new DeviceFlowCancelledError());
      };
      waiter.onAbort = onAbort;
      signal.addEventListener("abort", onAbort, { once: true });
      this.waiters.push(waiter);
    });
  }

  get pendingCount(): number {
    return this.waiters.length;
  }

  pendingDelay(): number {
    const waiter = this.waiters[0];
    if (!waiter) throw new Error("No device poll is waiting");
    return waiter.ms;
  }

  releaseNext(clock: ManualClock): void {
    const waiter = this.waiters.shift();
    if (!waiter || waiter.settled) throw new Error("No device poll is waiting");
    waiter.settled = true;
    waiter.signal.removeEventListener("abort", waiter.onAbort);
    clock.advance(waiter.ms);
    waiter.resolve();
  }
}

export async function releasePoll(sleep: ControllableSleep, clock: ManualClock): Promise<number> {
  const ms = sleep.pendingDelay();
  sleep.releaseNext(clock);
  await flush();
  await flush();
  return ms;
}

export function deviceCodeBody(userCode = "ABCD2345", expiresIn = 900, interval = 5): Record<string, unknown> {
  return {
    device_code: DEVICE_CODE,
    user_code: userCode,
    expires_in: expiresIn,
    interval,
  };
}

export class ScriptedGitHub implements GitHubDeviceHttp {
  readonly posts: { url: string; body: Record<string, string> }[] = [];
  deviceResponses: unknown[] = [];
  pollResponses: unknown[] = [];

  async post(input: {
    url: string;
    body: Readonly<Record<string, string>>;
  }): Promise<unknown> {
    this.posts.push({ url: input.url, body: { ...input.body } });
    if (input.url === GITHUB_DEVICE_CODE_URL) {
      const next = this.deviceResponses.shift();
      if (!next) throw new Error("no device response");
      return next;
    }
    if (input.url === GITHUB_DEVICE_TOKEN_URL) {
      const next = this.pollResponses.shift();
      if (!next) throw new Error("no poll response");
      return next;
    }
    throw new Error(`unexpected url ${input.url}`);
  }

  tokenPosts(): number {
    return this.posts.filter((post) => post.url === GITHUB_DEVICE_TOKEN_URL).length;
  }
}

export class ScriptedSeat implements CopilotSeatVerifier {
  decision: SeatDecision;
  readonly seen: string[] = [];
  gate: Promise<void> | null = null;

  constructor(decision: SeatDecision) {
    this.decision = decision;
  }

  async verifySeat(accessToken: string): Promise<SeatDecision> {
    this.seen.push(accessToken);
    if (this.gate) await this.gate;
    return this.decision;
  }
}

export function subscribedSeat(
  login: string,
  allowedModels: readonly string[] = ["included-fast", "standard-chat", "premium-reasoner"],
  orgPolicyMessage: string | null = null,
): SeatDecision {
  return {
    ok: true,
    login,
    plan: "individual",
    allowedModels,
    billingMode: "copilot_subscription",
    orgPolicyMessage,
  };
}

export class RecordingAgent implements UserAgentActions {
  readonly copied: string[] = [];
  readonly opens: { url: string; channel: "os_browser" }[] = [];

  copy(text: string): void {
    this.copied.push(text);
  }

  openExternal(url: string, channel: "os_browser"): void {
    this.opens.push({ url, channel });
  }
}

export class ScriptedRunner implements CommandRunner {
  readonly calls: string[][] = [];
  readonly scripts = new Map<string, CommandResult>();

  async run(argv: readonly string[]): Promise<CommandResult> {
    this.calls.push([...argv]);
    return (
      this.scripts.get(argv.join(" ")) ?? {
        exitCode: 127,
        stdout: "",
        stderr: "not found",
      }
    );
  }
}

export class AbsentCli implements CliAuthProbe {
  async probe() {
    return {
      gh: { installed: false, version: null, authenticated: false, login: null, token: null },
      copilot: { installed: false, version: null, authenticated: false, login: null, token: null },
    };
  }
}

export class ScriptedQuota implements CopilotAccountClient {
  calls = 0;
  lastToken = "";
  constructor(public quota: CopilotQuota) {}

  async accountGetQuota(accessToken: string): Promise<CopilotQuota> {
    this.calls += 1;
    this.lastToken = accessToken;
    return this.quota;
  }
}

export class RecordingPacing implements CopilotPacingFeed {
  readonly events: CopilotPacingSignal[] = [];
  onQuota(signal: CopilotPacingSignal): void {
    this.events.push(signal);
  }
}

export class RecordingCheckpoints {
  readonly cards: CopilotCheckpointStopCard[] = [];
  open(card: CopilotCheckpointStopCard): void {
    this.cards.push(card);
  }
}

export class ScriptedCursor implements CursorAuthLoginPort {
  readonly opened: string[] = [];
  keys: string[] = [];
  usage: CursorUsageProbe = { ok: true, chargedCents: 0 };
  models: CursorModelProbe = { ok: true, models: ["composer"] };
  private pending: ((key: string) => void) | null = null;
  hang = false;

  login(request: { signal: AbortSignal; openBrowser: (url: string) => void }): Promise<{
    userApiKey: string;
  }> {
    const url = "https://authenticator.cursor.sh/fixture-login";
    this.opened.push(url);
    request.openBrowser(url);
    if (this.hang) {
      return new Promise((resolve, reject) => {
        const onAbort = (): void => reject(new CursorAuthCancelledError());
        if (request.signal.aborted) {
          onAbort();
          return;
        }
        request.signal.addEventListener("abort", onAbort, { once: true });
        this.pending = (key) => {
          request.signal.removeEventListener("abort", onAbort);
          resolve({ userApiKey: key });
        };
      });
    }
    const key = this.keys.shift();
    if (!key) throw new Error("no cursor key scripted");
    return Promise.resolve({ userApiKey: key });
  }

  finishHang(key: string): void {
    this.pending?.(key);
  }

  getUsage(): Promise<CursorUsageProbe> {
    return Promise.resolve(this.usage);
  }

  probeModels(): Promise<CursorModelProbe> {
    return Promise.resolve(this.models);
  }
}

export class RecordingReminders implements ReminderCardSink {
  readonly cards: ExpiryReminderCard[] = [];
  emit(card: ExpiryReminderCard): void {
    this.cards.push(card);
  }
}

export class RecordingAccounts implements AccountCardSink {
  readonly cards: AccountCardNotice[] = [];
  emit(card: AccountCardNotice): void {
    this.cards.push(card);
  }
}

export class RecordingParker implements CursorDispatchParker {
  readonly events: { connectionId: string; reason: "expired" | "unauthorized" }[] = [];
  park(event: { connectionId: string; reason: "expired" | "unauthorized" }): void {
    this.events.push(event);
  }
}

export class RecordingFallback implements NoSilentPaidFallbackPort {
  readonly events: { connectionId: string; from: "cursor_subscription"; to: "paid_api_key" }[] = [];
  refuseSilentPaidFallback(event: {
    connectionId: string;
    from: "cursor_subscription";
    to: "paid_api_key";
  }): void {
    this.events.push(event);
  }
}
