import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash } from "node:crypto";
import { createInterface } from "node:readline";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { lockDownOwnerOnly } from "./ntfs-acl.js";
import type { SecretMaterialStore } from "./ports.js";
import { CredentialsNeedReentryError, VaultError } from "./types.js";

const CSHARP = `
using System;
using System.Runtime.InteropServices;
using System.ComponentModel;
public static class EfVaultNative {
  [StructLayout(LayoutKind.Sequential)]
  public struct DATA_BLOB {
    public int cbData;
    public IntPtr pbData;
  }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct CREDENTIAL {
    public uint Flags;
    public uint Type;
    public string TargetName;
    public string Comment;
    public long LastWritten;
    public uint CredentialBlobSize;
    public IntPtr CredentialBlob;
    public uint Persist;
    public uint AttributeCount;
    public IntPtr Attributes;
    public string TargetAlias;
    public string UserName;
  }
  [DllImport("crypt32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern bool CryptProtectData(ref DATA_BLOB pDataIn, string szDataDescr, ref DATA_BLOB pOptionalEntropy, IntPtr pvReserved, IntPtr pPromptStruct, uint dwFlags, ref DATA_BLOB pDataOut);
  [DllImport("crypt32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern bool CryptUnprotectData(ref DATA_BLOB pDataIn, IntPtr ppszDataDescr, ref DATA_BLOB pOptionalEntropy, IntPtr pvReserved, IntPtr pPromptStruct, uint dwFlags, ref DATA_BLOB pDataOut);
  [DllImport("kernel32.dll")]
  static extern IntPtr LocalFree(IntPtr hMem);
  [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern bool CredWrite(ref CREDENTIAL credential, uint flags);
  [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern bool CredRead(string target, uint type, uint reservedFlag, out IntPtr credential);
  [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern bool CredDelete(string target, uint type, uint flags);
  [DllImport("advapi32.dll")]
  static extern void CredFree(IntPtr cred);
  static DATA_BLOB ToBlob(byte[] bytes) {
    var blob = new DATA_BLOB();
    blob.cbData = bytes.Length;
    blob.pbData = Marshal.AllocHGlobal(bytes.Length);
    Marshal.Copy(bytes, 0, blob.pbData, bytes.Length);
    return blob;
  }
  static void FreeBlob(DATA_BLOB blob) {
    if (blob.pbData != IntPtr.Zero) Marshal.FreeHGlobal(blob.pbData);
  }
  public static byte[] Protect(byte[] plain, byte[] entropy) {
    var input = ToBlob(plain);
    var ent = ToBlob(entropy);
    var output = new DATA_BLOB();
    try {
      if (!CryptProtectData(ref input, "EFHarness", ref ent, IntPtr.Zero, IntPtr.Zero, 0x1, ref output))
        throw new Win32Exception(Marshal.GetLastWin32Error());
      var result = new byte[output.cbData];
      Marshal.Copy(output.pbData, result, 0, output.cbData);
      return result;
    } finally {
      FreeBlob(input);
      FreeBlob(ent);
      if (output.pbData != IntPtr.Zero) LocalFree(output.pbData);
    }
  }
  public static byte[] Unprotect(byte[] cipher, byte[] entropy) {
    var input = ToBlob(cipher);
    var ent = ToBlob(entropy);
    var output = new DATA_BLOB();
    try {
      if (!CryptUnprotectData(ref input, IntPtr.Zero, ref ent, IntPtr.Zero, IntPtr.Zero, 0x1, ref output))
        throw new Win32Exception(Marshal.GetLastWin32Error());
      var result = new byte[output.cbData];
      Marshal.Copy(output.pbData, result, 0, output.cbData);
      return result;
    } finally {
      FreeBlob(input);
      FreeBlob(ent);
      if (output.pbData != IntPtr.Zero) LocalFree(output.pbData);
    }
  }
  public static void WriteCred(string target, byte[] blob) {
    if (blob.Length > 2560) throw new InvalidOperationException("CRED_BLOB_TOO_LARGE");
    var ptr = Marshal.AllocHGlobal(blob.Length);
    Marshal.Copy(blob, 0, ptr, blob.Length);
    var cred = new CREDENTIAL();
    cred.Type = 1;
    cred.TargetName = target;
    cred.Comment = "ef-harness";
    cred.CredentialBlobSize = (uint)blob.Length;
    cred.CredentialBlob = ptr;
    cred.Persist = 2;
    cred.UserName = "ef-harness";
    try {
      if (!CredWrite(ref cred, 0)) throw new Win32Exception(Marshal.GetLastWin32Error());
    } finally {
      Marshal.FreeHGlobal(ptr);
    }
  }
  public static byte[] ReadCred(string target) {
    IntPtr pcred;
    if (!CredRead(target, 1, 0, out pcred)) {
      int err = Marshal.GetLastWin32Error();
      if (err == 1168) return null;
      throw new Win32Exception(err);
    }
    try {
      var cred = (CREDENTIAL)Marshal.PtrToStructure(pcred, typeof(CREDENTIAL));
      var bytes = new byte[cred.CredentialBlobSize];
      if (cred.CredentialBlobSize > 0) Marshal.Copy(cred.CredentialBlob, bytes, 0, bytes.Length);
      return bytes;
    } finally {
      CredFree(pcred);
    }
  }
  public static void DeleteCred(string target) {
    if (!CredDelete(target, 1, 0)) {
      int err = Marshal.GetLastWin32Error();
      if (err == 1168) return;
      throw new Win32Exception(err);
    }
  }
}
`.trim();

const BRIDGE_BODY = `
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -TypeDefinition @'
${CSHARP}
'@
function Get-Entropy { return [Text.Encoding]::UTF8.GetBytes('ef-harness-vault-v1') }
$script:Prefix = [Text.Encoding]::ASCII.GetBytes('EFHFILE1:')
function Test-FilePointer([byte[]]$blob) {
  if ($null -eq $blob -or $blob.Length -lt $script:Prefix.Length) { return $false }
  for ($i = 0; $i -lt $script:Prefix.Length; $i++) {
    if ($blob[$i] -ne $script:Prefix[$i]) { return $false }
  }
  return $true
}
function Read-FilePointer([byte[]]$blob) {
  $count = $blob.Length - $script:Prefix.Length
  $pathBytes = New-Object byte[] $count
  [Array]::Copy($blob, $script:Prefix.Length, $pathBytes, 0, $count)
  return [Text.Encoding]::UTF8.GetString($pathBytes)
}
function Write-FilePointer([string]$target, [string]$filePath) {
  $pathBytes = [Text.Encoding]::UTF8.GetBytes($filePath)
  $marker = New-Object byte[] ($script:Prefix.Length + $pathBytes.Length)
  [Array]::Copy($script:Prefix, 0, $marker, 0, $script:Prefix.Length)
  [Array]::Copy($pathBytes, 0, $marker, $script:Prefix.Length, $pathBytes.Length)
  [EfVaultNative]::WriteCred($target, $marker)
}
function Remove-Overflow([string]$overflow) {
  if ($overflow -and (Test-Path -LiteralPath $overflow)) {
    Remove-Item -LiteralPath $overflow -Force
  }
}
[Console]::Out.WriteLine('{"ready":true}')
while ($true) {
  $line = [Console]::In.ReadLine()
  if ([object]::ReferenceEquals($line, $null)) { break }
  if ($line -eq 'EXIT') { break }
  if ($line.Trim().Length -eq 0) { continue }
  $id = 0
  try {
    $req = $line | ConvertFrom-Json
    $id = [int]$req.id
    $target = [string]$req.target
    $overflow = [string]$req.overflowPath
    switch ([string]$req.op) {
      'put' {
        $plain = [Convert]::FromBase64String([string]$req.plainB64)
        $cipher = [EfVaultNative]::Protect($plain, (Get-Entropy))
        if ($cipher.Length -le 2560) {
          [EfVaultNative]::WriteCred($target, $cipher)
          Remove-Overflow $overflow
        } else {
          $dir = Split-Path -Parent $overflow
          if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
          [IO.File]::WriteAllBytes($overflow, $cipher)
          Write-FilePointer $target $overflow
        }
        [Console]::Out.WriteLine(('{"id":' + $id + ',"ok":true}'))
      }
      'get' {
        $blob = [EfVaultNative]::ReadCred($target)
        if ($null -eq $blob) {
          [Console]::Out.WriteLine(('{"id":' + $id + ',"ok":true,"missing":true}'))
        } else {
          $cipher = $blob
          if (Test-FilePointer $blob) {
            $file = Read-FilePointer $blob
            if (-not (Test-Path -LiteralPath $file)) { throw 'missing blob' }
            $cipher = [IO.File]::ReadAllBytes($file)
          }
          $plain = [EfVaultNative]::Unprotect($cipher, (Get-Entropy))
          $b64 = [Convert]::ToBase64String($plain)
          [Console]::Out.WriteLine(('{"id":' + $id + ',"ok":true,"plainB64":"' + $b64 + '"}'))
        }
      }
      'del' {
        $blob = [EfVaultNative]::ReadCred($target)
        if ($null -ne $blob -and (Test-FilePointer $blob)) {
          $file = Read-FilePointer $blob
          if (Test-Path -LiteralPath $file) { Remove-Item -LiteralPath $file -Force }
        }
        [EfVaultNative]::DeleteCred($target)
        Remove-Overflow $overflow
        [Console]::Out.WriteLine(('{"id":' + $id + ',"ok":true}'))
      }
      'raw' {
        $bytes = [Convert]::FromBase64String([string]$req.cipherB64)
        [EfVaultNative]::WriteCred($target, $bytes)
        Remove-Overflow $overflow
        [Console]::Out.WriteLine(('{"id":' + $id + ',"ok":true}'))
      }
      default { throw 'bad op' }
    }
  } catch {
    $code = 'store'
    if ($line -match '"op"\\s*:\\s*"get"') { $code = 'reenter' }
    [Console]::Out.WriteLine(('{"id":' + $id + ',"ok":false,"code":"' + $code + '"}'))
  }
}
`.replace("${CSHARP}", CSHARP);

interface BridgeResponse {
  readonly id: number;
  readonly ok: boolean;
  readonly missing?: boolean;
  readonly plainB64?: string;
  readonly code?: string;
}

interface Pending {
  resolve(value: BridgeResponse): void;
  reject(error: Error): void;
}

export class WindowsDpapiMaterialStore implements SecretMaterialStore {
  private child: ChildProcessWithoutNullStreams | null = null;
  private ready: Promise<void> | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private stderr = "";

  constructor(private readonly vaultDir: string) {
    if (process.platform !== "win32") {
      throw new VaultError("dpapi_windows_only", "Windows DPAPI is only available on Windows.");
    }
    mkdirSync(vaultDir, { recursive: true });
  }

  async protectAndWrite(target: string, plaintext: Buffer, overflowPath: string): Promise<void> {
    assertTarget(target);
    assertOverflow(this.vaultDir, overflowPath);
    await this.request({
      op: "put",
      target,
      overflowPath,
      plainB64: plaintext.toString("base64"),
    });
    if (existsSync(overflowPath)) await lockDownOwnerOnly(overflowPath);
  }

  async readAndUnprotect(target: string): Promise<Buffer | null> {
    assertTarget(target);
    const response = await this.request({ op: "get", target, overflowPath: "" });
    if (response.missing) return null;
    if (!response.ok || !response.plainB64) {
      throw new CredentialsNeedReentryError();
    }
    return Buffer.from(response.plainB64, "base64");
  }

  async deleteMaterial(target: string, overflowPath: string): Promise<void> {
    assertTarget(target);
    assertOverflow(this.vaultDir, overflowPath);
    await this.request({ op: "del", target, overflowPath });
  }

  async replaceStoredCiphertext(target: string, ciphertext: Buffer, overflowPath: string): Promise<void> {
    assertTarget(target);
    assertOverflow(this.vaultDir, overflowPath);
    await this.request({
      op: "raw",
      target,
      overflowPath,
      cipherB64: ciphertext.toString("base64"),
    });
  }

  async close(): Promise<void> {
    const child = this.child;
    this.child = null;
    this.ready = null;
    if (!child) return;
    if (child.stdin.writable) {
      child.stdin.write("EXIT\n");
      child.stdin.end();
    }
    await Promise.race([
      onceExit(child),
      new Promise<void>((resolve) => {
        setTimeout(resolve, 2_000);
      }),
    ]);
    if (child.exitCode === null) child.kill();
    for (const [id, pending] of this.pending) {
      this.pending.delete(id);
      pending.reject(new VaultError("dpapi_closed", "The DPAPI bridge closed."));
    }
  }

  private async request(body: Record<string, string>): Promise<BridgeResponse> {
    await this.ensureReady();
    const child = this.child;
    if (!child) throw new VaultError("dpapi_closed", "The DPAPI bridge is not running.");
    const id = this.nextId;
    this.nextId += 1;
    const response = new Promise<BridgeResponse>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    child.stdin.write(`${JSON.stringify({ id, ...body })}\n`);
    const result = await response;
    if (!result.ok) {
      if (result.code === "reenter" || body.op === "get") throw new CredentialsNeedReentryError();
      throw new VaultError("dpapi_store", "Windows DPAPI or Credential Manager rejected the vault operation.");
    }
    return result;
  }

  private async ensureReady(): Promise<void> {
    if (this.ready) return this.ready;
    const scriptPath = bridgeScriptPath();
    if (!existsSync(scriptPath)) {
      writeFileSync(scriptPath, BRIDGE_BODY, "utf8");
    }
    const powershell = path.join(
      process.env.SystemRoot ?? "C:\\Windows",
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    );
    const child = spawn(
      powershell,
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptPath],
      { stdio: ["pipe", "pipe", "pipe"], windowsHide: true, shell: false },
    );
    this.child = child;
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      this.stderr = (this.stderr + chunk).slice(-4_000);
    });
    child.on("exit", () => {
      for (const [id, pending] of this.pending) {
        this.pending.delete(id);
        pending.reject(new VaultError("dpapi_closed", "The DPAPI bridge exited."));
      }
    });
    const lines = createInterface({ input: child.stdout });
    lines.on("line", (line) => {
      const trimmed = line.replace(/^\uFEFF/, "").trim();
      if (!trimmed.startsWith("{")) return;
      let parsed: BridgeResponse;
      try {
        parsed = JSON.parse(trimmed) as BridgeResponse;
      } catch (error) {
        if (error instanceof SyntaxError) return;
        throw error;
      }
      if (!("id" in parsed)) return;
      const pending = this.pending.get(parsed.id);
      if (!pending) return;
      this.pending.delete(parsed.id);
      pending.resolve(parsed);
    });
    this.ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new VaultError("dpapi_bridge", "Windows DPAPI bridge did not start."));
      }, 20_000);
      const onLine = (line: string) => {
        if (line.includes('"ready":true')) {
          clearTimeout(timer);
          lines.off("line", onLine);
          resolve();
        }
      };
      lines.on("line", onLine);
      child.on("exit", () => {
        clearTimeout(timer);
        reject(new VaultError("dpapi_bridge", "Windows DPAPI bridge exited during startup."));
      });
    });
    return this.ready;
  }
}

function bridgeScriptPath(): string {
  const digest = createHash("sha256").update(BRIDGE_BODY).digest("hex").slice(0, 16);
  return path.join(process.env.TEMP ?? process.env.TMP ?? "C:\\Windows\\Temp", `ef-harness-vault-bridge-${digest}.ps1`);
}

function assertTarget(target: string): void {
  if (!/^EFHarness:vault:[A-Za-z0-9._-]+$/.test(target)) {
    throw new VaultError("credential_target", "Refusing an unexpected Credential Manager target.");
  }
}

function assertOverflow(vaultDir: string, overflowPath: string): void {
  if (overflowPath.length === 0) return;
  const root = path.resolve(vaultDir);
  const target = path.resolve(overflowPath);
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new VaultError("overflow_path", "Refusing a ciphertext path outside the vault directory.");
  }
}

function onceExit(child: ChildProcessWithoutNullStreams): Promise<void> {
  return new Promise((resolve) => {
    child.once("exit", () => resolve());
  });
}
