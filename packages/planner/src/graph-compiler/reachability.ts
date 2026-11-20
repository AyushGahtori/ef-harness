export interface DirectedEdge {
  readonly from: string;
  readonly to: string;
}

export interface OrderingIndex {
  reaches(from: string, to: string): boolean;
}

function bitsetWords(size: number): number {
  return Math.ceil(size / 32);
}

function setBit(words: Uint32Array, index: number): void {
  const slot = index >>> 5;
  const current = words[slot] ?? 0;
  words[slot] = current | (1 << (index & 31));
}

function hasBit(words: Uint32Array, index: number): boolean {
  const slot = index >>> 5;
  const current = words[slot] ?? 0;
  return (current & (1 << (index & 31))) !== 0;
}

function orInto(target: Uint32Array, source: Uint32Array): void {
  for (let i = 0; i < target.length; i += 1) {
    target[i] = (target[i] ?? 0) | (source[i] ?? 0);
  }
}

export function buildOrderingIndex(ids: readonly string[], edges: readonly DirectedEdge[]): OrderingIndex {
  const indexOf = new Map<string, number>();
  ids.forEach((id, index) => {
    indexOf.set(id, index);
  });
  const adjacency: number[][] = ids.map(() => []);
  for (const edge of edges) {
    const from = indexOf.get(edge.from);
    const to = indexOf.get(edge.to);
    if (from === undefined || to === undefined) continue;
    adjacency[from]?.push(to);
  }
  const words = bitsetWords(ids.length);
  const bitsets = ids.map(() => new Uint32Array(words));
  const state = new Uint8Array(ids.length);
  const visit = (node: number): void => {
    if (state[node] === 2) return;
    if (state[node] === 1) return;
    state[node] = 1;
    for (const next of adjacency[node] ?? []) {
      visit(next);
      const own = bitsets[node];
      const child = bitsets[next];
      if (own && child) orInto(own, child);
      if (own) setBit(own, next);
    }
    state[node] = 2;
  };
  for (let node = 0; node < ids.length; node += 1) visit(node);
  return {
    reaches(from: string, to: string): boolean {
      const start = indexOf.get(from);
      const goal = indexOf.get(to);
      if (start === undefined || goal === undefined) return false;
      const bits = bitsets[start];
      return bits ? hasBit(bits, goal) : false;
    },
  };
}

export function findCyclePaths(ids: readonly string[], edges: readonly DirectedEdge[]): string[][] {
  const adjacency = new Map<string, string[]>();
  for (const id of ids) adjacency.set(id, []);
  for (const edge of edges) {
    if (!adjacency.has(edge.from) || !adjacency.has(edge.to)) continue;
    adjacency.get(edge.from)?.push(edge.to);
  }
  for (const list of adjacency.values()) list.sort((a, b) => a.localeCompare(b));
  const color = new Map<string, number>();
  const stack: string[] = [];
  const seen = new Set<string>();
  const cycles: string[][] = [];
  const record = (start: string): void => {
    const at = stack.indexOf(start);
    if (at < 0) return;
    const body = stack.slice(at);
    let minAt = 0;
    for (let i = 1; i < body.length; i += 1) {
      const current = body[i] ?? "";
      const best = body[minAt] ?? "";
      if (current < best) minAt = i;
    }
    const rotated = body.slice(minAt).concat(body.slice(0, minAt));
    const key = rotated.join("\u2192");
    if (seen.has(key)) return;
    seen.add(key);
    cycles.push([...rotated, rotated[0] ?? start]);
  };
  const visit = (id: string): void => {
    color.set(id, 1);
    stack.push(id);
    for (const next of adjacency.get(id) ?? []) {
      const tone = color.get(next) ?? 0;
      if (tone === 0) visit(next);
      else if (tone === 1) record(next);
    }
    stack.pop();
    color.set(id, 2);
  };
  for (const id of [...ids].sort((a, b) => a.localeCompare(b))) {
    if ((color.get(id) ?? 0) === 0) visit(id);
  }
  cycles.sort((a, b) => a.join("\u2192").localeCompare(b.join("\u2192")));
  return cycles;
}

export function tasksAreConcurrent(
  leftId: string,
  leftFeature: string,
  rightId: string,
  rightFeature: string,
  tasks: OrderingIndex,
  features: OrderingIndex,
): boolean {
  if (leftId === rightId) return false;
  if (tasks.reaches(leftId, rightId) || tasks.reaches(rightId, leftId)) return false;
  if (leftFeature !== rightFeature) {
    if (features.reaches(leftFeature, rightFeature) || features.reaches(rightFeature, leftFeature)) {
      return false;
    }
  }
  return true;
}
