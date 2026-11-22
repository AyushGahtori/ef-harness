import { RedactionCanaryLeakError } from "./types.js";
import type { PacketSecurityRedactorPort } from "./ports.js";

export interface RedactionContext {
  readonly redactor: PacketSecurityRedactorPort;
  readonly windowsUsernames: readonly string[];
  readonly repoFolderNames: readonly string[];
  readonly hostnames: readonly string[];
  readonly canaries: readonly string[];
}

export function scrubDiagnosticsText(text: string, context: RedactionContext): string {
  for (const canary of context.canaries) context.redactor.registerCanary(canary);
  let next = context.redactor.redact(text);
  next = next.replace(
    /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
    "<EMAIL>",
  );
  next = next.replace(/[A-Za-z]:\\Users\\[^\\/\s]+/g, (match) => {
    const drive = match.slice(0, 1);
    return `${drive}:\\Users\\<USER>`;
  });
  next = next.replace(/[A-Za-z]:\/Users\/[^\\/\s]+/g, (match) => {
    const drive = match.slice(0, 1);
    return `${drive}:/Users/<USER>`;
  });
  next = replaceTokens(next, context.windowsUsernames, "<USER>", 3);
  next = replaceTokens(next, context.hostnames, "<HOST>", 3);
  next = replaceTokens(next, context.repoFolderNames, "<REPO>", 4);
  assertCanariesAbsent(next, context);
  return next;
}

function replaceTokens(
  text: string,
  tokens: readonly string[],
  replacement: string,
  minLength: number,
): string {
  const ordered = [...tokens]
    .filter((token) => token.length >= minLength)
    .sort((left, right) => right.length - left.length);
  let next = text;
  for (const token of ordered) {
    if (!next.includes(token)) continue;
    next = next.split(token).join(replacement);
  }
  return next;
}

function assertCanariesAbsent(text: string, context: RedactionContext): void {
  for (const canary of context.canaries) {
    if (canary.length >= 8 && text.includes(canary)) {
      throw new RedactionCanaryLeakError();
    }
  }
  for (const username of context.windowsUsernames) {
    if (username.length >= 3 && text.includes(username)) {
      throw new RedactionCanaryLeakError();
    }
  }
}
