export class AbortScope {
  private controller = new AbortController();
  private generation = 0;

  reset(): { signal: AbortSignal; generation: number } {
    this.controller.abort();
    this.controller = new AbortController();
    this.generation += 1;
    return this.current();
  }

  current(): { signal: AbortSignal; generation: number } {
    return { signal: this.controller.signal, generation: this.generation };
  }

  isCurrent(generation: number, signal: AbortSignal): boolean {
    return generation === this.generation && signal === this.controller.signal && !signal.aborted;
  }
}
