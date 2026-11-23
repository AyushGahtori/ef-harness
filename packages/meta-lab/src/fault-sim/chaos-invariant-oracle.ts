import type { ChaosInvariantSnapshot } from "./types.js";

/** Ten global post-chaos invariants asserted after every fault and recovery. */
export class ChaosInvariantOracle {
  assertAll(snapshot: ChaosInvariantSnapshot): string[] {
    const violations: string[] = [];
    if (snapshot.stateIntegrity !== "ok") {
      violations.push("state.db PRAGMA quick_check/integrity_check !== ok");
    }
    if (snapshot.globalIntegrity !== "ok") {
      violations.push("global.db PRAGMA quick_check/integrity_check !== ok");
    }
    if (snapshot.pathLeases > 0) {
      violations.push(`stranded path_leases=${snapshot.pathLeases}`);
    }
    if (snapshot.duplicateEffects > 0) {
      violations.push(`duplicate external effects=${snapshot.duplicateEffects}`);
    }
    if (snapshot.budgetOverruns > 0) {
      violations.push("budget overrun past 100%");
    }
    if (snapshot.leakedChildPids > 0) {
      violations.push(`leaked child PIDs=${snapshot.leakedChildPids}`);
    }
    if (snapshot.watcherHandles > 0) {
      violations.push(`unclosed watcher handles=${snapshot.watcherHandles}`);
    }
    if (snapshot.plaintextSecrets > 0) {
      violations.push("plaintext secret in storage");
    }
    if (snapshot.silentStashes > 0) {
      violations.push(`silent git stash entries=${snapshot.silentStashes}`);
    }
    if (!snapshot.parkedOrProgressing) {
      violations.push("no forward progress and no honest park card");
    }
    return violations;
  }

  passed(snapshot: ChaosInvariantSnapshot): boolean {
    return this.assertAll(snapshot).length === 0;
  }
}