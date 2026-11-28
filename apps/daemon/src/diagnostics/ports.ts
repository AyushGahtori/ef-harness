import type {
  ConformanceRow,
  HardwareSample,
  LearnedFootprint,
  PressurePoint,
  ProviderHealth,
  StorageHygiene,
} from "./types.js";

/**
 * Local stand-in for Task 011 `SecretRedactor` / `PacketSecurityRedactor`.
 * Integration swaps this port for the shared-contracts redactor.
 */
export interface PacketSecurityRedactorPort {
  registerCanary(secret: string): void;
  redact(text: string): string;
}

/**
 * Local stand-in for Task 014 `TelemetryDbRepo`.
 * The sqlite adapter in this package is the concrete reader.
 */
export interface TelemetryDbRepoPort {
  readonly path: string;
}

/**
 * Local stand-in for Task 029 `SeekableZstdLogReader`.
 */
export interface SeekableZstdLogReaderPort {
  readLastLines(limit: number): readonly string[];
}

/**
 * Local stand-in for Task 117 `WindowsResourceTelemetryCollector` ring buffer.
 */
export interface HardwareRingBufferPort {
  readSince(sinceMs: number): readonly HardwareSample[];
}

/**
 * Local stand-in for Task 118 `PressureHysteresisStateMachine`.
 */
export interface PressureHistoryPort {
  current(): PressurePoint | null;
  history(sinceMs: number): readonly PressurePoint[];
}

/**
 * Local stand-in for Task 118 `LearnedFootprintStore`.
 */
export interface LearnedFootprintPort {
  list(): readonly LearnedFootprint[];
}

/**
 * Local stand-in for Task 016 backup verification timestamp.
 */
export interface BackupStatusPort {
  lastVerifiedAt(): number | null;
}

/**
 * Local stand-in for Task 028 pin-safe cache GC.
 */
export interface PinSafeCacheGcPort {
  runSafeCacheCleanup(): {
    readonly reclaimedBytes: number;
    readonly pinnedKept: number;
  };
}

export interface ProviderHealthPort {
  current(): readonly ProviderHealth[];
}

export interface ConformancePort {
  current(): readonly ConformanceRow[];
}

export interface StorageHygienePort {
  current(): StorageHygiene | null;
}

export interface NamedPipeProbePort {
  roundTripMs(): number | null | Promise<number | null>;
}

export interface MinGitProbePort {
  version(): string | null | Promise<string | null>;
}

export interface DpapiProbePort {
  unlock(): { readonly ok: boolean; readonly detail: string } | Promise<{ readonly ok: boolean; readonly detail: string }>;
}

export interface DiskHeadroomProbePort {
  freeBytes(): { readonly drive: string; readonly freeBytes: number } | Promise<{ readonly drive: string; readonly freeBytes: number }>;
}

export interface PortLeaseProbePort {
  leases():
    | readonly { readonly port: number; readonly owner: string; readonly stuck: boolean }[]
    | Promise<readonly { readonly port: number; readonly owner: string; readonly stuck: boolean }[]>;
}

export interface ClipboardPort {
  writeText(value: string): void;
}
