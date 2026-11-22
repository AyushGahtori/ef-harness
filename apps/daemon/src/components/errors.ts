export class ComponentDownloaderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidManifestSignatureError extends ComponentDownloaderError {
  readonly code = "invalid_manifest_signature" as const;

  constructor(message = "Ed25519 manifest signature verification failed") {
    super(message);
  }
}

export class ManifestParseError extends ComponentDownloaderError {
  readonly code = "manifest_parse" as const;

  constructor(message: string) {
    super(message);
  }
}

export class UnpinnedLatestUrlError extends ComponentDownloaderError {
  readonly code = "unpinned_latest_url" as const;

  constructor(message: string) {
    super(message);
  }
}

export class MissingComponentDigestError extends ComponentDownloaderError {
  readonly code = "missing_component_digest" as const;

  constructor(componentId: string) {
    super(`Refusing to fetch ${componentId} without a manifest SHA-256 digest`);
  }
}

export class HttpDowngradeError extends ComponentDownloaderError {
  readonly code = "http_downgrade" as const;

  constructor(message: string) {
    super(message);
  }
}

export class StrictTlsDisabledError extends ComponentDownloaderError {
  readonly code = "strict_tls_disabled" as const;

  constructor() {
    super("Refusing component downloads while NODE_TLS_REJECT_UNAUTHORIZED=0");
  }
}

export class InsufficientDiskHeadroomError extends ComponentDownloaderError {
  readonly code = "insufficient_disk_headroom" as const;
  readonly freeBytes: bigint;
  readonly componentSizeBytes: bigint;
  readonly remainingBytes: bigint;

  constructor(freeBytes: bigint, componentSizeBytes: bigint) {
    const remainingBytes = freeBytes - 2n * componentSizeBytes;
    super(
      `Refusing download: freeBytes (${freeBytes}) - 2 * componentSize (${componentSizeBytes}) = ${remainingBytes} bytes, which is below the 5 GB reserve`,
    );
    this.freeBytes = freeBytes;
    this.componentSizeBytes = componentSizeBytes;
    this.remainingBytes = remainingBytes;
  }
}

export class ChecksumMismatchError extends ComponentDownloaderError {
  readonly code = "checksum_mismatch" as const;

  constructor(componentId: string) {
    super(`SHA-256 mismatch for ${componentId}; staged bytes were deleted and will not be unpacked`);
  }
}

export class DownloadInterruptedError extends ComponentDownloaderError {
  readonly code: string;

  constructor(componentId: string, code = "download_interrupted") {
    super(`Download interrupted for ${componentId}; partial bytes were kept for resume`);
    this.code = code;
  }
}

export class DownloadTimeoutError extends DownloadInterruptedError {
  constructor(componentId: string) {
    super(componentId, "download_timeout");
  }
}

export class DownloadPausedError extends ComponentDownloaderError {
  readonly code = "download_paused" as const;

  constructor(componentId: string) {
    super(`Download paused for ${componentId}`);
  }
}

export class DownloadCancelledError extends ComponentDownloaderError {
  readonly code = "download_cancelled" as const;

  constructor(componentId: string) {
    super(`Download cancelled for ${componentId}`);
  }
}

export class DownloadHttpStatusError extends ComponentDownloaderError {
  readonly code = "download_http_status" as const;
  readonly status: number;

  constructor(status: number, url: string) {
    super(`Unexpected HTTP ${status} for ${url}`);
    this.status = status;
  }
}

export class UnknownComponentError extends ComponentDownloaderError {
  readonly code = "unknown_component" as const;

  constructor(componentId: string) {
    super(`Unknown component ${componentId}`);
  }
}

export class UnsafeComponentIdError extends ComponentDownloaderError {
  readonly code = "unsafe_component_id" as const;

  constructor(componentId: string) {
    super(`Unsafe component id ${componentId}`);
  }
}

export class UnsafeArchivePathError extends ComponentDownloaderError {
  readonly code = "unsafe_archive_path" as const;

  constructor(relativePath: string) {
    super(`Unsafe component path ${relativePath}`);
  }
}

export class ArchiveIntegrityError extends ComponentDownloaderError {
  readonly code = "archive_integrity" as const;

  constructor(message: string) {
    super(message);
  }
}

export class UnsignedComponentError extends ComponentDownloaderError {
  readonly code = "unsigned_component" as const;

  constructor(message = "Refusing to run an unverified component binary") {
    super(message);
  }
}

export class ComponentLeaseActiveError extends ComponentDownloaderError {
  readonly code = "component_lease_active" as const;
  readonly componentId: string;
  readonly holderTaskId: string;

  constructor(componentId: string, holderTaskId: string) {
    super(`Cannot remove ${componentId} while task ${holderTaskId} holds its lease`);
    this.componentId = componentId;
    this.holderTaskId = holderTaskId;
  }
}

export function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}
