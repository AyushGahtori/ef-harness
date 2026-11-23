import { ForcePushForbiddenError } from "./errors.js";

const BLIND_FORCE = /\bgit\s+push\b[^\n]*\s--force(?:\s|$)/;
const BLIND_FORCE_SHORT = /\bgit\s+push\b[^\n]*\s-f(?:\s|$)/;

export function assertHarnessStatePushAllowed(commandLine: string): void {
  if (BLIND_FORCE.test(commandLine) && !/--force-with-lease/.test(commandLine)) {
    throw new ForcePushForbiddenError(
      "Blind git push --force on harness-state is forbidden; use --force-with-lease=<expected-sha>",
    );
  }
  if (BLIND_FORCE_SHORT.test(commandLine) && !/--force-with-lease/.test(commandLine)) {
    throw new ForcePushForbiddenError(
      "Blind git push -f on harness-state is forbidden; use --force-with-lease=<expected-sha>",
    );
  }
}

export function formatForceWithLeasePush(remote: string, branch: string, expectedRemoteSha: string): string {
  return `git push ${remote} ${branch} --force-with-lease=refs/heads/${branch}:${expectedRemoteSha}`;
}