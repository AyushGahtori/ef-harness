import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TierCLaunchError } from "./errors.js";

export interface BrokerResult {
  readonly ok: boolean;
  readonly error?: string;
  readonly exitCode?: number;
  readonly pid?: number;
  readonly timedOut?: boolean;
  readonly capabilitySid?: string;
  readonly drive?: string;
}

function brokerScriptPath(): string {
  return fileURLToPath(new URL("./tier-c-broker.ps1", import.meta.url));
}

function powershellPath(): string {
  const root = process.env.SystemRoot ?? "C:\\Windows";
  return path.join(root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
}

export interface TierCBrokerApi {
  prepare(input: { readonly worktree: string; readonly temp: string; readonly capabilitySid: string }): Promise<BrokerResult>;
  classify(target: string): Promise<BrokerResult>;
  launch(input: {
    readonly capabilitySid: string;
    readonly suspend: boolean;
    readonly pidFile: string;
    readonly controlFile: string;
    readonly executable: string;
    readonly commandLine: string;
    readonly cwd: string;
    readonly envText: string;
    readonly timeoutMs: number;
  }): Promise<BrokerResult>;
}

export class TierCBroker implements TierCBrokerApi {
  constructor(private readonly scriptPath = brokerScriptPath()) {}

  prepare(input: { readonly worktree: string; readonly temp: string; readonly capabilitySid: string }): Promise<BrokerResult> {
    return this.invoke({
      action: "prepare",
      worktree: input.worktree,
      temp: input.temp,
      capabilitySid: input.capabilitySid,
    });
  }

  classify(target: string): Promise<BrokerResult> {
    return this.invoke({ action: "classify", path: target });
  }

  launch(input: {
    readonly capabilitySid: string;
    readonly suspend: boolean;
    readonly pidFile: string;
    readonly controlFile: string;
    readonly executable: string;
    readonly commandLine: string;
    readonly cwd: string;
    readonly envText: string;
    readonly timeoutMs: number;
  }): Promise<BrokerResult> {
    return this.invoke({
      action: "launch",
      capabilitySid: input.capabilitySid,
      suspend: input.suspend,
      pidFile: input.pidFile,
      controlFile: input.controlFile,
      executable: input.executable,
      commandLine: input.commandLine,
      cwd: input.cwd,
      envB64: Buffer.from(input.envText, "utf8").toString("base64"),
      timeoutMs: input.timeoutMs,
    });
  }

  private invoke(request: Record<string, unknown>): Promise<BrokerResult> {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ef-tierc-broker-"));
    const requestPath = path.join(directory, "request.json");
    const resultPath = path.join(directory, "result.json");
    fs.writeFileSync(requestPath, JSON.stringify(request));
    const timeoutMs = typeof request.timeoutMs === "number" ? request.timeoutMs + 20_000 : 30_000;
    return new Promise((resolve, reject) => {
      const child = spawn(
        powershellPath(),
        [
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          this.scriptPath,
          "-RequestPath",
          requestPath,
          "-ResultPath",
          resultPath,
        ],
        { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
      );
      let stderr = "";
      child.stderr?.setEncoding("utf8");
      child.stderr?.on("data", (chunk: string) => {
        stderr += chunk;
      });
      const timer = setTimeout(() => {
        child.kill();
      }, timeoutMs);
      child.on("error", (error) => {
        clearTimeout(timer);
        reject(new TierCLaunchError(`Tier C broker failed to start: ${error.message}`));
      });
      child.on("close", () => {
        clearTimeout(timer);
        try {
          if (!fs.existsSync(resultPath)) {
            reject(new TierCLaunchError(`Tier C broker produced no result. ${stderr.trim()}`));
            return;
          }
          const parsed = JSON.parse(fs.readFileSync(resultPath, "utf8")) as BrokerResult;
          resolve(parsed);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          reject(new TierCLaunchError(message));
        } finally {
          fs.rmSync(directory, { recursive: true, force: true });
        }
      });
    });
  }
}
