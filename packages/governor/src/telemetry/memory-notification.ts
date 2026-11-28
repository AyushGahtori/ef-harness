export interface LowMemorySource {
  watch(onSignal: (signaled: boolean) => void): () => void;
}

export class ManualLowMemorySource implements LowMemorySource {
  private readonly listeners = new Set<(signaled: boolean) => void>();

  watch(onSignal: (signaled: boolean) => void): () => void {
    this.listeners.add(onSignal);
    return () => {
      this.listeners.delete(onSignal);
    };
  }

  emit(signaled: boolean): void {
    for (const listener of this.listeners) listener(signaled);
  }
}

export class MemoryNotificationWatcher {
  private signaled = false;
  private stopWatch: (() => void) | null = null;
  private readonly listeners = new Set<(signaled: boolean) => void>();

  constructor(private readonly source: LowMemorySource) {}

  start(): void {
    this.stop();
    this.stopWatch = this.source.watch((signaled) => {
      this.signaled = signaled;
      if (!signaled) return;
      for (const listener of this.listeners) listener(true);
    });
  }

  isSignaled(): boolean {
    return this.signaled;
  }

  onLowMemory(listener: (signaled: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  stop(): void {
    this.stopWatch?.();
    this.stopWatch = null;
  }
}
