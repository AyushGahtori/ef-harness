import crypto from "node:crypto";

export const TASK_PIPELINE = ["LEASED", "CODING", "STATIC_AUDIT", "CLEAN_VERIFY", "ACCEPTED"] as const;
export type PipelineState = (typeof TASK_PIPELINE)[number] | "PARKED";

export interface DiffLine {
  readonly kind: "meta" | "add" | "del" | "ctx" | "note";
  readonly text: string;
}

export interface DiffHunk {
  readonly index: number;
  readonly header: string;
  readonly lines: readonly DiffLine[];
}

export interface CheckRow {
  readonly id: "STATIC_AUDIT" | "CLEAN_VERIFY";
  readonly status: "pending" | "running" | "pass";
}

export interface TaskReceipt {
  readonly receiptId: string;
  readonly ref: string;
  readonly commit: string;
  readonly trailer: string;
  readonly checks: readonly CheckRow[];
}

export interface SandboxBadge {
  readonly tier: string;
  readonly enforced: false;
  readonly label: string;
}

export interface M1View {
  readonly projectId: string;
  readonly taskId: string;
  readonly brief: string;
  readonly state: PipelineState;
  readonly visited: readonly string[];
  readonly live: boolean;
  readonly ref: string;
  readonly commit: string | null;
  readonly trailer: string;
  readonly sandbox: SandboxBadge;
  readonly checks: readonly CheckRow[];
  readonly receipt: TaskReceipt | null;
  readonly diffFile: string;
  readonly connection: "connected" | "idle";
}

export interface DiffDocument {
  readonly file: string;
  readonly hunks: readonly DiffHunk[];
  readonly insertions: number;
  readonly deletions: number;
}

const ACCEPTED_COMMIT = "c0ffee067m1accepted0000000000000000000001";

export class SimulatedTask {
  private state: PipelineState = "LEASED";
  private visited: string[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private restored = false;
  private live = false;

  constructor(
    private readonly sandboxTier: string,
    private readonly diffNote: string,
    private readonly largeDiffBytes: number,
  ) {}

  restore(view: M1View): void {
    this.state = view.state;
    this.visited = [...view.visited];
    this.live = view.live;
    this.restored = true;
  }

  wasRestored(): boolean {
    return this.restored;
  }

  current(): PipelineState {
    return this.state;
  }

  isActive(): boolean {
    return this.live && this.state !== "ACCEPTED" && this.state !== "PARKED";
  }

  view(windows: number): M1View {
    const accepted = this.state === "ACCEPTED";
    const checks = checksFor(this.state);
    const ref = accepted ? "harness/f/F12" : "harness/t/T03";
    const commit = accepted ? ACCEPTED_COMMIT : null;
    const receipt = accepted
      ? {
          receiptId: "rcpt-T03",
          ref,
          commit: ACCEPTED_COMMIT,
          trailer: "Harness-Task: T03",
          checks,
        }
      : null;
    return {
      projectId: "m1",
      taskId: "T03",
      brief: "Map totals with toPrintRows",
      state: this.state,
      visited: [...this.visited],
      live: this.live,
      ref,
      commit,
      trailer: "Harness-Task: T03",
      sandbox: {
        tier: this.sandboxTier,
        enforced: false,
        label: `tier ${this.sandboxTier} · advisory`,
      },
      checks,
      receipt,
      diffFile: "src/print.ts",
      connection: windows > 0 ? "connected" : "idle",
    };
  }

  diff(): DiffDocument {
    if (this.largeDiffBytes > 0) {
      const line = `+${"x".repeat(64)}\n`;
      const copies = Math.ceil(this.largeDiffBytes / line.length);
      const text = line.repeat(copies).slice(0, this.largeDiffBytes);
      return {
        file: "src/print.ts",
        insertions: copies,
        deletions: 0,
        hunks: [{ index: 0, header: "@@ large candidate", lines: [{ kind: "add", text }] }],
      };
    }
    return {
      file: "src/print.ts",
      insertions: 3,
      deletions: 0,
      hunks: [
        {
          index: 0,
          header: "@@ -1,2 +1,4 @@ src/print.ts",
          lines: [
            { kind: "meta", text: "diff --git a/src/print.ts b/src/print.ts" },
            { kind: "meta", text: "--- a/src/print.ts" },
            { kind: "meta", text: "+++ b/src/print.ts" },
            { kind: "ctx", text: " export function heading() { return \"Kitchen\"; }" },
            { kind: "add", text: "+export function toPrintRows(orders) {" },
            { kind: "add", text: "+  return orders.map((order) => order.dish);" },
            { kind: "add", text: "+}" },
            { kind: "note", text: this.diffNote },
          ],
        },
      ],
    };
  }

  begin(stepMs: number, onChange: () => void): void {
    this.clear();
    if (!this.live || this.state === "PARKED") {
      this.state = "LEASED";
      this.visited = [];
    }
    this.live = true;
    if (!this.visited.includes(this.state)) this.visited.push(this.state);
    onChange();
    this.schedule(stepMs, onChange);
  }

  stop(): boolean {
    if (!this.isActive()) return false;
    this.clear();
    this.state = "PARKED";
    this.visited.push("PARKED");
    return true;
  }

  parkIfActive(): boolean {
    return this.stop();
  }

  clear(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(stepMs: number, onChange: () => void): void {
    if (!this.isActive()) return;
    const index = TASK_PIPELINE.indexOf(this.state as (typeof TASK_PIPELINE)[number]);
    if (index < 0 || index >= TASK_PIPELINE.length - 1) return;
    this.timer = setTimeout(() => {
      const next = TASK_PIPELINE[index + 1];
      if (!next) return;
      this.state = next;
      this.visited.push(next);
      onChange();
      this.schedule(stepMs, onChange);
    }, stepMs);
  }
}

function checksFor(state: PipelineState): CheckRow[] {
  if (state === "LEASED" || state === "CODING") {
    return [
      { id: "STATIC_AUDIT", status: "pending" },
      { id: "CLEAN_VERIFY", status: "pending" },
    ];
  }
  if (state === "STATIC_AUDIT") {
    return [
      { id: "STATIC_AUDIT", status: "running" },
      { id: "CLEAN_VERIFY", status: "pending" },
    ];
  }
  if (state === "CLEAN_VERIFY") {
    return [
      { id: "STATIC_AUDIT", status: "pass" },
      { id: "CLEAN_VERIFY", status: "running" },
    ];
  }
  if (state === "ACCEPTED") {
    return [
      { id: "STATIC_AUDIT", status: "pass" },
      { id: "CLEAN_VERIFY", status: "pass" },
    ];
  }
  return [
    { id: "STATIC_AUDIT", status: "pending" },
    { id: "CLEAN_VERIFY", status: "pending" },
  ];
}

export function isM1View(value: unknown): value is M1View {
  if (!value || typeof value !== "object") return false;
  const view = value as Partial<M1View>;
  return typeof view.taskId === "string" && typeof view.state === "string" && Array.isArray(view.visited) && typeof view.live === "boolean";
}

export function sha256(bytes: Uint8Array): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}
