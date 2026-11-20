/**
 * Local copy of Task 045 researcher documentation hosts.
 * Swap for `RESEARCHER_DOC_DOMAIN_ALLOWLIST` when that package is on the branch.
 * Official docs, registries, and pinned GitHub only. Arbitrary hosts are refused.
 */
export const LOCAL_RESEARCHER_DOC_HOSTS: readonly string[] = [
  "nodejs.org",
  "react.dev",
  "reactjs.org",
  "nextjs.org",
  "vuejs.org",
  "vitejs.dev",
  "vite.dev",
  "typescriptlang.org",
  "python.org",
  "npmjs.com",
  "registry.npmjs.org",
  "pypi.org",
  "rust-lang.org",
  "go.dev",
  "golang.org",
  "deno.com",
  "bun.sh",
  "angular.dev",
  "svelte.dev",
  "docs.oracle.com",
  "github.com",
  "raw.githubusercontent.com",
  "developer.mozilla.org",
  "learn.microsoft.com",
  "docs.microsoft.com",
  "developer.apple.com",
  "developer.android.com",
  "developer.chrome.com",
  "web.dev",
  "pkg.go.dev",
  "docs.rs",
  "crates.io",
  "rfc-editor.org",
  "man7.org",
  "kubernetes.io",
  "docs.docker.com",
  "docs.github.com",
  "cloud.google.com",
  "docs.aws.amazon.com",
  "nuget.org",
  "hex.pm",
  "hexdocs.pm",
  "rubygems.org",
  "rubyonrails.org",
  "php.net",
  "cppreference.com",
  "readthedocs.io",
  "readthedocs.org",
  "postgresql.org",
  "redis.io",
  "prisma.io",
  "tailwindcss.com",
  "electronjs.org",
];

const COMMIT_SHA = /^[0-9a-f]{40}$/i;

export function hostAllowed(hostname: string, extraHosts: readonly string[] = []): boolean {
  const host = hostname.trim().toLowerCase().replace(/\.$/, "");
  const allowed = [...LOCAL_RESEARCHER_DOC_HOSTS, ...extraHosts].map((item) => item.toLowerCase());
  if (allowed.includes(host)) return true;
  return allowed.some(
    (rule) =>
      rule !== "github.com" &&
      rule !== "raw.githubusercontent.com" &&
      host.endsWith(`.${rule}`),
  );
}

export function urlAllowed(raw: string, extraHosts: readonly string[] = []): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch (error) {
    void error;
    return false;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  const host = url.hostname.toLowerCase();
  if (!hostAllowed(host, extraHosts)) return false;
  if (host === "github.com" || host === "raw.githubusercontent.com") {
    return githubCommitPinned(url);
  }
  return true;
}

function githubCommitPinned(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  const parts = url.pathname.split("/").filter((part) => part.length > 0);
  if (host === "github.com") {
    const kind = parts[2]?.toLowerCase();
    const sha = parts[3] ?? "";
    return (
      parts.length >= 4 &&
      (kind === "blob" || kind === "tree" || kind === "raw" || kind === "commit") &&
      COMMIT_SHA.test(sha)
    );
  }
  if (host === "raw.githubusercontent.com") {
    const sha = parts[2] ?? "";
    return parts.length >= 4 && COMMIT_SHA.test(sha);
  }
  return false;
}
