import {
  HostKeyConfirmationRequiredError,
  HostKeyMismatchError,
} from "./errors.js";
import type { KnownHostsPort, SshTransportPort } from "./contracts.js";

export function assertPinnedHost(
  store: KnownHostsPort,
  transport: SshTransportPort,
): void {
  const pinned = store.lookup(transport.host);
  if (pinned === null) {
    throw new HostKeyConfirmationRequiredError(transport.host, transport.fingerprint);
  }
  if (pinned !== transport.fingerprint) {
    throw new HostKeyMismatchError(transport.host);
  }
}

export class InMemoryKnownHostsStore implements KnownHostsPort {
  private readonly entries = new Map<string, string>();

  lookup(host: string): string | null {
    return this.entries.get(host) ?? null;
  }

  pin(host: string, fingerprint: string): void {
    this.entries.set(host, fingerprint);
  }
}