import { randomUUID } from "node:crypto";

import type { GlobalDeviceIdentityPort } from "./types.js";

export class InMemoryGlobalDeviceIdentityStore implements GlobalDeviceIdentityPort {
  private deviceId: string | null = null;
  private label: string | null = null;

  readDeviceId(): string | null {
    return this.deviceId;
  }

  persistDeviceId(deviceId: string): void {
    this.deviceId = deviceId;
  }

  readDeviceLabel(): string | null {
    return this.label;
  }

  persistDeviceLabel(label: string): void {
    this.label = label;
  }
}

export function ensureDeviceId(store: GlobalDeviceIdentityPort, friendlyLabel?: string): string {
  const existing = store.readDeviceId();
  if (existing) return existing;
  const created = randomUUID();
  store.persistDeviceId(created);
  if (friendlyLabel) store.persistDeviceLabel(friendlyLabel);
  return created;
}