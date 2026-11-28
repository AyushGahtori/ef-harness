import type { ElkLayoutInput } from "./elk-incremental-layout-engine.js";
import { ElkIncrementalLayoutEngine } from "./elk-incremental-layout-engine.js";
import type { LayoutPoint } from "./types.js";

export interface LayoutWorkerClient {
  layout(input: ElkLayoutInput): Promise<readonly LayoutPoint[]>;
  dispose(): void;
}

class SyncLayoutWorkerClient implements LayoutWorkerClient {
  private readonly engine = new ElkIncrementalLayoutEngine();

  layout(input: ElkLayoutInput): Promise<readonly LayoutPoint[]> {
    return this.engine.layoutIncremental(input);
  }

  dispose(): void {
    this.engine.dispose();
  }
}

type WorkerReply =
  | { readonly kind: "layout_result"; readonly points: readonly LayoutPoint[] }
  | { readonly kind: "layout_error"; readonly message: string };

type BrowserWorker = {
  postMessage: (msg: unknown) => void;
  terminate: () => void;
  addEventListener: (type: string, listener: (event: { data: WorkerReply & { id: number } }) => void) => void;
};

/**
 * Browser builds should prefer the dedicated Web Worker so 300+ node ELK
 * never blocks the 60fps UI thread. Vitest and SSR use the sync fallback.
 */
export function createLayoutWorkerClient(preferWorker: boolean): LayoutWorkerClient {
  const WorkerCtor = (globalThis as { Worker?: new (url: URL, options?: { type?: string }) => BrowserWorker })
    .Worker;
  const canUseWorker = preferWorker && typeof WorkerCtor === "function";
  if (!canUseWorker) return new SyncLayoutWorkerClient();

  const worker = new WorkerCtor(new URL("./elk-layout.worker.js", import.meta.url), { type: "module" });
  let seq = 0;
  const pending = new Map<
    number,
    { resolve: (pts: readonly LayoutPoint[]) => void; reject: (err: Error) => void }
  >();

  worker.addEventListener("message", (event: { data: WorkerReply & { id: number } }) => {
    const slot = pending.get(event.data.id);
    if (!slot) return;
    pending.delete(event.data.id);
    if (event.data.kind === "layout_result") slot.resolve(event.data.points);
    else slot.reject(new Error(event.data.message));
  });

  return {
    layout(input: ElkLayoutInput): Promise<readonly LayoutPoint[]> {
      const id = ++seq;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        worker.postMessage({ id, input });
      });
    },
    dispose(): void {
      worker.terminate();
      pending.clear();
    },
  };
}