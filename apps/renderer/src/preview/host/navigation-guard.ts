export type NavigationAction = "allow" | "block" | "open-os-browser";

export interface NavigationDecision {
  readonly action: NavigationAction;
  readonly url: string;
  readonly openedExternal: boolean;
  readonly reason: string;
}

export function decidePreviewNavigation(input: {
  readonly target: string;
  readonly previewOrigin: string;
  readonly explicitUserClick: boolean;
}): NavigationDecision {
  let target: URL;
  try {
    target = new URL(input.target);
  } catch {
    return block(input.target, "unparseable-url");
  }
  if (target.username || target.password) return block(target.href, "url-credentials");
  const preview = new URL(input.previewOrigin);
  if (isPreviewOrigin(target, preview)) {
    return {
      action: "allow",
      url: target.href,
      openedExternal: false,
      reason: "preview-origin",
    };
  }
  if (input.explicitUserClick && (target.protocol === "http:" || target.protocol === "https:")) {
    return {
      action: "open-os-browser",
      url: target.href,
      openedExternal: true,
      reason: "explicit-external-click",
    };
  }
  return block(target.href, "off-origin");
}

function isPreviewOrigin(target: URL, preview: URL): boolean {
  if (target.protocol !== "http:") return false;
  if (target.port !== preview.port) return false;
  const host = target.hostname.toLowerCase();
  if (host === "127.0.0.1" || host === "localhost") return true;
  if (!host.endsWith(".localhost")) return false;
  const label = host.slice(0, -".localhost".length);
  return /^[a-z0-9-]+$/i.test(label);
}

function block(url: string, reason: string): NavigationDecision {
  return { action: "block", url, openedExternal: false, reason };
}
