import type { ProvisionExplanation } from "./types.js";

const FALLBACK = ["A", "D", "C"] as const;

function unsigned(code: number): number {
  return code < 0 ? code + 2 ** 32 : code;
}

export function explainProvisionFailure(code: number, api: ProvisionExplanation["api"]): ProvisionExplanation {
  const normalized = unsigned(code);
  if (normalized === 5 || normalized === 0x80070005) {
    const summary =
      api === "Firewall"
        ? "Corporate Group Policy is blocking Windows Firewall changes, so Tier B cannot enforce loopback-only rules for the sandbox users. Use Tier A or Tier D, or Tier C for tasks that qualify."
        : "Windows refused to create the sandbox local users (access denied). Group Policy may be blocking local accounts. Use Tier A or Tier D, or Tier C for tasks that qualify.";
    return { code: normalized, api, policyBlocked: true, summary, fallbackTiers: FALLBACK };
  }
  if (normalized === 1058 || normalized === 0x80070422) {
    return {
      code: normalized,
      api,
      policyBlocked: true,
      summary:
        "The Windows Firewall service is disabled, so Tier B cannot install outbound rules. Use Tier A or Tier D, or Tier C for tasks that qualify.",
      fallbackTiers: FALLBACK,
    };
  }
  if (normalized === 2224) {
    return {
      code: normalized,
      api,
      policyBlocked: false,
      summary: "A sandbox local account already exists. Deprovision Tier B or repair that account before creating it again.",
      fallbackTiers: [],
    };
  }
  if (normalized === 2245) {
    return {
      code: normalized,
      api,
      policyBlocked: false,
      summary: "The local password policy rejected the generated sandbox secret. No account was left half-configured.",
      fallbackTiers: [],
    };
  }
  if (normalized === 87) {
    return {
      code: normalized,
      api,
      policyBlocked: false,
      summary: "Windows rejected the sandbox account parameters as invalid. No firewall change was kept.",
      fallbackTiers: [],
    };
  }
  if (normalized === 1326) {
    return {
      code: normalized,
      api,
      policyBlocked: false,
      summary: "Windows rejected the sandbox logon secret stored for that account.",
      fallbackTiers: [],
    };
  }
  return {
    code: normalized,
    api,
    policyBlocked: false,
    summary: `${api} failed with Windows code ${normalized}. Tier B setup stopped and did not continue unsandboxed.`,
    fallbackTiers: FALLBACK,
  };
}

export function explainCreateProcessAsUserFailure(win32: number): {
  readonly message: string;
  readonly edrHint: string;
} {
  const edrHint =
    "Security software often flags CreateProcessAsUserW. This record is the Win32 error from that call, not a bare process exit code.";
  const normalized = unsigned(win32);
  if (normalized === 5) {
    return {
      message:
        "CreateProcessAsUserW was denied. The caller may lack SeAssignPrimaryTokenPrivilege, or endpoint protection blocked the call.",
      edrHint,
    };
  }
  if (normalized === 1314) {
    return {
      message: "CreateProcessAsUserW failed because a required privilege is not held (SeAssignPrimaryTokenPrivilege or SeIncreaseQuotaPrivilege).",
      edrHint,
    };
  }
  if (normalized === 1385) {
    return {
      message: "The sandbox account is not allowed the logon type requested by CreateProcessAsUserW.",
      edrHint,
    };
  }
  if (normalized === 1326) {
    return {
      message: "CreateProcessAsUserW could not log on. The DPAPI or LSA secret for that sandbox account did not match.",
      edrHint,
    };
  }
  return {
    message: `CreateProcessAsUserW failed with Windows code ${normalized}.`,
    edrHint,
  };
}
