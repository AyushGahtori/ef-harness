import { SANDBOX_ACCOUNTS, TIER_B_CAPABILITIES } from "./constants.js";
import { firewallRuleHash } from "./firewall.js";
import type { FirewallRuleSpec, TierBHostInspector, TierBProbe } from "./types.js";

export function probeTierB(inspector: TierBHostInspector, rules: readonly FirewallRuleSpec[]): TierBProbe {
  const missing: string[] = [];
  let provisioned = true;
  for (const account of SANDBOX_ACCOUNTS) {
    if (!inspector.accountExists(account)) {
      provisioned = false;
      missing.push(account);
    }
    if (!inspector.dpapiCredentialValid(account)) missing.push(`dpapi:${account}`);
  }
  let firewallActive = rules.length > 0;
  for (const rule of rules) {
    const observed = inspector.firewallRule(rule.name);
    const expected = firewallRuleHash(rule);
    if (!observed.present || !observed.enabled || observed.specHash !== expected) {
      firewallActive = false;
      missing.push(`firewall:${rule.name}`);
    }
  }
  const available = provisioned && firewallActive && missing.length === 0;
  return {
    tier: "B",
    capabilities: TIER_B_CAPABILITIES,
    available,
    reason: available ? null : "tier_b_not_ready",
    provisioned,
    firewallActive,
    missingComponents: missing,
  };
}
