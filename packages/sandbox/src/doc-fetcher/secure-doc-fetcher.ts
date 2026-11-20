import { lookup } from "node:dns/promises";
import { pathToFileURL } from "node:url";
import {
  type CasBlobStore,
  MemoryCasBlobStore,
  MemoryResearchCacheStore,
  type ResearchCacheEntry,
  type ResearchCacheStore,
  researchHolderId,
} from "./cache.js";
import { DocFetchError, DownloadTooLargeError, RedirectLimitError, SsrfBlockedError } from "./errors.js";
import { sha256Hex } from "./hash.js";
import { readInstalledPackage, renderLocalPackage, type LocalPackageSource } from "./local-package.js";
import {
  assertDocUrlAllowed,
  DEFAULT_MAX_DOWNLOAD_BYTES,
  DEFAULT_MAX_OUTPUT_BYTES,
  DOC_FETCH_USER_AGENT,
  type DocFetchRole,
  isBlockedAddress,
  isIpLiteral,
  MAX_REDIRECTS,
  normalizeHost,
  parsePackageSpec,
  registryDocUrl,
  toVersionRange,
} from "./policy.js";
import { type AllowlistProxyServer, DirectResearcherAllowlistProxy, type ProxyConnectInfo } from "./proxy.js";
import { type HeadlessDocRenderer, PlaywrightDocRenderer } from "./renderer.js";
import { sanitizeHtmlToQuotedMarkdown, sanitizeTextToQuotedMarkdown, type SanitizeMeta, wrapUntrustedData } from "./sanitize.js";
import { needsJsRender } from "./spa.js";
import { detectPageVersion, versionFromUrl } from "./version.js";

export interface DocFetchResult {
  readonly url: string;
  readonly finalUrl: string;
  readonly fetchedAt: string;
  readonly detectedVersion: string | null;
  readonly sha256: string;
  readonly truncated: boolean;
  readonly originalChars: number;
  readonly markdown: string;
  readonly wrappedDataBlock: string;
  readonly fromCache: boolean;
}

export interface FetchDocsOptions {
  readonly role?: DocFetchRole;
  readonly packageName?: string;
  readonly version?: string;
  readonly ecosystem?: "npm" | "pypi";
  readonly maxOutputBytes?: number;
  readonly maxTokens?: number;
}

export interface SecureDocFetcherOptions {
  readonly role?: DocFetchRole;
  readonly proxy?: AllowlistProxyServer;
  readonly renderer?: HeadlessDocRenderer;
  readonly cache?: ResearchCacheStore;
  readonly cas?: CasBlobStore;
  readonly now?: () => number;
  readonly resolveHost?: (hostname: string) => Promise<readonly string[]>;
  readonly testOnlyLoopbackOverride?: boolean;
  readonly testAllowedHosts?: readonly string[];
  readonly maxDownloadBytes?: number;
  readonly maxOutputBytes?: number;
  readonly renderTimeoutMs?: number;
  readonly requestTimeoutMs?: number;
  readonly nodeModulesRoots?: readonly string[];
  readonly pnpmStoreDir?: string;
  readonly allowlistProxyUrl?: string;
  readonly onConnect?: (info: ProxyConnectInfo) => void;
}

export class SecureDocFetcher {
  private readonly defaultRole: DocFetchRole;
  private readonly proxy: AllowlistProxyServer;
  private readonly injectedRenderer: HeadlessDocRenderer | null;
  private readonly cache: ResearchCacheStore;
  private readonly cas: CasBlobStore;
  private readonly now: () => number;
  private readonly resolveHost: (hostname: string) => Promise<readonly string[]>;
  private readonly testOnlyLoopbackOverride: boolean;
  private readonly testAllowedHosts: readonly string[];
  private readonly maxDownloadBytes: number;
  private readonly maxOutputBytes: number;
  private readonly renderTimeoutMs: number;
  private readonly requestTimeoutMs: number;
  private readonly nodeModulesRoots: readonly string[];
  private readonly pnpmStoreDir: string | undefined;
  private readonly allowlistProxyUrl: string | undefined;
  private defaultRenderer: HeadlessDocRenderer | null = null;

  constructor(options: SecureDocFetcherOptions = {}) {
    if (options.testOnlyLoopbackOverride === true && process.env.NODE_ENV === "production") {
      throw new DocFetchError("TEST_OVERRIDE_DISABLED", "testOnlyLoopbackOverride is disabled in production");
    }
    this.defaultRole = options.role ?? "worker";
    this.testOnlyLoopbackOverride = options.testOnlyLoopbackOverride === true;
    this.testAllowedHosts = this.testOnlyLoopbackOverride ? (options.testAllowedHosts ?? []) : [];
    this.proxy =
      options.proxy ??
      new DirectResearcherAllowlistProxy({
        testOnlyLoopbackOverride: this.testOnlyLoopbackOverride,
        ...(options.onConnect ? { onConnect: options.onConnect } : {}),
      });
    this.injectedRenderer = options.renderer ?? null;
    this.cache = options.cache ?? new MemoryResearchCacheStore();
    this.cas = options.cas ?? new MemoryCasBlobStore();
    this.now = options.now ?? (() => Date.now());
    this.resolveHost = options.resolveHost ?? defaultResolveHost;
    this.maxDownloadBytes = options.maxDownloadBytes ?? DEFAULT_MAX_DOWNLOAD_BYTES;
    this.maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
    this.renderTimeoutMs = options.renderTimeoutMs ?? 10_000;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 10_000;
    this.nodeModulesRoots = options.nodeModulesRoots ?? [];
    this.pnpmStoreDir = options.pnpmStoreDir;
    this.allowlistProxyUrl = options.allowlistProxyUrl;
  }

  async fetchDocs(urlOrPkg: string, options: FetchDocsOptions = {}): Promise<DocFetchResult> {
    const role = options.role ?? this.defaultRole;
    const spec = parsePackageSpec(urlOrPkg);
    if (spec) return this.fetchPackage(spec, role, options);
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(urlOrPkg.trim())) return this.fetchUrl(urlOrPkg.trim(), role, options);
    throw new DocFetchError("INVALID_TARGET", "expected an http(s) URL or package@version");
  }

  readLocalPackageSource(spec: string): LocalPackageSource | null {
    const localOptions = {
      nodeModulesRoots: this.nodeModulesRoots,
      ...(this.pnpmStoreDir !== undefined ? { pnpmStoreDir: this.pnpmStoreDir } : {}),
    };
    return readInstalledPackage(spec, localOptions);
  }

  detectPageVersion(input: { readonly url?: string; readonly html?: string }): string | null {
    return detectPageVersion(input);
  }

  sanitizeHtmlToQuotedMarkdown(html: string, meta: SanitizeMeta) {
    return sanitizeHtmlToQuotedMarkdown(html, meta);
  }

  invalidateForLockfileUpdate(packageName: string, previousVersion: string, nextVersion: string): number {
    const previous = toVersionRange(previousVersion);
    const next = toVersionRange(nextVersion);
    if (previous === next) return 0;
    return this.cache.invalidate({ packageName, versionRange: previous }).length;
  }

  private async fetchPackage(
    spec: { name: string; version: string },
    role: DocFetchRole,
    options: FetchDocsOptions,
  ): Promise<DocFetchResult> {
    const local = this.readLocalPackageSource(`${spec.name}@${spec.version}`);
    if (local) return this.fromLocal(local, options);
    const docUrl = registryDocUrl(spec.name, spec.version, options.ecosystem ?? "npm");
    return this.fetchUrl(docUrl, role, {
      ...options,
      packageName: spec.name,
      version: spec.version,
    });
  }

  private fromLocal(source: LocalPackageSource, options: FetchDocsOptions): DocFetchResult {
    const fetchedAtMs = this.now();
    const fetchedAt = new Date(fetchedAtMs).toISOString();
    const url = `local:${source.name}@${source.version}`;
    const sanitized = sanitizeTextToQuotedMarkdown(renderLocalPackage(source), {
      url,
      fetchedAt,
      pageVersion: source.version,
      maxBytes: options.maxOutputBytes ?? this.maxOutputBytes,
      ...(options.maxTokens !== undefined ? { maxTokens: options.maxTokens } : {}),
    });
    return {
      url,
      finalUrl: pathToFileURL(source.rootDir).href,
      fetchedAt,
      detectedVersion: source.version,
      sha256: sanitized.sha256,
      truncated: sanitized.truncated,
      originalChars: sanitized.originalChars,
      markdown: sanitized.markdown,
      wrappedDataBlock: sanitized.wrappedDataBlock,
      fromCache: false,
    };
  }

  private async fetchUrl(docUrl: string, role: DocFetchRole, options: FetchDocsOptions): Promise<DocFetchResult> {
    const initial = new URL(docUrl);
    this.assertAllowed(initial, role);
    const identity = this.identity(initial.href, options.packageName, options.version);
    const cached = await this.readCache(this.cache.lookup(identity, this.now()));
    if (cached) return cached;
    const response = await this.request(initial.href, role);
    const contentType = response.headers["content-type"] ?? "";
    let document = decodeBody(response.body, contentType);
    let finalUrl = response.finalUrl;
    let html = isHtmlDocument(contentType, document);
    if (html && needsJsRender(document)) {
      const rendered = await this.renderer().render({
        url: finalUrl,
        timeoutMs: this.renderTimeoutMs,
        userAgent: DOC_FETCH_USER_AGENT,
        ...(this.allowlistProxyUrl !== undefined ? { proxyServer: this.allowlistProxyUrl } : {}),
      });
      if (Buffer.byteLength(rendered.html, "utf8") > this.maxDownloadBytes) {
        throw new DownloadTooLargeError(this.maxDownloadBytes);
      }
      document = rendered.html;
      finalUrl = rendered.finalUrl || finalUrl;
      html = true;
    }
    const detectedVersion = html ? detectPageVersion({ url: finalUrl, html: document }) : detectPageVersion({ url: finalUrl });
    const fetchedAt = new Date(this.now()).toISOString();
    const meta: SanitizeMeta = {
      url: identity.docUrl,
      fetchedAt,
      pageVersion: detectedVersion ?? "",
      maxBytes: options.maxOutputBytes ?? this.maxOutputBytes,
      ...(options.maxTokens !== undefined ? { maxTokens: options.maxTokens } : {}),
    };
    const sanitized = html
      ? sanitizeHtmlToQuotedMarkdown(document, meta)
      : sanitizeTextToQuotedMarkdown(prettyJson(document, contentType), meta);
    const bytes = Buffer.from(sanitized.markdown, "utf8");
    const stored = await this.cas.putBlob(bytes);
    const entry = this.cache.put({
      packageName: identity.packageName,
      versionRange: identity.versionRange,
      docUrl: identity.docUrl,
      pageVersion: detectedVersion,
      artifactHash: stored.hash,
      fetchedAt: this.now(),
    });
    this.cache.pin(
      stored.hash,
      researchHolderId(entry.packageName, entry.versionRange, entry.docUrl),
      entry.fetchedAt,
      bytes.byteLength,
    );
    return {
      url: identity.docUrl,
      finalUrl,
      fetchedAt,
      detectedVersion,
      sha256: sanitized.sha256,
      truncated: sanitized.truncated,
      originalChars: sanitized.originalChars,
      markdown: sanitized.markdown,
      wrappedDataBlock: sanitized.wrappedDataBlock,
      fromCache: false,
    };
  }

  private async readCache(entry: ResearchCacheEntry | null): Promise<DocFetchResult | null> {
    if (!entry) return null;
    const bytes = await this.cas.getBlob(entry.artifactHash);
    if (!bytes || sha256Hex(bytes) !== entry.artifactHash) {
      this.cache.invalidate({
        packageName: entry.packageName,
        versionRange: entry.versionRange,
        docUrl: entry.docUrl,
      });
      return null;
    }
    const markdown = Buffer.from(bytes).toString("utf8");
    const fetchedAt = new Date(entry.fetchedAt).toISOString();
    return {
      url: entry.docUrl,
      finalUrl: entry.docUrl,
      fetchedAt,
      detectedVersion: entry.pageVersion,
      sha256: entry.artifactHash,
      truncated: false,
      originalChars: markdown.length,
      markdown,
      wrappedDataBlock: wrapUntrustedData({
        url: entry.docUrl,
        fetchedAt,
        pageVersion: entry.pageVersion ?? "",
        markdown,
      }),
      fromCache: true,
    };
  }

  private async request(
    url: string,
    role: DocFetchRole,
  ): Promise<{ finalUrl: string; headers: Readonly<Record<string, string>>; body: Uint8Array }> {
    let current = new URL(url).href;
    let redirects = 0;
    const seen = new Set<string>();
    while (seen.size <= MAX_REDIRECTS + 1) {
      if (seen.has(current)) throw new RedirectLimitError(current);
      seen.add(current);
      const target = new URL(current);
      this.assertAllowed(target, role);
      const pinnedAddress = await this.resolvePinned(target);
      const response = await this.proxy.fetch({
        method: "GET",
        profile: "researcher",
        url: target.href,
        pinnedAddress,
        servername: target.hostname,
        timeoutMs: this.requestTimeoutMs,
        maxBytes: this.maxDownloadBytes,
      });
      if (response.status >= 300 && response.status < 400) {
        redirects += 1;
        if (redirects > MAX_REDIRECTS) throw new RedirectLimitError(current);
        const location = response.headers.location;
        if (!location) throw new DocFetchError("REDIRECT_MISSING_LOCATION", "redirect missing location");
        current = new URL(location, current).href;
        continue;
      }
      if (response.status < 200 || response.status >= 300) {
        throw new DocFetchError("HTTP_STATUS", `doc fetch failed with status ${response.status}`);
      }
      return { finalUrl: target.href, headers: response.headers, body: response.body };
    }
    throw new RedirectLimitError(current);
  }

  private assertAllowed(url: URL, role: DocFetchRole): void {
    assertDocUrlAllowed(url, {
      role,
      testOnlyLoopbackOverride: this.testOnlyLoopbackOverride,
      testAllowedHosts: this.testAllowedHosts,
    });
  }

  private async resolvePinned(url: URL): Promise<string> {
    let addresses: readonly string[];
    try {
      addresses = await this.resolveHost(url.hostname);
    } catch (error) {
      if (error instanceof DocFetchError || error instanceof SsrfBlockedError) throw error;
      const detail = error instanceof Error ? error.message : String(error);
      throw new DocFetchError("DNS", detail, { cause: error });
    }
    if (addresses.length === 0) throw new DocFetchError("DNS", `dns lookup failed for ${url.hostname}`);
    const allowLoopback = this.testOnlyLoopbackOverride && !isIpLiteral(url.hostname);
    for (const address of addresses) {
      if (isBlockedAddress(address, { allowLoopbackFixture: allowLoopback })) throw new SsrfBlockedError(address);
    }
    const pinned = addresses[0];
    if (!pinned) throw new DocFetchError("DNS", `dns lookup failed for ${url.hostname}`);
    return pinned;
  }

  private identity(
    docUrl: string,
    packageName: string | undefined,
    version: string | undefined,
  ): { packageName: string; versionRange: string; docUrl: string } {
    const versionRange = toVersionRange(version ?? versionFromUrl(docUrl) ?? "unknown");
    return {
      packageName: packageName ?? safeHostname(docUrl),
      versionRange,
      docUrl,
    };
  }

  private renderer(): HeadlessDocRenderer {
    if (this.injectedRenderer) return this.injectedRenderer;
    this.defaultRenderer ??= new PlaywrightDocRenderer();
    return this.defaultRenderer;
  }
}

async function defaultResolveHost(hostname: string): Promise<readonly string[]> {
  if (isIpLiteral(hostname)) return [normalizeHost(hostname)];
  const records = await lookup(hostname, { all: true, verbatim: true });
  return records.map((record) => record.address);
}

function safeHostname(docUrl: string): string {
  try {
    return new URL(docUrl).hostname;
  } catch {
    return "url";
  }
}

function decodeBody(bytes: Uint8Array, contentType: string): string {
  const charset = /charset\s*=\s*"?([^";\s]+)/i.exec(contentType)?.[1]?.toLowerCase() ?? "utf-8";
  const buffer = Buffer.from(bytes);
  if (charset === "utf-16le" || charset === "utf16le") return buffer.toString("utf16le");
  if (charset === "latin1" || charset === "iso-8859-1" || charset === "windows-1252") return buffer.toString("latin1");
  return buffer.toString("utf8");
}

function isHtmlDocument(contentType: string, body: string): boolean {
  const type = contentType.toLowerCase();
  if (type.includes("text/html") || type.includes("application/xhtml+xml")) return true;
  if (
    type.includes("json") ||
    type.includes("javascript") ||
    type.includes("text/plain") ||
    type.includes("markdown")
  ) {
    return false;
  }
  const start = body.trimStart().slice(0, 80).toLowerCase();
  return (
    start.startsWith("<!doctype html") ||
    start.startsWith("<html") ||
    start.startsWith("<head") ||
    start.startsWith("<body") ||
    start.startsWith("<div")
  );
}

function prettyJson(text: string, contentType: string): string {
  if (!contentType.toLowerCase().includes("json")) return text;
  try {
    return `\`\`\`json\n${JSON.stringify(JSON.parse(text), null, 2)}\n\`\`\``;
  } catch {
    return text;
  }
}
