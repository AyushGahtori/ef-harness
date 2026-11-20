import { JSON_RPC_MAX_BYTES } from "./constants.js";

/** Where an oversized Channel 0 body should go instead. */
export interface ArtifactSpillHint {
  readonly method: "artifact.open";
  readonly byteLength: number;
  readonly capBytes: number;
  readonly reason: string;
}

/** Channel 0 JSON exceeded 1 MB. Callers should open an artifact stream instead. */
export class PayloadExceedsJsonCapError extends Error {
  readonly code = "PAYLOAD_EXCEEDS_JSON_CAP" as const;
  readonly byteLength: number;
  readonly capBytes: number;
  readonly redirect = "artifact.open" as const;

  constructor(byteLength: number, capBytes = JSON_RPC_MAX_BYTES) {
    super(
      `JSON-RPC payload is ${String(byteLength)} bytes and exceeds the ${String(capBytes)} byte Channel 0 cap; use artifact.open`,
    );
    this.name = "PayloadExceedsJsonCapError";
    this.byteLength = byteLength;
    this.capBytes = capBytes;
  }

  get spill(): ArtifactSpillHint {
    return spillHint(this.byteLength, this.capBytes);
  }
}

/** The artifact is outside the authenticated project, or it does not exist. */
export class ArtifactNotFoundError extends Error {
  readonly code = "ARTIFACT_NOT_FOUND" as const;
  readonly artifactId: string;

  constructor(artifactId: string) {
    super(`Artifact ${artifactId} does not exist.`);
    this.name = "ArtifactNotFoundError";
    this.artifactId = artifactId;
  }
}

/** `stream.credit` was negative, non-integer, above 256, or would exceed 512 outstanding. */
export class InvalidCreditError extends Error {
  readonly code = "INVALID_CREDIT" as const;
  readonly chunks: unknown;
  readonly outstanding: number;

  constructor(chunks: unknown, outstanding = 0, message?: string) {
    super(
      message ??
        "stream credit grant must be an integer from 1 to 256 and must not raise outstanding credits above 512",
    );
    this.name = "InvalidCreditError";
    this.chunks = chunks;
    this.outstanding = outstanding;
  }
}

/**
 * SHA-256 of an evidence or asset blob did not match.
 * Accepts either `(hash, reason)` or the CAS detail object so callers can catch by `name`.
 */
export class CasIntegrityMismatchError extends Error {
  readonly code = "CAS_INTEGRITY_MISMATCH" as const;
  readonly hash: string;
  readonly actualHash: string;
  readonly retention: string | null;
  readonly reason: string;

  constructor(
    hashOrDetails:
      | string
      | {
          readonly hash: string;
          readonly actualHash?: string;
          readonly retention?: string | null;
          readonly reason?: string;
        },
    reason = "SHA-256 mismatch",
  ) {
    const details =
      typeof hashOrDetails === "string"
        ? { hash: hashOrDetails, actualHash: "", retention: null as string | null, reason }
        : {
            hash: hashOrDetails.hash,
            actualHash: hashOrDetails.actualHash ?? "",
            retention: hashOrDetails.retention ?? null,
            reason: hashOrDetails.reason ?? reason,
          };
    super(`CAS integrity mismatch for ${details.hash}`);
    this.name = "CasIntegrityMismatchError";
    this.hash = details.hash;
    this.actualHash = details.actualHash;
    this.retention = details.retention;
    this.reason = details.reason;
  }
}

/** Referenced CAS bytes are not available. The pipe stays open for other RPCs. */
export class CasBlobMissingError extends Error {
  readonly code = "CAS_BLOB_MISSING" as const;
  readonly hash: string;

  constructor(hash: string) {
    super(`CAS blob missing: ${hash}`);
    this.name = "CasBlobMissingError";
    this.hash = hash;
  }
}

export class InvalidStreamRequestError extends Error {
  readonly code = "INVALID_REQUEST" as const;

  constructor(message: string) {
    super(message);
    this.name = "InvalidStreamRequestError";
  }
}

export class StreamIdleTimeoutError extends Error {
  readonly code = "STREAM_IDLE_TIMEOUT" as const;
  readonly streamId: number;
  readonly idleTimeoutMs: number;

  constructor(streamId: number, idleTimeoutMs: number) {
    super(`stream ${String(streamId)} waited ${String(idleTimeoutMs)}ms for credits`);
    this.name = "StreamIdleTimeoutError";
    this.streamId = streamId;
    this.idleTimeoutMs = idleTimeoutMs;
  }
}

export class StreamFrameTooLargeError extends Error {
  readonly code = "STREAM_FRAME_TOO_LARGE" as const;
  readonly byteLength: number;
  readonly capBytes: number;

  constructor(byteLength: number, capBytes: number) {
    super(`frame payload is ${String(byteLength)} bytes and exceeds ${String(capBytes)}`);
    this.name = "StreamFrameTooLargeError";
    this.byteLength = byteLength;
    this.capBytes = capBytes;
  }
}

/** Terminal `stream.error` raised on the client. */
export class StreamRemoteError extends Error {
  readonly streamId: number;
  readonly streamCode: string;

  constructor(streamId: number, streamCode: string, message: string) {
    super(message);
    this.name = "StreamRemoteError";
    this.streamId = streamId;
    this.streamCode = streamCode;
  }
}

export class InvalidByteRangeError extends Error {
  readonly code = "INVALID_BYTE_RANGE" as const;

  constructor(message: string) {
    super(message);
    this.name = "InvalidByteRangeError";
  }
}

export class ChunkCeilingError extends Error {
  readonly code = "CHUNK_CEILING" as const;
  readonly byteLength: number;

  constructor(byteLength: number) {
    super(`Channel 1 chunk is ${String(byteLength)} bytes; the ceiling is 65536`);
    this.name = "ChunkCeilingError";
    this.byteLength = byteLength;
  }
}

export function isCasBlobMissingError(error: unknown): boolean {
  return error instanceof CasBlobMissingError || namedError(error, "CasBlobMissingError");
}

export function isCasIntegrityMismatchError(error: unknown): boolean {
  return error instanceof CasIntegrityMismatchError || namedError(error, "CasIntegrityMismatchError");
}

export function isPayloadExceedsJsonCapError(error: unknown): boolean {
  return error instanceof PayloadExceedsJsonCapError || namedError(error, "PayloadExceedsJsonCapError");
}

/**
 * Direct an oversized Channel 0 body to `artifact.open`.
 * Payloads that already fit the cap are not redirected.
 */
export function spillToArtifactOpen(byteLength: number): ArtifactSpillHint {
  if (!Number.isSafeInteger(byteLength) || byteLength < 0) {
    throw new PayloadExceedsJsonCapError(0);
  }
  if (byteLength <= JSON_RPC_MAX_BYTES) {
    throw new Error("payload fits in a Channel 0 JSON-RPC frame");
  }
  return spillHint(byteLength, JSON_RPC_MAX_BYTES);
}

function spillHint(byteLength: number, capBytes: number): ArtifactSpillHint {
  return {
    method: "artifact.open",
    byteLength,
    capBytes,
    reason:
      "Channel 0 JSON-RPC payloads are capped at 1 MB; open the bytes with artifact.open and stream them on Channel 1.",
  };
}

function namedError(error: unknown, name: string): boolean {
  return error instanceof Error && error.name === name;
}
