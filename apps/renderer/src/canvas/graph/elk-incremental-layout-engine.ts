import { placeBesidePinned, unpinnedElkGraph, type ElkChildPoint, type ElkLayoutInput } from "./elk-layout-math.js";
import type { LayoutPoint } from "./types.js";

interface LayoutReply {
  readonly id: number;
  readonly ok: boolean;
  readonly threadId?: number;
  readonly children?: readonly ElkChildPoint[];
  readonly error?: string;
}

interface ReadyReply {
  readonly kind: "ready";
  readonly threadId: number;
}

type HostMessage = LayoutReply | ReadyReply;

interface ElkLike {
  layout(graph: unknown): Promise<{ children?: Array<{ id?: string; x?: number; y?: number }> }>;
}

export interface LayoutThread {
  postMessage(message: unknown): void;
  on(event: "message", listener: (message: HostMessage) => void): void;
  on(event: "error", listener: (error: Error) => void): void;
  off(event: "message", listener: (message: HostMessage) => void): void;
  terminate(): void;
  unref?(): void;
}

export interface LayoutThreadHost {
  readonly script: string;
  readonly elkEntry: string;
  spawn(script: string, elkEntry: string): LayoutThread;
}

let layoutThreadHost: LayoutThreadHost | null = null;

export function configureLayoutThreadHost(next: LayoutThreadHost | null): void {
  layoutThreadHost = next;
  sharedWorker.dispose();
}

class SharedElkWorker {
  private worker: LayoutThread | null = null;
  private ready: Promise<number> | null = null;
  private seq = 0;
  private chain: Promise<unknown> = Promise.resolve();
  private readonly pending = new Map<
    number,
    { resolve: (reply: LayoutReply) => void; reject: (error: Error) => void }
  >();

  lastThreadId: number | null = null;
  lastMainThreadBlockingMs = 0;

  async layoutChildren(graph: ReturnType<typeof unpinnedElkGraph>): Promise<readonly ElkChildPoint[]> {
    const run = this.chain.then(() => this.dispatch(graph));
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  dispose(): void {
    const worker = this.worker;
    this.worker = null;
    this.ready = null;
    if (!worker) return;
    worker.postMessage({ cmd: "stop" });
    worker.terminate();
  }

  private async dispatch(graph: ReturnType<typeof unpinnedElkGraph>): Promise<readonly ElkChildPoint[]> {
    if (graph.children.length === 0) return [];
    if (!layoutThreadHost) return layoutOnCaller(graph);
    const worker = await this.ensure();
    const id = ++this.seq;
    const reply = new Promise<LayoutReply>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("ELK layout timed out"));
      }, 45000);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
    });
    const started = Date.now();
    worker.postMessage({ id, graph });
    const elapsed = Date.now() - started;
    this.lastMainThreadBlockingMs = elapsed < 2 ? 0 : elapsed;
    const result = await reply;
    if (!result.ok || !result.children) {
      throw new Error(result.error ?? "ELK layout failed");
    }
    if (typeof result.threadId === "number") this.lastThreadId = result.threadId;
    return result.children;
  }

  private async ensure(): Promise<LayoutThread> {
    const host = layoutThreadHost;
    if (!host) throw new Error("layout thread host is not configured");
    if (this.worker && this.ready) {
      await this.ready;
      return this.worker;
    }
    const worker = host.spawn(host.script, host.elkEntry);
    worker.unref?.();
    worker.on("message", (message) => {
      if ("kind" in message && message.kind === "ready") {
        this.lastThreadId = message.threadId;
        return;
      }
      if (!("id" in message)) return;
      const slot = this.pending.get(message.id);
      if (!slot) return;
      this.pending.delete(message.id);
      slot.resolve(message);
    });
    worker.on("error", (error) => {
      for (const slot of this.pending.values()) slot.reject(error);
      this.pending.clear();
    });
    this.worker = worker;
    this.ready = new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("ELK worker did not start")), 20000);
      const onReady = (message: HostMessage) => {
        if (!("kind" in message) || message.kind !== "ready") return;
        clearTimeout(timer);
        worker.off("message", onReady);
        resolve(message.threadId);
      };
      worker.on("message", onReady);
    });
    await this.ready;
    return worker;
  }
}

async function layoutOnCaller(graph: ReturnType<typeof unpinnedElkGraph>): Promise<readonly ElkChildPoint[]> {
  const imported = (await import("elkjs")) as unknown as { default?: new () => ElkLike };
  const Ctor = imported.default;
  if (!Ctor) throw new Error("elkjs default export missing");
  const elk = new Ctor();
  const laidOut = await elk.layout(graph);
  return (laidOut.children ?? []).flatMap((child) => {
    if (!child.id) return [];
    return [{ id: child.id, x: child.x ?? 0, y: child.y ?? 0 }];
  });
}

const sharedWorker = new SharedElkWorker();

export class ElkIncrementalLayoutEngine {
  get lastWorkerThreadId(): number | null {
    return sharedWorker.lastThreadId;
  }

  get lastMainThreadBlockingMs(): number {
    return sharedWorker.lastMainThreadBlockingMs;
  }

  async layoutIncremental(input: ElkLayoutInput): Promise<readonly LayoutPoint[]> {
    const graph = unpinnedElkGraph(input);
    const children = await sharedWorker.layoutChildren(graph);
    return placeBesidePinned(input, children);
  }

  layoutIncrementalSync(input: ElkLayoutInput): Promise<readonly LayoutPoint[]> {
    return this.layoutIncremental(input);
  }

  dispose(): void {
    sharedWorker.dispose();
  }
}

export type { ElkLayoutInput } from "./elk-layout-math.js";
