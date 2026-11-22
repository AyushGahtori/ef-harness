import { existsSync } from "node:fs";
import { copyFile, mkdir, open, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { upsertCatalogComponent, type CatalogComponent } from "./catalog.js";
import {
  assertComponentDownloadHeadroom,
  nodeDiskHeadroomGuard,
  type DiskHeadroomGuardPort,
} from "./disk-headroom.js";
import {
  ArchiveIntegrityError,
  ChecksumMismatchError,
  DownloadCancelledError,
  DownloadHttpStatusError,
  DownloadInterruptedError,
  DownloadPausedError,
  DownloadTimeoutError,
  HttpDowngradeError,
  InsufficientDiskHeadroomError,
  InvalidManifestSignatureError,
  ManifestParseError,
  MissingComponentDigestError,
  StrictTlsDisabledError,
  UnknownComponentError,
  UnpinnedLatestUrlError,
  UnsignedComponentError,
  UnsafeArchivePathError,
  errorCode,
} from "./errors.js";
import { hashFile, hashesEqual } from "./hash.js";
import {
  assertComponentPin,
  verifyAndReadManifest,
  type ComponentManifest,
  type ComponentManifestEntry,
} from "./manifest.js";
import { assertSafeComponentId, safeChildPath } from "./paths.js";
import {
  BUNDLED_COMPONENT_MANIFEST_KEY_ID,
  bundledComponentManifestPublicKey,
} from "./pinned-key.js";
import { atomicDirectorySwap, ensureEmptyDir, recoverInterruptedInstall } from "./staging-swap.js";
import { assertDownloadUrlAllowed, assertStrictTlsEnabled } from "./tls-policy.js";
import { extractZip } from "./zip-archive.js";

export const MAX_CHECKSUM_RETRIES = 2;

export interface DownloadProgress {
  readonly componentId: string;
  readonly receivedBytes: number;
  readonly totalBytes: number;
  readonly fraction: number;
  readonly state: "running" | "paused" | "cancelled" | "verifying" | "complete";
}

export interface DownloadOptions {
  onProgress?: (progress: DownloadProgress) => void;
}

export interface ComponentRequestInit {
  headers?: Record<string, string>;
  signal?: AbortSignal;
  redirect?: "error" | "follow" | "manual";
}

export type ComponentFetch = (url: string, init?: ComponentRequestInit) => Promise<Response>;

export interface InstalledComponent {
  readonly componentId: string;
  readonly version: string;
  readonly label: string;
  readonly directory: string;
  readonly sha256: string;
  readonly verified: true;
}

export interface SignedComponentDownloaderOptions {
  componentsRoot: string;
  manifestUrl: string;
  publicKey?: Uint8Array;
  expectedKeyId?: string;
  headroom?: DiskHeadroomGuardPort;
  requestTimeoutMs?: number;
  fetchImpl?: ComponentFetch;
  env?: NodeJS.ProcessEnv;
  maxChecksumRetries?: number;
}

type Intent = "run" | "pause" | "cancel";

export function assertComponentExecutableAllowed(component: { readonly verified: boolean }): void {
  if (component.verified !== true) {
    throw new UnsignedComponentError("Refusing to run an unverified component binary");
  }
}

export function defaultComponentsDirectory(
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): string {
  const localAppData = env.LOCALAPPDATA;
  const local = localAppData !== undefined && localAppData.length > 0
    ? localAppData
    : path.join(home, "AppData", "Local");
  return path.join(local, "EFHarness", "components");
}

function fraction(received: number, total: number): number {
  if (total <= 0) return 1;
  return received / total;
}

function isFatalTransferError(error: unknown): boolean {
  return (
    error instanceof ChecksumMismatchError ||
    error instanceof DownloadPausedError ||
    error instanceof DownloadCancelledError ||
    error instanceof HttpDowngradeError ||
    error instanceof StrictTlsDisabledError ||
    error instanceof InvalidManifestSignatureError ||
    error instanceof UnpinnedLatestUrlError ||
    error instanceof MissingComponentDigestError ||
    error instanceof InsufficientDiskHeadroomError ||
    error instanceof UnsignedComponentError ||
    error instanceof UnsafeArchivePathError ||
    error instanceof ManifestParseError ||
    error instanceof ArchiveIntegrityError ||
    error instanceof UnknownComponentError
  );
}

export class SignedComponentDownloader {
  private readonly componentsRoot: string;
  private readonly manifestUrl: string;
  private readonly publicKey: Uint8Array;
  private readonly expectedKeyId: string;
  private readonly headroom: DiskHeadroomGuardPort;
  private readonly requestTimeoutMs: number;
  private readonly fetchImpl: ComponentFetch;
  private readonly env: NodeJS.ProcessEnv;
  private readonly maxChecksumRetries: number;
  private readonly aborters = new Map<string, AbortController>();
  private readonly intent = new Map<string, Intent>();

  constructor(options: SignedComponentDownloaderOptions) {
    this.componentsRoot = options.componentsRoot;
    this.manifestUrl = options.manifestUrl;
    this.publicKey = options.publicKey ?? bundledComponentManifestPublicKey();
    this.expectedKeyId = options.expectedKeyId ?? BUNDLED_COMPONENT_MANIFEST_KEY_ID;
    this.headroom = options.headroom ?? nodeDiskHeadroomGuard;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 15_000;
    this.fetchImpl = options.fetchImpl ?? ((url, init) => fetch(url, init));
    this.env = options.env ?? process.env;
    this.maxChecksumRetries = options.maxChecksumRetries ?? MAX_CHECKSUM_RETRIES;
  }

  pause(componentId: string): void {
    this.intent.set(componentId, "pause");
    this.aborters.get(componentId)?.abort();
  }

  cancel(componentId: string): void {
    this.intent.set(componentId, "cancel");
    this.aborters.get(componentId)?.abort();
  }

  async resume(componentId: string, options?: DownloadOptions): Promise<InstalledComponent> {
    this.intent.set(componentId, "run");
    return this.download(componentId, options);
  }

  async loadManifest(): Promise<ComponentManifest> {
    assertStrictTlsEnabled(this.env);
    assertDownloadUrlAllowed(this.manifestUrl, this.manifestUrl);
    const timeout = AbortSignal.timeout(this.requestTimeoutMs);
    const response = await this.fetchResponse(this.manifestUrl, this.manifestUrl, {
      redirect: "manual",
      signal: timeout,
    });
    if (!response.ok) {
      throw new DownloadHttpStatusError(response.status, this.manifestUrl);
    }
    return verifyAndReadManifest(await response.text(), this.publicKey, this.expectedKeyId);
  }

  async download(componentId: string, options?: DownloadOptions): Promise<InstalledComponent> {
    assertStrictTlsEnabled(this.env);
    assertSafeComponentId(componentId);
    this.intent.set(componentId, "run");
    const manifest = await this.loadManifest();
    const entry = manifest.components.find((component) => component.id === componentId);
    if (entry === undefined) throw new UnknownComponentError(componentId);
    assertComponentPin(entry);
    await mkdir(this.componentsRoot, { recursive: true });
    await assertComponentDownloadHeadroom(this.headroom, this.componentsRoot, entry.sizeBytes);
    recoverInterruptedInstall(this.liveDir(entry.id));
    await this.fetchPayload(entry, options?.onProgress);
    return this.installPayload(entry, options?.onProgress);
  }

  private async fetchPayload(
    entry: ComponentManifestEntry,
    onProgress: DownloadOptions["onProgress"],
  ): Promise<void> {
    const urls = [entry.primaryUrl, ...entry.mirrorUrls];
    let lastError: Error | undefined;
    for (const url of urls) {
      assertDownloadUrlAllowed(url, entry.primaryUrl);
      try {
        await this.fetchWithChecksumRetries(entry, url, onProgress);
        return;
      } catch (error) {
        if (isFatalTransferError(error)) throw error;
        lastError = error instanceof Error ? error : new DownloadInterruptedError(entry.id);
      }
    }
    throw lastError ?? new DownloadInterruptedError(entry.id);
  }

  private async fetchWithChecksumRetries(
    entry: ComponentManifestEntry,
    url: string,
    onProgress: DownloadOptions["onProgress"],
  ): Promise<void> {
    for (let retry = 0; retry <= this.maxChecksumRetries; retry += 1) {
      await this.preparePartial(entry);
      if (await this.partMatches(entry)) return;
      await this.transferBody(entry, url, onProgress);
      if (await this.partMatches(entry)) return;
      await rm(this.partPath(entry.id), { force: true });
      if (retry === this.maxChecksumRetries) throw new ChecksumMismatchError(entry.id);
    }
  }

  private async preparePartial(entry: ComponentManifestEntry): Promise<void> {
    const part = this.partPath(entry.id);
    if (!existsSync(part)) return;
    const hashed = await hashFile(part);
    const completeAndWrong = hashed.bytes === entry.sizeBytes && !hashesEqual(hashed.sha256, entry.sha256);
    if (hashed.bytes > entry.sizeBytes || completeAndWrong) {
      await rm(part, { force: true });
    }
  }

  private async partMatches(entry: ComponentManifestEntry): Promise<boolean> {
    const part = this.partPath(entry.id);
    if (!existsSync(part)) return false;
    const hashed = await hashFile(part);
    return hashed.bytes === entry.sizeBytes && hashesEqual(hashed.sha256, entry.sha256);
  }

  private async transferBody(
    entry: ComponentManifestEntry,
    url: string,
    onProgress: DownloadOptions["onProgress"],
  ): Promise<void> {
    const part = this.partPath(entry.id);
    await mkdir(path.dirname(part), { recursive: true });
    const existing = existsSync(part) ? (await hashFile(part)).bytes : 0;
    const pending = this.intent.get(entry.id);
    if (pending === "cancel") throw new DownloadCancelledError(entry.id);
    if (pending === "pause") throw new DownloadPausedError(entry.id);
    this.intent.set(entry.id, "run");
    const userAbort = new AbortController();
    this.aborters.set(entry.id, userAbort);
    const timeout = AbortSignal.timeout(this.requestTimeoutMs);
    const signal = AbortSignal.any([timeout, userAbort.signal]);
    const init: ComponentRequestInit = { redirect: "manual", signal };
    if (existing > 0) init.headers = { Range: `bytes=${existing}-` };
    try {
      const response = await this.fetchResponse(url, entry.primaryUrl, init);
      if (response.status !== 200 && response.status !== 206) {
        throw new DownloadHttpStatusError(response.status, url);
      }
      const append = response.status === 206 && existing > 0;
      await this.writeBody(entry, response, append, existing, onProgress, timeout);
    } catch (error) {
      const classified = this.classify(entry.id, error, timeout);
      if (classified instanceof DownloadCancelledError) {
        await rm(part, { force: true });
        this.emit(onProgress, entry, 0, "cancelled");
      }
      if (classified instanceof DownloadPausedError) {
        const received = existsSync(part) ? (await hashFile(part)).bytes : existing;
        this.emit(onProgress, entry, received, "paused");
      }
      throw classified;
    } finally {
      this.aborters.delete(entry.id);
    }
  }

  private async writeBody(
    entry: ComponentManifestEntry,
    response: Response,
    append: boolean,
    already: number,
    onProgress: DownloadOptions["onProgress"],
    timeout: AbortSignal,
  ): Promise<void> {
    const body = response.body;
    if (body === null) throw new DownloadInterruptedError(entry.id);
    const part = this.partPath(entry.id);
    const handle = await open(part, append ? "a" : "w");
    let received = append ? already : 0;
    try {
      const reader = body.getReader();
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        const chunk = Buffer.from(next.value);
        const written = await handle.write(chunk);
        if (written.bytesWritten !== chunk.length) {
          throw new DownloadInterruptedError(entry.id);
        }
        received += chunk.length;
        this.emit(onProgress, entry, received, "running");
      }
    } catch (error) {
      throw this.classify(entry.id, error, timeout);
    } finally {
      await handle.close();
    }
  }

  private classify(componentId: string, error: unknown, timeout: AbortSignal): Error {
    if (this.intent.get(componentId) === "cancel") return new DownloadCancelledError(componentId);
    if (this.intent.get(componentId) === "pause") return new DownloadPausedError(componentId);
    if (timeout.aborted) return new DownloadTimeoutError(componentId);
    if (error instanceof DownloadHttpStatusError) return error;
    if (error instanceof HttpDowngradeError) return error;
    if (error instanceof StrictTlsDisabledError) return error;
    if (error instanceof DownloadInterruptedError) return error;
    if (errorCode(error) === "ABORT_ERR" || (error instanceof Error && error.name === "AbortError")) {
      return new DownloadInterruptedError(componentId);
    }
    if (error instanceof Error) return new DownloadInterruptedError(componentId);
    return new DownloadInterruptedError(componentId);
  }

  private emit(
    onProgress: DownloadOptions["onProgress"],
    entry: ComponentManifestEntry,
    receivedBytes: number,
    state: DownloadProgress["state"],
  ): void {
    onProgress?.({
      componentId: entry.id,
      receivedBytes,
      totalBytes: entry.sizeBytes,
      fraction: fraction(receivedBytes, entry.sizeBytes),
      state,
    });
  }

  private async fetchResponse(
    url: string,
    primaryUrl: string,
    init: ComponentRequestInit,
  ): Promise<Response> {
    assertDownloadUrlAllowed(url, primaryUrl);
    const response = await this.fetchImpl(url, init);
    if (response.status < 300 || response.status >= 400) return response;
    const location = response.headers.get("location");
    await cancelBody(response);
    if (location === null || location.length === 0) {
      throw new HttpDowngradeError("redirect missing location");
    }
    const next = new URL(location, url).toString();
    assertDownloadUrlAllowed(next, primaryUrl);
    const followed = await this.fetchImpl(next, { ...init, redirect: "manual" });
    if (followed.status >= 300 && followed.status < 400) {
      await cancelBody(followed);
      throw new HttpDowngradeError(next);
    }
    return followed;
  }

  private async installPayload(
    entry: ComponentManifestEntry,
    onProgress: DownloadOptions["onProgress"],
  ): Promise<InstalledComponent> {
    this.emit(onProgress, entry, entry.sizeBytes, "verifying");
    const staging = this.stagingDir(entry.id);
    const live = this.liveDir(entry.id);
    let swapped = false;
    try {
      ensureEmptyDir(staging);
      if (!(await this.partMatches(entry))) throw new ChecksumMismatchError(entry.id);
      if (entry.packaging === "file") {
        await this.installSingleFile(entry, staging);
      } else {
        await extractZip(this.partPath(entry.id), staging, entry.files);
      }
      const metadata = {
        id: entry.id,
        label: entry.label,
        version: entry.version,
        sha256: entry.sha256,
        sizeBytes: entry.sizeBytes,
      };
      await writeFile(path.join(staging, "component.json"), JSON.stringify(metadata), "utf8");
      await writeFile(
        path.join(staging, "files.json"),
        JSON.stringify({ id: entry.id, label: entry.label, files: entry.files }),
        "utf8",
      );
      atomicDirectorySwap(staging, live);
      swapped = true;
      await rm(this.partPath(entry.id), { force: true });
      const catalogEntry: CatalogComponent = {
        id: entry.id,
        label: entry.label,
        version: entry.version,
        sha256: entry.sha256,
        sizeBytes: entry.sizeBytes,
        files: entry.files.map((file) => ({
          path: file.path,
          sha256: file.sha256,
          sizeBytes: file.sizeBytes,
        })),
      };
      upsertCatalogComponent(this.componentsRoot, catalogEntry);
    } catch (error) {
      if (error instanceof ChecksumMismatchError || error instanceof ArchiveIntegrityError) {
        await rm(this.partPath(entry.id), { force: true });
      }
      throw error;
    } finally {
      if (!swapped) await rm(staging, { recursive: true, force: true });
    }
    const installed: InstalledComponent = {
      componentId: entry.id,
      version: entry.version,
      label: entry.label,
      directory: live,
      sha256: entry.sha256,
      verified: true,
    };
    assertComponentExecutableAllowed(installed);
    this.emit(onProgress, entry, entry.sizeBytes, "complete");
    return installed;
  }

  private async installSingleFile(entry: ComponentManifestEntry, staging: string): Promise<void> {
    const file = entry.files[0];
    if (file === undefined) throw new ChecksumMismatchError(entry.id);
    const dest = safeChildPath(staging, file.path);
    await mkdir(path.dirname(dest), { recursive: true });
    await copyFile(this.partPath(entry.id), dest);
    const hashed = await hashFile(dest);
    if (hashed.bytes !== file.sizeBytes || !hashesEqual(hashed.sha256, file.sha256)) {
      throw new ChecksumMismatchError(entry.id);
    }
  }

  private liveDir(componentId: string): string {
    return path.join(this.componentsRoot, componentId);
  }

  private stagingDir(componentId: string): string {
    return path.join(this.componentsRoot, "_incoming", `${componentId}.staging`);
  }

  private partPath(componentId: string): string {
    return path.join(this.componentsRoot, "_incoming", `${componentId}.part`);
  }
}

async function cancelBody(response: Response): Promise<void> {
  const body = response.body;
  if (body === null) return;
  try {
    await body.cancel();
  } catch (error) {
    void error;
  }
}
