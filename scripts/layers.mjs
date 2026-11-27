/**
 * Frozen workspace layout established by Task 001.
 * A package may import only from a strictly lower DAG_RANK.
 * Packages with layer < 5 are the 28 library packages.
 */
export const PACKAGE_LAYOUT = [
  ["shared-contracts", 0, "packages/shared-contracts"],
  ["shared-observability", 0, "packages/shared-observability"],
  ["db", 1, "packages/db"],
  ["ipc", 1, "packages/ipc"],
  ["sim", 1, "packages/sim"],
  ["git-engine", 1, "packages/git-engine"],
  ["sandbox", 1, "packages/sandbox"],
  ["mcp-server", 1, "packages/mcp-server"],
  ["test-env", 1, "packages/test-env"],
  ["worker-loop", 2, "packages/worker-loop"],
  ["completeness-gate", 2, "packages/completeness-gate"],
  ["verifier", 2, "packages/verifier"],
  ["discovery", 2, "packages/discovery"],
  ["spec-expansion", 2, "packages/spec-expansion"],
  ["research-engine", 2, "packages/research-engine"],
  ["intake", 2, "packages/intake"],
  ["dictation", 2, "packages/dictation"],
  ["brownfield", 2, "packages/brownfield"],
  ["planner", 3, "packages/planner"],
  ["integrator", 3, "packages/integrator"],
  ["steering", 3, "packages/steering"],
  ["governor", 3, "packages/governor"],
  ["providers", 3, "packages/providers"],
  ["runtime-adapters", 3, "packages/runtime-adapters"],
  ["ship-deploy", 4, "packages/ship-deploy"],
  ["investigations", 4, "packages/investigations"],
  ["portability", 4, "packages/portability"],
  ["meta-lab", 4, "packages/meta-lab"],
  ["daemon", 5, "apps/daemon"],
  ["desktop", 5, "apps/desktop"],
  ["renderer", 5, "apps/renderer"],
  ["spikes", 5, "spikes"],
  ["corpus", 5, "corpus"],
  ["benchmarks", 5, "benchmarks"],
  ["e2e", 5, "tests/e2e"],
];

/** @type {Record<string, number>} */
export const LAYERS = Object.fromEntries(PACKAGE_LAYOUT.map(([id, layer]) => [id, layer]));

/**
 * Strict topological ordering for intra-tier acyclic workspace imports (F-001).
 * @type {Record<string, number>}
 */
export const DAG_RANK = {
  "shared-contracts": 0,
  "shared-observability": 1,
  db: 2,
  "git-engine": 3,
  ipc: 4,
  sandbox: 5,
  "test-env": 6,
  "mcp-server": 7,
  sim: 8,
  "completeness-gate": 9,
  "worker-loop": 10,
  verifier: 11,
  corpus: 12,
  discovery: 13,
  "spec-expansion": 14,
  "research-engine": 15,
  intake: 16,
  brownfield: 17,
  dictation: 18,
  planner: 19,
  governor: 20,
  providers: 21,
  integrator: 22,
  steering: 23,
  "runtime-adapters": 24,
  "ship-deploy": 25,
  investigations: 26,
  portability: 27,
  "meta-lab": 28,
  daemon: 29,
  desktop: 30,
  renderer: 31,
  spikes: 32,
  benchmarks: 33,
  e2e: 34,
};

/** @type {Record<string, string>} */
export const PACKAGE_DIRS = Object.fromEntries(PACKAGE_LAYOUT.map(([id, , dir]) => [id, dir]));

export const LIBRARY_PACKAGE_IDS = PACKAGE_LAYOUT.filter(([, layer]) => layer < 5).map(([id]) => id);

export function scopedPackageName(id) {
  return `@ef-harness/${id}`;
}
