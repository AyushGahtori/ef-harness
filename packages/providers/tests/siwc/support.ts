import { mkdtempSync, rmSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  LocalSignedProviderPolicyEngine,
  SignInWithChatGptAuthFlow,
  SqliteSiwcInstallationStore,
  type SiwcSecretsVault,
  type SystemBrowserOpener,
} from "../../src/siwc/index.js";
import { MockOidcServer } from "./mock-oidc.js";

export class MemoryVault implements SiwcSecretsVault {
  readonly entries = new Map<string, string>();

  async put(name: string, value: string): Promise<void> {
    this.entries.set(name, value);
  }

  async get(name: string): Promise<string | null> {
    return this.entries.get(name) ?? null;
  }

  async delete(name: string): Promise<void> {
    this.entries.delete(name);
  }
}

export class RedirectBrowser implements SystemBrowserOpener {
  readonly urls: string[] = [];

  async openExternal(url: string): Promise<void> {
    this.urls.push(url);
    const authorize = await fetch(url, { redirect: "manual" });
    const location = authorize.headers.get("location");
    if (!location) throw new Error("authorize response did not redirect");
    const callback = await fetch(location);
    if (!callback.ok) throw new Error(`callback status ${callback.status}`);
  }
}

export class IdleBrowser implements SystemBrowserOpener {
  readonly urls: string[] = [];
  readonly started: Promise<void>;
  private resolveStarted: () => void = () => undefined;

  constructor() {
    this.started = new Promise((resolve) => {
      this.resolveStarted = resolve;
    });
  }

  async openExternal(url: string): Promise<void> {
    this.urls.push(url);
    this.resolveStarted();
  }
}

export interface SiwcHarness {
  readonly dir: string;
  readonly dbPath: string;
  readonly server: MockOidcServer;
  readonly store: SqliteSiwcInstallationStore;
  readonly vault: MemoryVault;
  readonly browser: RedirectBrowser;
  readonly flow: SignInWithChatGptAuthFlow;
  readonly policy: LocalSignedProviderPolicyEngine;
  close(): Promise<void>;
}

export async function openHarness(options: {
  readonly callbackTtlMs?: number;
  readonly routeRevoked?: boolean;
  readonly revocationEndpoint?: string;
  readonly browser?: SystemBrowserOpener;
} = {}): Promise<SiwcHarness> {
  const dir = mkdtempSync(path.join(tmpdir(), "efh-siwc-"));
  const dbPath = path.join(dir, "global.db");
  const server = new MockOidcServer();
  await server.start();
  const store = new SqliteSiwcInstallationStore(dbPath);
  const vault = new MemoryVault();
  const browser = options.browser ?? new RedirectBrowser();
  const policy = new LocalSignedProviderPolicyEngine({
    ...server.endpoints(),
    ...(options.routeRevoked ? { routeRevoked: true } : {}),
    ...(options.revocationEndpoint !== undefined ? { revocationEndpoint: options.revocationEndpoint } : {}),
  });
  const flow = new SignInWithChatGptAuthFlow({
    store,
    vault,
    policy,
    browser,
    ...(options.callbackTtlMs !== undefined ? { callbackTtlMs: options.callbackTtlMs } : {}),
    sleep: async () => undefined,
  });
  return {
    dir,
    dbPath,
    server,
    store,
    vault,
    browser: browser instanceof RedirectBrowser ? browser : new RedirectBrowser(),
    flow,
    policy,
    async close() {
      store.close();
      await server.stop();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export function authorizeParams(url: string): URLSearchParams {
  return new URL(url).searchParams;
}

export function expectPortClosed(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: "127.0.0.1", port });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`timed out checking port ${port}`));
    }, 500);
    socket.once("error", () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once("connect", () => {
      clearTimeout(timer);
      socket.destroy();
      reject(new Error(`port ${port} is still open`));
    });
  });
}

export async function waitFor(predicate: () => boolean, label: string): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > 1_000) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
