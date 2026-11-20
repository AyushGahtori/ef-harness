import { createHash } from "node:crypto";
import {
  IPV4_LOOPBACK,
  IPV4_NON_LOOPBACK,
  IPV6_LOOPBACK,
  IPV6_NON_LOOPBACK,
  SANDBOX_OFFLINE_ACCOUNT,
  SANDBOX_ONLINE_ACCOUNT,
} from "./constants.js";
import { TierBError } from "./errors.js";
import type { FirewallRuleSpec, NetworkDecision, PortRange } from "./types.js";

export function assertPort(port: number, label: string): void {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new TierBError("invalid_port", `${label} port is invalid`);
  }
}

export function excludedPortRanges(allowed: readonly number[]): readonly PortRange[] {
  const ports = [...new Set(allowed)].sort((left, right) => left - right);
  for (const port of ports) assertPort(port, "firewall");
  const ranges: PortRange[] = [];
  let cursor = 1;
  for (const port of ports) {
    if (port > cursor) ranges.push({ start: cursor, end: port - 1 });
    cursor = port + 1;
  }
  if (cursor <= 65535) ranges.push({ start: cursor, end: 65535 });
  return ranges;
}

export function rangeCovers(ranges: readonly PortRange[], port: number): boolean {
  return ranges.some((range) => port >= range.start && port <= range.end);
}

export function formatPortRanges(ranges: readonly PortRange[]): string {
  return ranges.map((range) => (range.start === range.end ? String(range.start) : `${range.start}-${range.end}`)).join(",");
}

function blockRule(
  name: string,
  localUser: string,
  protocol: FirewallRuleSpec["protocol"],
  remoteAddresses: readonly string[],
  remotePorts: readonly PortRange[] | "any",
  permitsLoopbackTcp: readonly number[],
): FirewallRuleSpec {
  return {
    name,
    direction: "out",
    action: "block",
    enabled: true,
    localUser,
    protocol,
    remoteAddresses,
    remotePorts,
    profile: "any",
    edgeTraversal: "no",
    permitsLoopbackTcp,
  };
}

function rulesForAccount(account: string, prefix: string, allowed: readonly number[]): FirewallRuleSpec[] {
  const otherTcp = excludedPortRanges(allowed);
  return [
    blockRule(
      `EFHarness-TierB-${prefix}-Block-NonLoopback-IPv4`,
      account,
      "any",
      IPV4_NON_LOOPBACK,
      "any",
      allowed,
    ),
    blockRule(
      `EFHarness-TierB-${prefix}-Block-NonLoopback-IPv6`,
      account,
      "any",
      IPV6_NON_LOOPBACK,
      "any",
      allowed,
    ),
    blockRule(`EFHarness-TierB-${prefix}-Block-Loopback-Udp`, account, "udp", [...IPV4_LOOPBACK, ...IPV6_LOOPBACK], "any", allowed),
    blockRule(
      `EFHarness-TierB-${prefix}-Block-Loopback-OtherTcp`,
      account,
      "tcp",
      [...IPV4_LOOPBACK, ...IPV6_LOOPBACK],
      otherTcp,
      allowed,
    ),
  ];
}

export function buildTierBFirewallRules(ports: {
  readonly proxyPort: number;
  readonly mcpPort: number;
}): readonly FirewallRuleSpec[] {
  assertPort(ports.proxyPort, "proxy");
  assertPort(ports.mcpPort, "mcp");
  const allowed = [...new Set([ports.proxyPort, ports.mcpPort])];
  return [
    ...rulesForAccount(SANDBOX_OFFLINE_ACCOUNT, "Offline", allowed),
    ...rulesForAccount(SANDBOX_ONLINE_ACCOUNT, "Online", allowed),
  ];
}

export function firewallRuleHash(rule: FirewallRuleSpec): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        name: rule.name,
        action: rule.action,
        localUser: rule.localUser,
        protocol: rule.protocol,
        remoteAddresses: [...rule.remoteAddresses],
        remotePorts: rule.remotePorts,
        permitsLoopbackTcp: [...rule.permitsLoopbackTcp],
      }),
    )
    .digest("hex");
}

export function firewallSpecHash(rules: readonly FirewallRuleSpec[]): string {
  return createHash("sha256")
    .update(rules.map((rule) => firewallRuleHash(rule)).join(","))
    .digest("hex");
}

export function netshAddRuleArgs(rule: FirewallRuleSpec): readonly string[] {
  const remotePort = rule.remotePorts === "any" ? "any" : formatPortRanges(rule.remotePorts);
  return [
    "advfirewall",
    "firewall",
    "add",
    "rule",
    `name=${rule.name}`,
    "dir=out",
    "action=block",
    `protocol=${rule.protocol}`,
    `remoteip=${rule.remoteAddresses.join(",")}`,
    `remoteport=${remotePort}`,
    `localuser=${rule.localUser}`,
    "profile=any",
    "edge=no",
  ];
}

export function netshDeleteRuleArgs(name: string): readonly string[] {
  return ["advfirewall", "firewall", "delete", "rule", `name=${name}`];
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

export function evaluateTierBNetwork(input: {
  readonly account: "offline" | "online";
  readonly host: string;
  readonly port: number;
  readonly proxyPort: number;
  readonly mcpPort: number;
}): NetworkDecision {
  assertPort(input.port, "remote");
  const loopback = LOOPBACK_HOSTS.has(input.host.toLowerCase());
  const allowedPort = input.port === input.proxyPort || input.port === input.mcpPort;
  if (loopback && allowedPort) {
    return { allowed: true, errno: null, ruleId: "loopback_proxy_or_mcp", host: input.host, port: input.port };
  }
  const ruleId = loopback
    ? `firewall_${input.account}_loopback_other_port`
    : `firewall_${input.account}_non_loopback`;
  return { allowed: false, errno: "EACCES", ruleId, host: input.host, port: input.port };
}
