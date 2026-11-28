import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
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
}

interface ConnectionRow {
  id: string;
  provider: string;
  route: string;
  plan: string | null;
  vault_ref: string | null;
  currency: string;
  scale: number;
  enabled: number;
  created_at: number;
}

const DDL = `
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT, WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS connections (
  id         TEXT PRIMARY KEY,
  provider   TEXT NOT NULL,
  route      TEXT NOT NULL,
  plan       TEXT,
  vault_ref  TEXT,
  currency   TEXT NOT NULL,
  scale      INTEGER NOT NULL,
  enabled    INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
  created_at INTEGER NOT NULL
) STRICT;
`;

/**
 * Local port of Task 014 `GlobalDbRepo` for `meta` and `connections`.
 * `connections` in schema/global.sql has no status column, so status is stored in `meta`
 * and mirrored onto the record the rest of this package reads. Tokens are never written here.
 */
export class SqliteSiwcInstallationStore {
  private readonly db: DatabaseSync;
  private closed = false;

  constructor(filePath: string) {
    mkdirSync(path.dirname(filePath), { recursive: true });
    this.db = new DatabaseSync(filePath);
    this.db.exec(DDL);
  }

  ensureHostId(): string {
    const existing = this.readHostId();
    if (existing) return existing;
    const hostId = `urn:uuid:${randomUUID()}`;
    this.db.prepare("INSERT INTO meta(key, value) VALUES (?, ?)").run(HOST_ID_META_KEY, hostId);
    return hostId;
  }

  readHostId(): string | null {
    const row = this.db.prepare("SELECT value FROM meta WHERE key = ?").get(HOST_ID_META_KEY);
    return textColumn(row, "value");
  }

  get(id: string): SiwcConnectionRecord | null {
    const row = this.db.prepare("SELECT * FROM connections WHERE id = ?").get(id);
    if (!isConnectionRow(row)) return null;
    const profile = this.readProfile(id);
    const hostId = this.readHostId();
    if (!profile || !hostId) return null;
    return {
      id: row.id,
      label: profile.label,
      provider: "openai",
      route: "siwc",
      plan: row.plan,
      vaultRef: row.vault_ref,
      currency: row.currency,
      scale: row.scale,
      enabled: row.enabled === 1,
      createdAt: row.created_at,
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
    };
    const vaultRef = siwcTokenSecretName(input.id);
    this.db.prepare(
      `INSERT INTO connections(id, provider, route, plan, vault_ref, currency, scale, enabled, created_at)
       VALUES (?, 'openai', 'siwc', ?, ?, ?, 1, 1, ?)
       ON CONFLICT(id) DO UPDATE SET
         plan = excluded.plan,
         vault_ref = excluded.vault_ref,
         currency = excluded.currency,
         enabled = 1`,
    ).run(input.id, input.plan, vaultRef, `allowance:${input.id}`, createdAt);
    this.writeProfile(input.id, profile);
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
    this.writeProfile(id, profile);
    this.db.prepare("UPDATE connections SET enabled = 1, vault_ref = ? WHERE id = ?").run(siwcTokenSecretName(id), id);
  }

  markNeedsSignIn(id: string): void {
    const profile = this.requireProfile(id);
    profile.status = "needs_sign_in";
    profile.expiresAtMs = null;
    profile.expiryNotified = true;
    this.writeProfile(id, profile);
    this.db.prepare("UPDATE connections SET enabled = 0, vault_ref = NULL WHERE id = ?").run(id);
  }

  markDisconnected(id: string): void {
    const profile = this.requireProfile(id);
    profile.status = "disconnected";
    profile.expiresAtMs = null;
    this.writeProfile(id, profile);
    this.db.prepare("UPDATE connections SET enabled = 0, vault_ref = NULL WHERE id = ?").run(id);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.db.close();
  }

  private requireProfile(id: string): Profile {
    const profile = this.readProfile(id);
    if (!profile) throw new Error(`missing Sign in with ChatGPT profile for ${id}`);
    return profile;
  }

  private readProfile(id: string): Profile | null {
    const row = this.db.prepare("SELECT value FROM meta WHERE key = ?").get(siwcProfileKey(id));
    const raw = textColumn(row, "value");
    if (!raw) return null;
    return parseProfile(raw);
  }

  private writeProfile(id: string, profile: Profile): void {
    this.db.prepare(
      `INSERT INTO meta(key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run(siwcProfileKey(id), JSON.stringify(profile));
  }
}

function textColumn(row: unknown, key: string): string | null {
  if (typeof row !== "object" || row === null || !(key in row)) return null;
  const value = (row as Record<string, unknown>)[key];
  return typeof value === "string" ? value : null;
}

function isConnectionRow(row: unknown): row is ConnectionRow {
  if (typeof row !== "object" || row === null) return false;
  const record = row as Record<string, unknown>;
  return typeof record["id"] === "string"
    && typeof record["provider"] === "string"
    && typeof record["route"] === "string"
    && (record["plan"] === null || typeof record["plan"] === "string")
    && (record["vault_ref"] === null || typeof record["vault_ref"] === "string")
    && typeof record["currency"] === "string"
    && typeof record["scale"] === "number"
    && typeof record["enabled"] === "number"
    && typeof record["created_at"] === "number";
}

function parseProfile(raw: string): Profile {
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  return {
    label: typeof parsed["label"] === "string" ? parsed["label"] : "",
    status: parseStatus(parsed["status"]),
    clientId: typeof parsed["clientId"] === "string" ? parsed["clientId"] : null,
    subject: typeof parsed["subject"] === "string" ? parsed["subject"] : null,
    email: typeof parsed["email"] === "string" ? parsed["email"] : null,
    scopes: Array.isArray(parsed["scopes"]) ? parsed["scopes"].filter((item) => typeof item === "string") : [],
    expiresAtMs: typeof parsed["expiresAtMs"] === "number" ? parsed["expiresAtMs"] : null,
    earliestRefreshAtMs: typeof parsed["earliestRefreshAtMs"] === "number" ? parsed["earliestRefreshAtMs"] : null,
    plan: typeof parsed["plan"] === "string" ? parsed["plan"] : null,
    expiryNotified: parsed["expiryNotified"] === true,
    createdAt: typeof parsed["createdAt"] === "number" ? parsed["createdAt"] : 0,
  };
}

function parseStatus(value: unknown): SiwcConnectionStatus {
  if (value === "connected" || value === "disconnected" || value === "needs_sign_in") return value;
  return "needs_sign_in";
}
