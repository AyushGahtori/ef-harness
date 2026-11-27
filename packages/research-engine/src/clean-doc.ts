import { DocFetchError, type SecureDocFetcher } from "@ef-harness/sandbox";
import { quarantineWebDoc } from "./doc-quarantine.js";
import type { DocFetchOutcome, FetchDocsOptions, FetchFailureReason, SecureDocFetcherPort } from "./ports.js";

/**
 * Adapts `SecureDocFetcher.fetchDocs` to the research port's `fetchCleanDoc`.
 * The returned markdown is the quarantined visible text.
 */
export async function fetchCleanDoc(
  fetcher: Pick<SecureDocFetcher, "fetchDocs">,
  url: string,
  options?: FetchDocsOptions,
): Promise<DocFetchOutcome> {
  try {
    const result = await fetcher.fetchDocs(url, cleanFetchOptions(options));
    const pageVersion = result.detectedVersion ?? "0";
    const cleaned = quarantineWebDoc(result.markdown, {
      url: result.finalUrl,
      fetchedAt: result.fetchedAt,
      pageVersion,
    });
    return {
      ok: true,
      result: {
        url: result.url,
        finalUrl: result.finalUrl,
        fetchedAt: result.fetchedAt,
        detectedVersion: result.detectedVersion,
        sha256: result.sha256,
        truncated: result.truncated,
        originalChars: result.originalChars,
        markdown: cleaned.plainText,
        wrappedDataBlock: cleaned.wrappedDataBlock,
        fromCache: result.fromCache,
        html: result.markdown,
      },
    };
  } catch (error) {
    return {
      ok: false,
      code: "fetch_failed",
      reason: failureReason(error),
      url,
    };
  }
}

export function adaptSecureDocFetcher(fetcher: SecureDocFetcher): SecureDocFetcherPort {
  return {
    fetchDocs: (url, options) => fetchCleanDoc(fetcher, url, options),
    fetchCleanDoc: (url, options) => fetchCleanDoc(fetcher, url, options),
  };
}

function cleanFetchOptions(options: FetchDocsOptions | undefined): FetchDocsOptions {
  if (!options) return {};
  return {
    ...(options.role ? { role: options.role } : {}),
    ...(options.packageName ? { packageName: options.packageName } : {}),
    ...(options.version ? { version: options.version } : {}),
  };
}

function failureReason(error: unknown): FetchFailureReason {
  const code = error instanceof DocFetchError ? error.code : "";
  if (code === "DOMAIN_NOT_ALLOWLISTED" || code === "SSRF_BLOCKED" || code === "REDIRECT_LIMIT") {
    return "off_allowlist_redirect";
  }
  if (code.includes("404")) return "http_404";
  return "unreachable";
}
