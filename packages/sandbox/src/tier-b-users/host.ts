import { spawnSync } from "node:child_process";
import { SANDBOX_ACCOUNTS } from "./constants.js";
import type { FirewallObservation, TierBHostInspector } from "./types.js";

function localAccountExists(account: string): boolean {
  if (process.platform !== "win32") return false;
  const result = spawnSync("net", ["user", account], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 8000,
  });
  return result.status === 0;
}

function absent(name: string): FirewallObservation {
  return { name, present: false, enabled: false, specHash: null };
}

export function readWindowsTierBInspector(): TierBHostInspector {
  const present = new Map<string, boolean>();
  for (const account of SANDBOX_ACCOUNTS) present.set(account, localAccountExists(account));
  return {
    accountExists(name: string): boolean {
      return present.get(name) === true;
    },
    firewallRule(name: string): FirewallObservation {
      return absent(name);
    },
    dpapiCredentialValid(): boolean {
      return false;
    },
  };
}
