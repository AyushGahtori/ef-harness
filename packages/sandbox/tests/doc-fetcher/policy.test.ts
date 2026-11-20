import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAX_DOWNLOAD_BYTES,
  DOC_DOMAIN_ALLOWLIST,
  DomainNotAllowlistedError,
  DocMethodNotAllowedError,
  DirectResearcherAllowlistProxy,
  MAX_REDIRECTS,
  RESEARCHER_DOC_DOMAIN_ALLOWLIST,
  SsrfBlockedError,
  assertDocUrlAllowed,
  assertReadOnlyMethod,
  isBlockedAddress,
} from "../../src/doc-fetcher/index.js";

const worker = { role: "worker" as const, testOnlyLoopbackOverride: false, testAllowedHosts: [] };
const researcher = { role: "researcher" as const, testOnlyLoopbackOverride: false, testAllowedHosts: [] };

describe("documentation allowlist and SSRF policy", () => {
  it("publishes the narrow worker list and the broader researcher list", () => {
    expect(DOC_DOMAIN_ALLOWLIST).toContain("registry.npmjs.org");
    expect(DOC_DOMAIN_ALLOWLIST).toContain("pypi.org");
    expect(DOC_DOMAIN_ALLOWLIST).toContain("github.com");
    expect(DOC_DOMAIN_ALLOWLIST).not.toContain("developer.mozilla.org");
    expect(DOC_DOMAIN_ALLOWLIST).not.toContain("pastebin.com");
    expect(RESEARCHER_DOC_DOMAIN_ALLOWLIST).toEqual(
      expect.arrayContaining([...DOC_DOMAIN_ALLOWLIST, "developer.mozilla.org", "readthedocs.io"]),
    );
    expect(DEFAULT_MAX_DOWNLOAD_BYTES).toBe(5 * 1024 * 1024);
    expect(MAX_REDIRECTS).toBe(5);
  });

  it("allows workers only official docs and pinned GitHub commits", () => {
    const sha = "a".repeat(40);
    expect(() => assertDocUrlAllowed(new URL("https://nodejs.org/api/fs.html"), worker)).not.toThrow();
    expect(() =>
      assertDocUrlAllowed(new URL(`https://github.com/acme/docs/blob/${sha}/README.md`), worker),
    ).not.toThrow();
    expect(() =>
      assertDocUrlAllowed(new URL(`https://raw.githubusercontent.com/acme/docs/${sha}/README.md`), worker),
    ).not.toThrow();
    expect(() => assertDocUrlAllowed(new URL("https://github.com/acme/docs/blob/main/README.md"), worker)).toThrow(
      DomainNotAllowlistedError,
    );
    expect(() => assertDocUrlAllowed(new URL("https://developer.mozilla.org/en-US/docs/Web"), worker)).toThrow(
      DomainNotAllowlistedError,
    );
    expect(() => assertDocUrlAllowed(new URL("https://requests.readthedocs.io/en/latest/"), worker)).toThrow(
      DomainNotAllowlistedError,
    );
    expect(() => assertDocUrlAllowed(new URL("https://pastebin.com/raw/abc"), researcher)).toThrow(
      DomainNotAllowlistedError,
    );
    expect(() => assertDocUrlAllowed(new URL("https://stackoverflow.com/questions/1"), researcher)).toThrow(
      DomainNotAllowlistedError,
    );
    expect(() => assertDocUrlAllowed(new URL("https://gist.github.com/acme/deadbeef"), researcher)).toThrow(
      DomainNotAllowlistedError,
    );
    expect(() => assertDocUrlAllowed(new URL("https://developer.mozilla.org/en-US/docs/Web"), researcher)).not.toThrow();
    expect(() =>
      assertDocUrlAllowed(new URL("https://requests.readthedocs.io/en/latest/"), researcher),
    ).not.toThrow();
  });

  it("blocks private, link-local, metadata, and ambiguous addresses", () => {
    const blocked = [
      "127.0.0.1",
      "10.1.2.3",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.169.254",
      "0.0.0.0",
      "100.64.0.1",
      "224.0.0.1",
      "::1",
      "fc00::1",
      "fd00::1",
      "fe80::1",
      "ff02::1",
      "::ffff:169.254.169.254",
      "::ffff:10.0.0.1",
    ];
    for (const address of blocked) {
      expect(isBlockedAddress(address, { allowLoopbackFixture: false }), address).toBe(true);
    }
    expect(isBlockedAddress("169.254.169.254", { allowLoopbackFixture: true })).toBe(true);
    expect(isBlockedAddress("10.1.2.3", { allowLoopbackFixture: true })).toBe(true);
    expect(isBlockedAddress("127.0.0.1", { allowLoopbackFixture: true })).toBe(false);
    expect(isBlockedAddress("::1", { allowLoopbackFixture: true })).toBe(false);
    expect(isBlockedAddress("8.8.8.8", { allowLoopbackFixture: false })).toBe(false);
    expect(isBlockedAddress("1.1.1.1", { allowLoopbackFixture: false })).toBe(false);
    expect(isBlockedAddress("172.15.0.1", { allowLoopbackFixture: false })).toBe(false);
    expect(() => assertDocUrlAllowed(new URL("http://169.254.169.254/latest/meta-data"), worker)).toThrow(
      SsrfBlockedError,
    );
    expect(() => assertDocUrlAllowed(new URL("http://127.0.0.1/"), worker)).toThrow(SsrfBlockedError);
    expect(() => assertDocUrlAllowed(new URL("http://127.0.0.01/"), worker)).toThrow(SsrfBlockedError);
    expect(() => assertDocUrlAllowed(new URL("http://2130706433/"), worker)).toThrow(SsrfBlockedError);
    expect(() => assertDocUrlAllowed(new URL("http://8.8.8.8/"), worker)).toThrow(DomainNotAllowlistedError);
  });

  it("rejects write methods before opening a socket", async () => {
    expect(() => assertReadOnlyMethod("POST")).toThrow(DocMethodNotAllowedError);
    expect(() => assertReadOnlyMethod("GET")).not.toThrow();
    const proxy = new DirectResearcherAllowlistProxy({
      onConnect: () => {
        throw new Error("connected");
      },
    });
    await expect(
      proxy.fetch({
        method: "POST" as "GET",
        profile: "researcher",
        url: "https://nodejs.org/",
        pinnedAddress: "1.1.1.1",
        servername: "nodejs.org",
        timeoutMs: 1000,
        maxBytes: 100,
      }),
    ).rejects.toBeInstanceOf(DocMethodNotAllowedError);
  });
});
