import { SANDBOX_ACCOUNTS, SANDBOX_OFFLINE_ACCOUNT, SANDBOX_ONLINE_ACCOUNT } from "./constants.js";
import { assertExplicitConsent } from "./consent.js";
import { ProvisionFailedError } from "./errors.js";
import { buildTierBFirewallRules, netshAddRuleArgs, netshDeleteRuleArgs } from "./firewall.js";
import { generateSandboxPassword } from "./password.js";
import { explainProvisionFailure } from "./provision-errors.js";
import type {
  DeprovisionPlan,
  FirewallRuleSpec,
  ProtectedSecret,
  ProvisionPlan,
  SandboxAuditLogger,
  ScriptInvocation,
  ScriptResult,
  ScriptRunner,
  SecretProtector,
} from "./types.js";

function psSingle(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function psCall(executable: string, args: readonly string[]): string {
  return `& ${executable} @(${args.map(psSingle).join(",")})`;
}

export function renderProvisionScript(rules: readonly FirewallRuleSpec[]): string {
  const firewall = rules
    .map((rule) => `${psCall("netsh.exe", netshAddRuleArgs(rule))}\r\nif ($LASTEXITCODE -ne 0) { throw 'firewall add failed' }`)
    .join("\r\n");
  return [
    "$ErrorActionPreference = 'Stop'",
    "if ($env:EF_HARNESS_TIER_B_CONSENT -ne 'settings_sandbox_setup') { exit 70 }",
    "if ($env:EF_HARNESS_TIER_B_ACTION -ne 'provision') { exit 70 }",
    "$raw = [Console]::In.ReadToEnd()",
    "$parts = @($raw -split \"`r?`n\" | Where-Object { $_ -ne '' })",
    "if ($parts.Count -lt 2) { exit 87 }",
    "$created = New-Object System.Collections.Generic.List[string]",
    "function Add-SandboxAccount([string]$Name, [string]$Secret) {",
    "  $code = [TierBNative]::NetUserAddAccount($Name, $Secret, 'EF Harness sandbox user. No desktop logon. Not an administrator.', 1)",
    "  if ($code -ne 0) { exit $code }",
    "  [void]$created.Add($Name)",
    "}",
    "if (-not ([System.Management.Automation.PSTypeName]'TierBNative').Type) {",
    "  Add-Type -TypeDefinition @'",
    "using System.Runtime.InteropServices;",
    "public static class TierBNative {",
    "  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]",
    "  public struct USER_INFO_1 {",
    "    public string name; public string password; public int password_age; public int priv;",
    "    public string home_dir; public string comment; public int flags; public string script_path;",
    "  }",
    "  [DllImport(\"netapi32.dll\", CharSet = CharSet.Unicode)]",
    "  public static extern int NetUserAdd(string server, int level, ref USER_INFO_1 info, out int parm);",
    "  public static int NetUserAddAccount(string name, string password, string comment, int priv) {",
    "    USER_INFO_1 info = new USER_INFO_1();",
    "    info.name = name; info.password = password; info.priv = priv; info.comment = comment; info.flags = 0x201;",
    "    int parm;",
    "    return NetUserAdd(null, 1, ref info, out parm);",
    "  }",
    "  [StructLayout(LayoutKind.Sequential)]",
    "  public struct LSA_OBJECT_ATTRIBUTES {",
    "    public int Length; public IntPtr RootDirectory; public IntPtr ObjectName;",
    "    public uint Attributes; public IntPtr SecurityDescriptor; public IntPtr SecurityQualityOfService;",
    "  }",
    "  [StructLayout(LayoutKind.Sequential)]",
    "  public struct LSA_UNICODE_STRING { public ushort Length; public ushort MaximumLength; public IntPtr Buffer; }",
    "  [DllImport(\"advapi32.dll\", CharSet = CharSet.Unicode, SetLastError = true)]",
    "  public static extern bool LookupAccountName(string system, string account, IntPtr sid, ref int sidSize, System.Text.StringBuilder domain, ref int domainSize, out int use);",
    "  [DllImport(\"advapi32.dll\", PreserveSig = true)]",
    "  public static extern uint LsaOpenPolicy(IntPtr system, ref LSA_OBJECT_ATTRIBUTES attributes, uint access, out IntPtr handle);",
    "  [DllImport(\"advapi32.dll\", CharSet = CharSet.Unicode, PreserveSig = true)]",
    "  public static extern uint LsaAddAccountRights(IntPtr handle, IntPtr sid, LSA_UNICODE_STRING[] rights, int count);",
    "  [DllImport(\"advapi32.dll\")]",
    "  public static extern int LsaNtStatusToWinError(uint status);",
    "  [DllImport(\"advapi32.dll\")]",
    "  public static extern uint LsaClose(IntPtr handle);",
    "  public static int AddDenyRight(string account, string right) {",
    "    int sidSize = 0; int domainSize = 0; int use;",
    "    LookupAccountName(null, account, IntPtr.Zero, ref sidSize, new System.Text.StringBuilder(), ref domainSize, out use);",
    "    IntPtr sid = Marshal.AllocHGlobal(sidSize);",
    "    try {",
    "      var domain = new System.Text.StringBuilder(domainSize);",
    "      if (!LookupAccountName(null, account, sid, ref sidSize, domain, ref domainSize, out use)) return Marshal.GetLastWin32Error();",
    "      LSA_OBJECT_ATTRIBUTES attributes = new LSA_OBJECT_ATTRIBUTES();",
    "      IntPtr policy;",
    "      uint status = LsaOpenPolicy(IntPtr.Zero, ref attributes, 0x000F0FFF, out policy);",
    "      if (status != 0) return LsaNtStatusToWinError(status);",
    "      try {",
    "        LSA_UNICODE_STRING item = new LSA_UNICODE_STRING();",
    "        item.Buffer = Marshal.StringToHGlobalUni(right);",
    "        item.Length = (ushort)(right.Length * 2);",
    "        item.MaximumLength = (ushort)((right.Length + 1) * 2);",
    "        uint added = LsaAddAccountRights(policy, sid, new LSA_UNICODE_STRING[] { item }, 1);",
    "        Marshal.FreeHGlobal(item.Buffer);",
    "        return added == 0 ? 0 : LsaNtStatusToWinError(added);",
    "      } finally { LsaClose(policy); }",
    "    } finally { Marshal.FreeHGlobal(sid); }",
    "  }",
    "}",
    "'@",
    "}",
    "try {",
    `  Add-SandboxAccount ${psSingle(SANDBOX_OFFLINE_ACCOUNT)} $parts[0]`,
    `  Add-SandboxAccount ${psSingle(SANDBOX_ONLINE_ACCOUNT)} $parts[1]`,
    "  foreach ($right in @('SeDenyInteractiveLogonRight','SeDenyRemoteInteractiveLogonRight')) {",
    "    foreach ($name in $created) {",
    "      $denyCode = [TierBNative]::AddDenyRight($name, $right)",
    "      if ($denyCode -ne 0) { throw \"deny logon right $right failed\" }",
    "    }",
    "  }",
    "  Write-Output 'USER_PRIV_USER'",
    "  Write-Output 'Administrators membership: none'",
    firewall,
    "} catch {",
    "  foreach ($name in $created) { & net.exe user $name /delete | Out-Null }",
    "  exit 1",
    "}",
    "exit 0",
    "",
  ].join("\r\n");
}

export function renderDeprovisionScript(rules: readonly FirewallRuleSpec[]): string {
  const deletes = [
    ...SANDBOX_ACCOUNTS.map((account) => `${psCall("net.exe", ["user", account, "/delete"])}`),
    ...rules.map((rule) => psCall("netsh.exe", netshDeleteRuleArgs(rule.name))),
  ];
  return [
    "$ErrorActionPreference = 'Stop'",
    "if ($env:EF_HARNESS_TIER_B_CONSENT -ne 'settings_sandbox_setup') { exit 70 }",
    "if ($env:EF_HARNESS_TIER_B_ACTION -ne 'unprovision') { exit 70 }",
    ...deletes,
    "Write-Output 'vault entries removed by the provisioner'",
    "exit 0",
    "",
  ].join("\r\n");
}

export class TierBAdminProvisioner {
  executionCount = 0;
  readonly proxyPort: number;
  readonly mcpPort: number;

  constructor(
    private readonly options: {
      readonly runner: ScriptRunner;
      readonly protector: SecretProtector;
      readonly developerSid: string;
      readonly proxyPort: number;
      readonly mcpPort: number;
      readonly logger: SandboxAuditLogger;
    },
  ) {
    this.proxyPort = options.proxyPort;
    this.mcpPort = options.mcpPort;
  }

  firewallRules(): readonly FirewallRuleSpec[] {
    return buildTierBFirewallRules({ proxyPort: this.proxyPort, mcpPort: this.mcpPort });
  }

  createPlan(): ProvisionPlan {
    const firewallRules = this.firewallRules();
    return {
      accounts: [...SANDBOX_ACCOUNTS],
      adminGroupMembership: false,
      interactiveLogon: "denied",
      denyLogonRights: ["SeDenyInteractiveLogonRight", "SeDenyRemoteInteractiveLogonRight"] as const,
      passwordStorage: "dpapi_or_lsa",
      passwordEmbeddedInScript: false,
      firewallRules,
      script: renderProvisionScript(firewallRules),
      consent: "required",
      silent: false,
    };
  }

  createDeprovisionPlan(): DeprovisionPlan {
    const firewallRules = this.firewallRules();
    return {
      accountsRemoved: [...SANDBOX_ACCOUNTS],
      firewallRulesRemoved: firewallRules.map((rule) => rule.name),
      vaultEntriesRemoved: [...SANDBOX_ACCOUNTS],
      script: renderDeprovisionScript(firewallRules),
      consent: "required",
      reversible: true,
    };
  }

  async provision(consent: unknown): Promise<{ readonly secrets: readonly ProtectedSecret[]; readonly plan: ProvisionPlan }> {
    assertExplicitConsent(consent, "provision");
    const plan = this.createPlan();
    const offline = generateSandboxPassword();
    const online = generateSandboxPassword();
    if (plan.script.includes(offline) || plan.script.includes(online)) {
      throw new ProvisionFailedError(87, "The provisioning script embedded a sandbox secret. Setup stopped.", []);
    }
    const secrets = [
      this.options.protector.protect(SANDBOX_OFFLINE_ACCOUNT, offline, this.options.developerSid),
      this.options.protector.protect(SANDBOX_ONLINE_ACCOUNT, online, this.options.developerSid),
    ];
    this.options.logger.write({
      ts: new Date().toISOString(),
      level: "info",
      component: "tier-b-users",
      msg: "tier b provision started after settings consent",
      fields: { passwordStorage: "dpapi", accountCount: secrets.length, silent: false },
    });
    const result = await this.runScript(plan.script, `${offline}\n${online}\n`, "provision");
    if (result.exitCode !== 0) {
      for (const secret of secrets) this.options.protector.delete(secret.account);
      const explanation = explainProvisionFailure(result.exitCode, "NetUserAdd");
      throw new ProvisionFailedError(explanation.code, explanation.summary, explanation.fallbackTiers);
    }
    return { secrets, plan };
  }

  async unprovision(consent: unknown): Promise<DeprovisionPlan> {
    assertExplicitConsent(consent, "unprovision");
    const plan = this.createDeprovisionPlan();
    const result = await this.runScript(plan.script, "", "unprovision");
    if (result.exitCode !== 0) {
      const explanation = explainProvisionFailure(result.exitCode, "NetUserDel");
      throw new ProvisionFailedError(explanation.code, explanation.summary, explanation.fallbackTiers);
    }
    for (const account of SANDBOX_ACCOUNTS) this.options.protector.delete(account);
    this.options.logger.write({
      ts: new Date().toISOString(),
      level: "info",
      component: "tier-b-users",
      msg: "tier b deprovision finished",
      fields: { accountsRemoved: plan.accountsRemoved.length, firewallRulesRemoved: plan.firewallRulesRemoved.length },
    });
    return plan;
  }

  private async runScript(script: string, stdin: string, action: "provision" | "unprovision"): Promise<ScriptResult> {
    this.executionCount += 1;
    const invocation: ScriptInvocation = {
      file: "powershell.exe",
      args: ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File"],
      script,
      stdin,
      env: {
        EF_HARNESS_TIER_B_CONSENT: "settings_sandbox_setup",
        EF_HARNESS_TIER_B_ACTION: action,
      },
      stdinIsSecret: true,
    };
    return this.options.runner.run(invocation);
  }
}
