const PORT_FLOOR = 41_000;
const PORT_CEILING = 48_999;

export class MachinePortLeasePool {
  private readonly allocated = new Map<string, number>();

  assign(projectId: string, purpose: string): number {
    const key = `${projectId}:${purpose}`;
    const existing = this.allocated.get(key);
    if (existing !== undefined) return existing;
    const used = new Set(this.allocated.values());
    for (let port = PORT_FLOOR; port <= PORT_CEILING; port += 1) {
      if (!used.has(port)) {
        this.allocated.set(key, port);
        return port;
      }
    }
    throw new Error("port_leases exhausted inside 41000–48999");
  }

  snapshot(): readonly { projectId: string; purpose: string; port: number }[] {
    return [...this.allocated.entries()].map(([key, port]) => {
      const split = key.indexOf(":");
      return { projectId: key.slice(0, split), purpose: key.slice(split + 1), port };
    });
  }

  assertDistinct(): void {
    const ports = [...this.allocated.values()];
    if (new Set(ports).size !== ports.length) throw new Error("EADDRINUSE: duplicate port lease");
  }
}