import { spawn, type ChildProcess } from "node:child_process";

export type LiveOpenResult = LiveCliTransport | { readonly missing: true; readonly reason: string };

interface PendingReply {
  readonly resolve: (value: Record<string, string | number | boolean>) => void;
  readonly reject: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

/**
 * Speaks a one-line JSON protocol with a real CLI process.
 * The conformance tests use a local Node double so live mode stays at zero token cost.
 */
export class LiveCliTransport {
  private nextId = 1;
  private buffer = "";
  private readonly pending = new Map<number, PendingReply>();

  private constructor(private readonly child: ChildProcess) {
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      this.onData(chunk);
    });
    child.once("error", (error) => {
      this.failAll(error instanceof Error ? error.message : "live CLI failed");
    });
    child.once("exit", () => {
      this.failAll("live CLI exited");
    });
  }

  static open(command: string, args: readonly string[]): Promise<LiveOpenResult> {
    if (command.trim().length === 0) {
      return Promise.resolve({ missing: true, reason: "CLI binary is not installed" });
    }
    return new Promise((resolve) => {
      let settled = false;
      const child = spawn(command, [...args], {
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
      const finish = (result: LiveOpenResult): void => {
        if (settled) return;
        settled = true;
        resolve(result);
      };
      child.once("error", (error) => {
        const reason = error instanceof Error ? error.message : "CLI binary is not installed";
        finish({ missing: true, reason });
      });
      child.once("spawn", () => {
        finish(new LiveCliTransport(child));
      });
    });
  }

  request(op: string, extra: Readonly<Record<string, string>>): Promise<Record<string, string | number | boolean>> {
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`live CLI timed out on ${op}`));
      }, 10_000);
      this.pending.set(id, { resolve, reject, timer });
      const payload = JSON.stringify({ id, op, ...extra });
      this.child.stdin?.write(`${payload}\n`);
    });
  }

  async close(): Promise<void> {
    this.failAll("live CLI closed");
    if (this.child.exitCode !== null || this.child.signalCode !== null) return;
    this.child.kill("SIGKILL");
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => resolve(), 500);
      this.child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    let newline = this.buffer.indexOf("\n");
    while (newline >= 0) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (line.length > 0) this.consume(line);
      newline = this.buffer.indexOf("\n");
    }
  }

  private consume(line: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line) as unknown;
    } catch (error) {
      void error;
      return;
    }
    if (!parsed || typeof parsed !== "object") return;
    const record = parsed as Record<string, unknown>;
    const id = typeof record.id === "number" ? record.id : -1;
    const pending = this.pending.get(id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(id);
    const body: Record<string, string | number | boolean> = {};
    for (const [key, value] of Object.entries(record)) {
      if (key === "id") continue;
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        body[key] = value;
      }
    }
    pending.resolve(body);
  }

  private failAll(message: string): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      this.pending.delete(id);
      pending.reject(new Error(message));
    }
  }
}
