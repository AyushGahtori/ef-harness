export class RehydrationError extends Error {
  constructor(
    readonly code:
      | "schema_unsupported"
      | "schema_too_new"
      | "graph_hash_mismatch"
      | "yaml_invalid"
      | "history_invalid"
      | "sqlite_rebuild_failed"
      | "sealed_decrypt_failed",
    message: string,
  ) {
    super(message);
    this.name = "RehydrationError";
  }
}

export class ZipImportError extends Error {
  constructor(
    readonly code: "zip_slip" | "symlink" | "manifest_mismatch" | "oversize" | "secret_leak",
    message: string,
  ) {
    super(message);
    this.name = "ZipImportError";
  }
}

export class ForcePushForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ForcePushForbiddenError";
  }
}

export class LeaseTakeoverRaceError extends Error {
  constructor(
    readonly expectedRemoteSha: string,
    readonly actualRemoteSha: string,
  ) {
    super(
      `Non-fast-forward lease takeover rejected (expected ${expectedRemoteSha}, remote now ${actualRemoteSha})`,
    );
    this.name = "LeaseTakeoverRaceError";
  }
}