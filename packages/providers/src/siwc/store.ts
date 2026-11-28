import { randomUUID } from "node:crypto";
import path from "node:path";
import { GlobalBrokerDb } from "@ef-harness/db";
import { HOST_ID_META_KEY, SIWC_PREVIEW_LABEL } from "./constants.js";
import { siwcProfileKey, siwcTokenSecretName } from "./ids.js";
import type { SiwcConnectionStatus } from "./ports.js";

export interface SiwcConnectionRecord {
  readonly id: string;
  readonly label: string;
  readonly provider: "openai";
  readonly route: "siwc";
  readonly plan: string | null;
  readonly vaultRef: string | null;
  readonly currency: string;
  readonly scale: number;
  readonly enabled: boolean;
  readonly createdAt: number;
  readonly status: SiwcConnectionStatus;
  readonly clientId: string | null;
  readonly subject: string | null;
  readonly email: string | null;
  readonly scopes: readonly string[];
  readonly previewLabel: string;
  readonly extAgentHostId: string;
  readonly expiresAtMs: number | null;
  readonly earliestRefreshAtMs: number | null;
  readonly expiryNotified: boolean;
}

export interface SiwcConnectedWrite {
  readonly id: string;
  readonly label: string;
  readonly plan: string | null;
  readonly clientId: string;
  readonly subject: string;
  readonly email: string | null;
  readonly scopes: readonly string[];
  readonly expiresAtMs: number;
  readonly earliestRefreshAtMs: number | null;
  readonly createdAt?: number;
}

interface Profile {
  label: string;
  status: SiwcConnectionStatus;
  clientId: string | null;
  subject: string | null;
  email: string | null;
  scopes: string[];
  expiresAtMs: number | null;
  earliestRefreshAtMs: number | null;
  plan: string | null;
  expiryNotified: boolean;
  createdAt: number;
  profileKey: string;
}

/**
 * Sign in with ChatGPT rows on Task 014 `GlobalBrokerDb`.
 * Profile fields live in `connection_profiles`. Tokens are never written here.
 */
export class SqliteSiwcInstallationStore {
  private readonly global: GlobalBrokerDb;
  private readonly owned: boolean;
  private closed = false;

  constructor(filePath: string, shared?: GlobalBrokerDb) {
    if (shared) {
      this.global = shared;
      this.owned = false;
    } else {
      const root = filePath.endsWith(`${path.sep}global.db`) || filePath.endsWith("/global.db")
        ? path.dirname(filePath)
        : filePath;
      this.global = GlobalBrokerDb.open({ root });
      this.owned = true;
    }
  }

  ensureHostId(): string {
    const existing = this.readHostId();
    if (existing) return existing;
    const hostId = `urn:uuid:${randomUUID()}`;
    this.global.writer.run(
      "INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      [HOST_ID_META_KEY, hostId],
    );
    return hostId;
  }

  readHostId(): string | null {
    const row = asRow(this.global.writer.get("SELECT value FROM meta WHERE key = ?", [HOST_ID_META_KEY]));
    return typeof row?.value === "string" ? row.value : null;
  }

  get(id: string): SiwcConnectionRecord | null {
    const row = this.global.getConnection(id);
    if (!row || row.route !== "siwc") return null;
    const profile = this.readProfile(id);
    const hostId = this.readHostId();
    if (!profile || !hostId) return null;
    return {
      id: row.id,
      label: profile.label,
      provider: "openai",
      route: "siwc",
      plan: row.plan,
      vaultRef: row.vaultRef,
      currency: row.currency,
      scale: row.scale,
      enabled: row.enabled,
      createdAt: row.createdAt,
      status: profile.status,
      clientId: profile.clientId,
      subject: profile.subject,
      email: profile.email,
      scopes: profile.scopes,
      previewLabel: SIWC_PREVIEW_LABEL,
      extAgentHostId: hostId,
      expiresAtMs: profile.expiresAtMs,
      earliestRefreshAtMs: profile.earliestRefreshAtMs,
      expiryNotified: profile.expiryNotified,
    };
  }

  saveConnected(input: SiwcConnectedWrite, nowMs: number): void {
    const existing = this.get(input.id);
    const createdAt = existing?.createdAt ?? input.createdAt ?? nowMs;
    const profile: Profile = {
      label: input.label,
      status: "connected",
      clientId: input.clientId,
      subject: input.subject,
      email: input.email,
      scopes: [...input.scopes],
      expiresAtMs: input.expiresAtMs,
      earliestRefreshAtMs: input.earliestRefreshAtMs,
      plan: input.plan,
      expiryNotified: false,
      createdAt,
      profileKey: siwcProfileKey(input.id),
    };
    this.global.transaction(() => {
      this.global.upsertConnection({
        id: input.id,
        provider: "openai",
        route: "siwc",
        plan: input.plan,
        vaultRef: siwcTokenSecretName(input.id),
        currency: `allowance:${input.id}`,
        scale: 1,
        enabled: true,
        createdAt,
      });
      this.writeProfile(input.id, profile, nowMs);
    });
  }

  updateExpiry(
    id: string,
    expiresAtMs: number,
    earliestRefreshAtMs: number | null,
    scopes: readonly string[] | null,
  ): void {
    const profile = this.requireProfile(id);
    profile.expiresAtMs = expiresAtMs;
    profile.earliestRefreshAtMs = earliestRefreshAtMs;
    if (scopes) profile.scopes = [...scopes];
    profile.status = "connected";
    profile.expiryNotified = false;
    const current = this.global.getConnection(id);
    if (!current) throw new Error(`missing Sign in with ChatGPT profile for ${id}`);
    this.global.transaction(() => {
      this.writeProfile(id, profile, expiresAtMs);
      this.global.upsertConnection({
        id,
        provider: "openai",
        route: "siwc",
        plan: current.plan,
        vaultRef: siwcTokenSecretName(id),
        currency: current.currency,
        scale: current.scale,
        enabled: true,
        createdAt: current.createdAt,
      });
    });
  }

  markNeedsSignIn(id: string): void {
    this.mark(id, "needs_sign_in", true);
  }

  markDisconnected(id: string): void {
    this.mark(id, "disconnected", false);
  }

  close(): void {
    if (this.closed || !this.owned) return;
    this.closed = true;
    this.global.close();
  }

  private mark(id: string, status: SiwcConnectionStatus, expiryNotified: boolean): void {
    const profile = this.requireProfile(id);
    profile.status = status;
    profile.expiresAtMs = null;
    if (expiryNotified) profile.expiryNotified = true;
    const current = this.global.getConnection(id);
    if (!current) throw new Error(`missing Sign in with ChatGPT profile for ${id}`);
    this.global.transaction(() => {
      this.writeProfile(id, profile, Date.now());
      this.global.upsertConnection({
        id,
        provider: "openai",
        route: "siwc",
        plan: current.plan,
        vaultRef: null,
        currency: current.currency,
        scale: current.scale,
        enabled: false,
        createdAt: current.createdAt,
      });
    });
  }

  private requireProfile(id: string): Profile {
    const profile = this.readProfile(id);
    if (!profile) throw new Error(`missing Sign in with ChatGPT profile for ${id}`);
    return profile;
  }

  private readProfile(id: string): Profile | null {
    const row = asRow(
      this.global.writer.get(
        "SELECT profile_json FROM connection_profiles WHERE connection_id = ? AND kind = 'siwc'",
        [id],
      ),
    );
    if (typeof row?.profile_json !== "string") return null;
    return parseProfile(row.profile_json);
  }

  private writeProfile(id: string, profile: Profile, updatedAt: number): void {
    this.global.writer.run(
      `INSERT INTO connection_profiles(connection_id, kind, profile_json, updated_at)
       VALUES (?, 'siwc', ?, ?)
       ON CONFLICT(connection_id) DO UPDATE SET
         kind = excluded.kind,
         profile_json = excluded.profile_json,
         updated_at = excluded.updated_at`,
      [id, JSON.stringify(profile), updatedAt],
    );
  }
}

function asRow(value: unknown): Record<string, unknown> | undefined {
  if (value === undefined || value === null || typeof value !== "object") return undefined;
  return value as Record<string, unknown>;
}

function parseProfile(raw: string): Profile {
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  return {
    label: typeof parsed.label === "string" ? parsed.label : "",
    status: parseStatus(parsed.status),
    clientId: typeof parsed.clientId === "string" ? parsed.clientId : null,
    subject: typeof parsed.subject === "string" ? parsed.subject : null,
    email: typeof parsed.email === "string" ? parsed.email : null,
    scopes: Array.isArray(parsed.scopes) ? parsed.scopes.filter((item) => typeof item === "string") : [],
    expiresAtMs: typeof parsed.expiresAtMs === "number" ? parsed.expiresAtMs : null,
    earliestRefreshAtMs: typeof parsed.earliestRefreshAtMs === "number" ? parsed.earliestRefreshAtMs : null,
    plan: typeof parsed.plan === "string" ? parsed.plan : null,
    expiryNotified: parsed.expiryNotified === true,
    createdAt: typeof parsed.createdAt === "number" ? parsed.createdAt : 0,
    profileKey: typeof parsed.profileKey === "string" ? parsed.profileKey : "",
  };
}

function parseStatus(value: unknown): SiwcConnectionStatus {
  if (value === "connected" || value === "disconnected" || value === "needs_sign_in") return value;
  return "needs_sign_in";
}
