export {
  DocFetchError,
  DocMethodNotAllowedError,
  DomainNotAllowlistedError,
  DownloadTooLargeError,
  JsRendererUnavailableError,
  PathTraversalError,
  RedirectLimitError,
  SsrfBlockedError,
} from "./errors.js";
export { sha256Hex } from "./hash.js";
export {
  DOC_DOMAIN_ALLOWLIST,
  DOC_FETCH_USER_AGENT,
  DEFAULT_MAX_DOWNLOAD_BYTES,
  DEFAULT_MAX_OUTPUT_BYTES,
  MAX_REDIRECTS,
  MIN_STATIC_TEXT_CHARS,
  RESEARCH_CACHE_TTL_MS,
  RESEARCHER_DOC_DOMAIN_ALLOWLIST,
  assertDocUrlAllowed,
  assertReadOnlyMethod,
  githubCommitPinned,
  isBlockedAddress,
  isDocHostAllowed,
  parsePackageSpec,
  toVersionRange,
  type DocFetchRole,
  type DocUrlPolicy,
} from "./policy.js";
export { extractVisibleText, htmlToMarkdown, stripInvisibleChars } from "./html.js";
export {
  escapeDataFraming,
  sanitizeHtmlToQuotedMarkdown,
  sanitizeTextToQuotedMarkdown,
  wrapUntrustedData,
  type SanitizeMeta,
  type SanitizeResult,
} from "./sanitize.js";
export { detectPageVersion, versionFromUrl } from "./version.js";
export { needsJsRender } from "./spa.js";
export {
  readInstalledPackage as readLocalPackageSource,
  renderLocalPackage,
  type LocalPackageFile,
  type LocalPackageSource,
} from "./local-package.js";
export {
  BoundResearcherAllowlistProxy,
  DirectResearcherAllowlistProxy,
  type AllowlistProxyRequest,
  type AllowlistProxyResponse,
  type AllowlistProxyServer,
  type ProxyConnectInfo,
} from "./proxy.js";
export {
  PlaywrightDocRenderer,
  shouldBlockBrowserRequest,
  type HeadlessDocRenderer,
  type HeadlessRenderRequest,
  type RenderedDocument,
} from "./renderer.js";
export {
  MemoryCasBlobStore,
  MemoryResearchCacheStore,
  SqliteResearchCacheStore,
  researchHolderId,
  type CasBlobStore,
  type ResearchCacheEntry,
  type ResearchCacheStore,
  type ResearchPin,
} from "./cache.js";
export {
  SecureDocFetcher,
  type DocFetchResult,
  type FetchDocsOptions,
  type SecureDocFetcherOptions,
} from "./secure-doc-fetcher.js";
