import { SANDBOX_OFFLINE_ACCOUNT, SANDBOX_ONLINE_ACCOUNT } from "./constants.js";
import { buildDesktopIsolation } from "./desktop.js";
import { TierBError } from "./errors.js";
import type { CommandSpec, DesktopIsolationPlan, RestrictedLogonPlan } from "./types.js";

export function selectSandboxAccount(command: Pick<CommandSpec, "purpose" | "kernelApproved">): {
  readonly kind: "offline" | "online";
  readonly name: string;
} {
  const purpose = command.purpose ?? "coding_worker";
  if (purpose === "coding_worker") return { kind: "offline", name: SANDBOX_OFFLINE_ACCOUNT };
  if ((purpose === "kernel_proxy" || purpose === "test_endpoint") && command.kernelApproved === true) {
    return { kind: "online", name: SANDBOX_ONLINE_ACCOUNT };
  }
  throw new TierBError(
    "online_account_requires_kernel_approval",
    "The online sandbox account is only for a kernel-approved proxy or test-endpoint task",
  );
}

export function buildRestrictedLogonPlan(input: {
  readonly account: string;
  readonly restrictingSids: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly proxyDeclaredEndpoints: readonly string[];
  readonly enforcement: "os_tier_b" | "test_double";
  readonly platform?: NodeJS.Platform;
}): RestrictedLogonPlan {
  const desktop: DesktopIsolationPlan = buildDesktopIsolation(input.platform);
  return {
    apis: ["LogonUser", "CreateRestrictedToken", "CreateProcessAsUserW"] as const,
    account: input.account,
    restrictingSids: input.restrictingSids,
    desktop,
    jobNested: true,
    env: input.env,
    command: input.command,
    args: input.args,
    cwd: input.cwd,
    directExternalTcp: "deny",
    proxyDeclaredEndpoints: input.proxyDeclaredEndpoints,
    enforcement: input.enforcement,
  };
}
