import type { ParsedGitHubRemote } from "./types.js";

const SSH_RE = /^git@([^:]+):([^/]+)\/(.+?)(?:\.git)?$/;
const HTTPS_RE = /^https?:\/\/([^/]+)\/([^/]+)\/(.+?)(?:\.git)?(?:\/.*)?$/;
const SCP_STYLE_SSH_RE = /^ssh:\/\/git@([^/]+)\/(.+?)\/(.+?)(?:\.git)?$/;

export function parseGitHubRemote(remoteUrl: string): ParsedGitHubRemote | null {
  const trimmed = remoteUrl.trim();
  const ssh = SSH_RE.exec(trimmed);
  if (ssh) {
    const host = ssh[1] ?? "";
    const owner = ssh[2] ?? "";
    const repo = (ssh[3] ?? "").replace(/\.git$/, "");
    if (!host || !owner || !repo) return null;
    return { owner, repo, host, raw: trimmed, transport: "ssh" };
  }
  const scpSsh = SCP_STYLE_SSH_RE.exec(trimmed);
  if (scpSsh) {
    const host = scpSsh[1] ?? "";
    const owner = scpSsh[2] ?? "";
    const repo = (scpSsh[3] ?? "").replace(/\.git$/, "");
    if (!host || !owner || !repo) return null;
    return { owner, repo, host, raw: trimmed, transport: "ssh" };
  }
  const https = HTTPS_RE.exec(trimmed);
  if (https) {
    const host = https[1] ?? "";
    const owner = https[2] ?? "";
    const repo = (https[3] ?? "").replace(/\.git$/, "");
    if (!host || !owner || !repo) return null;
    return { owner, repo, host, raw: trimmed, transport: "https" };
  }
  return null;
}

export function containsEmbeddedToken(remoteUrl: string): boolean {
  try {
    const url = new URL(remoteUrl.replace(/^git@/, "https://"));
    if (url.username || url.password) return true;
  } catch {
    // fall through
  }
  const githubPatPrefix = ["github", "_pat", "_"].join("");
  const legacyTokenPrefix = ["ghp", "_"].join("");
  const embeddedPat = new RegExp(`^https?://(${legacyTokenPrefix}|${githubPatPrefix})`);
  return /:\/\/[^@\s]+:[^@\s]+@/i.test(remoteUrl) || embeddedPat.test(remoteUrl);
}