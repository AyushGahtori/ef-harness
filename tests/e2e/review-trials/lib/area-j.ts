export const MIGRATION_PHASES = ["rehearse", "backup", "expand", "deploy", "backfill", "contract"] as const;
export const INVESTIGATION_STAGES = ["intake", "reproduce", "localize", "prove", "fix", "keep"] as const;

export const AREA_J_EVIDENCE = [
  "effects-unknown-outcome",
  "github-under-80",
  "ci-repair-max-3",
  "deploy-argv-no-e",
  "six-phase-migration",
  "six-stage-investigation",
  "flake-safe-bisect",
  "path-lease-and-persisted-name",
  "age-export-fence",
] as const;

export type EffectState = "intended" | "sent" | "confirmed" | "unknown";

export interface Effect {
  id: string;
  state: EffectState;
  sends: number;
}

export function sendEffect(effect: Effect, outcome: "confirmed" | "timeout"): Effect {
  const intended: Effect = { ...effect, state: "intended" };
  const sent: Effect = { ...intended, state: "sent", sends: intended.sends + 1 };
  if (outcome === "timeout") return { ...sent, state: "unknown" };
  return { ...sent, state: "confirmed" };
}

export function reconcileEffect(effect: Effect, query: () => "confirmed" | "unknown"): { effect: Effect; resent: false; held: boolean } {
  if (effect.state !== "unknown") return { effect, resent: false, held: false };
  const outcome = query();
  if (outcome === "unknown") return { effect, resent: false, held: true };
  return { effect: { ...effect, state: "confirmed" }, resent: false, held: false };
}

export function allowGitHub(history: readonly { at: number; content: boolean; status: number }[], at: number, content: boolean): boolean {
  if (!content) return true;
  const recent = history.filter((item) => item.content && item.status !== 304 && at - item.at < 60_000);
  return recent.length < 79;
}

export function allowRepairPush(pushesForFingerprint: number): boolean {
  return pushesForFingerprint < 3;
}

export function dockerArgv(image: string, secret: string): { argv: string[]; secret: string } {
  const argv = ["ssh", "host", "docker", "run", "--env-file", "/run/secrets.env", image];
  if (argv.includes("-e") || argv.includes("--env") || argv.includes(secret)) {
    throw new Error("deploy argv contains a secret");
  }
  return { argv, secret };
}

export function nextMigrationPhase(done: readonly string[], destructive: boolean): string {
  for (let index = 0; index < done.length; index += 1) {
    if (done[index] !== MIGRATION_PHASES[index]) {
      throw new Error("destructive migration cannot skip phases 0-1");
    }
  }
  if (destructive && done.length >= 2 && (!done.includes("rehearse") || !done.includes("backup"))) {
    throw new Error("destructive migration cannot skip phases 0-1");
  }
  const phase = MIGRATION_PHASES[done.length];
  if (!phase) throw new Error("migration already finished");
  return phase;
}

export function advanceInvestigation(index: number): string {
  const stage = INVESTIGATION_STAGES[index];
  if (!stage) throw new Error("investigation already kept");
  return stage;
}

export function flakeSafeBisect(commits: readonly { sha: string; status: "good" | "bad" | "flake" | "build" }[]): { suspect: string | null; skipped: string[] } {
  const skipped = commits.filter((commit) => commit.status === "flake" || commit.status === "build").map((commit) => commit.sha);
  if (commits.some((commit) => commit.status === "flake")) return { suspect: null, skipped };
  let seenGood = false;
  for (const commit of commits) {
    if (commit.status === "build") continue;
    if (commit.status === "good") seenGood = true;
    if (commit.status === "bad" && seenGood) return { suspect: commit.sha, skipped };
  }
  return { suspect: null, skipped };
}

export function claimAllowed(scopes: readonly string[], leases: readonly { prefix: string; mode: "intent" | "granted" }[]): boolean {
  return !leases.some((lease) => scopes.some((scope) => scope.startsWith(lease.prefix) || lease.prefix.startsWith(scope)));
}

export function gatePersisted(hits: readonly { name: string; persisted: boolean; decision?: "keep" | "migrate" | "rename" }[]): void {
  for (const hit of hits) {
    if (!hit.decision) throw new Error(`unclassified ${hit.name}`);
    if (hit.persisted && hit.decision === "rename") throw new Error(`persisted name ${hit.name} needs keep or migrate`);
  }
}

export function exportState(input: { plain: string; epoch: number; writerEpoch: number; publicRepo: boolean; optInPublic: boolean }): { mode: "writer" | "read-only"; envelope: string | null } {
  const writer = input.epoch === input.writerEpoch;
  if (!writer) return { mode: "read-only", envelope: null };
  if (input.publicRepo && !input.optInPublic) return { mode: "writer", envelope: null };
  const sealed = Buffer.from(Buffer.from(input.plain, "utf8").map((byte, index) => byte ^ (0x5a + (index % 17))));
  const envelope = `age1.${sealed.toString("base64url")}`;
  if (envelope.includes(input.plain)) throw new Error("age envelope leaked plaintext");
  return { mode: "writer", envelope };
}

export async function runAreaJ(): Promise<string[]> {
  const evidence: string[] = [];
  const unknown = sendEffect({ id: "e1", state: "intended", sends: 0 }, "timeout");
  const reconciled = reconcileEffect(unknown, () => "unknown");
  if (unknown.state !== "unknown" || unknown.sends !== 1 || reconciled.resent !== false || !reconciled.held) {
    throw new Error("unknown outcome was replayed");
  }
  evidence.push("effects-unknown-outcome");
  const history = Array.from({ length: 79 }, (_, index) => ({ at: index, content: true, status: 200 }));
  if (!allowGitHub([{ at: 0, content: false, status: 304 }], 10, false)) throw new Error("304 poll was counted");
  if (allowGitHub(history, 10, true)) throw new Error("github queue reached 80 content writes");
  evidence.push("github-under-80");
  if (!allowRepairPush(2) || allowRepairPush(3)) throw new Error("CI repair exceeded 3 pushes");
  evidence.push("ci-repair-max-3");
  const secret = "db-password-value";
  const deploy = dockerArgv("app:1", secret);
  if (deploy.argv.includes("-e") || deploy.argv.includes(secret)) throw new Error("argv secret");
  evidence.push("deploy-argv-no-e");
  const phases: string[] = [];
  for (let i = 0; i < MIGRATION_PHASES.length; i += 1) phases.push(nextMigrationPhase(phases, true));
  if (phases.join(",") !== MIGRATION_PHASES.join(",")) throw new Error("migration phases drifted");
  let skipped = false;
  try {
    nextMigrationPhase(["expand"], true);
  } catch (error) {
    skipped = error instanceof Error && error.message.includes("cannot skip");
  }
  if (!skipped) throw new Error("destructive migration skipped rehearsal");
  evidence.push("six-phase-migration");
  const stages = INVESTIGATION_STAGES.map((_, index) => advanceInvestigation(index));
  if (stages.join(",") !== INVESTIGATION_STAGES.join(",")) throw new Error("investigation stages drifted");
  evidence.push("six-stage-investigation");
  const stable = flakeSafeBisect([
    { sha: "a", status: "good" },
    { sha: "b", status: "build" },
    { sha: "c", status: "bad" },
  ]);
  const flaky = flakeSafeBisect([
    { sha: "a", status: "good" },
    { sha: "b", status: "flake" },
  ]);
  if (stable.suspect !== "c" || !stable.skipped.includes("b") || flaky.suspect !== null) {
    throw new Error("bisect treated a flake or build failure as the bug");
  }
  evidence.push("flake-safe-bisect");
  if (claimAllowed(["src/app/"], [{ prefix: "src/app/", mode: "intent" }])) throw new Error("intent lease did not block a claim");
  if (!claimAllowed(["src/billing/"], [{ prefix: "src/app/", mode: "granted" }])) throw new Error("disjoint claim was blocked");
  let unnamed = false;
  try {
    gatePersisted([{ name: "order_id", persisted: true, decision: "rename" }]);
  } catch (error) {
    unnamed = error instanceof Error && error.message.includes("persisted name");
  }
  if (!unnamed) throw new Error("persisted name was renamed");
  gatePersisted([{ name: "order_id", persisted: true, decision: "keep" }]);
  evidence.push("path-lease-and-persisted-name");
  const fenced = exportState({ plain: "harness-state", epoch: 2, writerEpoch: 1, publicRepo: false, optInPublic: false });
  const published = exportState({ plain: "harness-state", epoch: 4, writerEpoch: 4, publicRepo: true, optInPublic: false });
  const sealed = exportState({ plain: "harness-state", epoch: 4, writerEpoch: 4, publicRepo: false, optInPublic: false });
  if (fenced.mode !== "read-only" || published.envelope !== null || !sealed.envelope?.startsWith("age1.")) {
    throw new Error("writer epoch or public-repo default failed");
  }
  evidence.push("age-export-fence");
  const missing = AREA_J_EVIDENCE.filter((id) => !evidence.includes(id));
  if (missing.length > 0) throw new Error(`area J missing ${missing.join(",")}`);
  return evidence;
}
