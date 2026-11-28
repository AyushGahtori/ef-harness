import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { GlobalBrokerDb } from "@ef-harness/db";
import type { GlobalSettingsStore } from "./ports.js";

/**
 * Task 014 settings row. Gemini stays off until this store records consent.
 */
export class BrokerGlobalSettingsStore implements GlobalSettingsStore {
  constructor(private readonly db: GlobalBrokerDb) {}

  static open(root?: string): BrokerGlobalSettingsStore {
    const directory = root ?? fs.mkdtempSync(path.join(os.tmpdir(), "ef-gemini-settings-"));
    return new BrokerGlobalSettingsStore(GlobalBrokerDb.open({ root: directory }));
  }

  get(key: string): string | null {
    const value = this.db.getSetting(key);
    if (value === undefined) return null;
    return JSON.stringify(value);
  }

  set(key: string, value: string): void {
    const parsed: unknown = JSON.parse(value);
    this.db.setSetting(key, parsed);
  }

  close(): void {
    this.db.close();
  }
}
