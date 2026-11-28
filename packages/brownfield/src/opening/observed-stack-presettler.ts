import type { L0StackSnapshot } from "./contracts.js";
import type { ObservedCriterionSettlement, StackCriterionId } from "./types.js";

const GREENFIELD_STACK_CRITERIA: readonly StackCriterionId[] = [
  "stack.language",
  "stack.framework",
  "stack.db_engine",
  "stack.auth_library",
  "stack.css_system",
  "stack.test_runner",
];

function pickFirst(values: readonly string[]): string | null {
  return values[0] ?? null;
}

function detectAuth(frameworks: readonly string[], snapshot: L0StackSnapshot): string | null {
  const fromAuth = pickFirst(snapshot.authLibraries);
  if (fromAuth) return fromAuth;
  if (frameworks.includes("next")) return "next-auth";
  return null;
}

function detectDb(orms: readonly string[]): string | null {
  if (orms.some((o) => /prisma/i.test(o))) return "postgresql (prisma)";
  if (orms.some((o) => /drizzle/i.test(o))) return "postgresql (drizzle)";
  if (orms.some((o) => /sqlite/i.test(o))) return "sqlite";
  return pickFirst(orms);
}

function detectCss(uiKits: readonly string[]): string | null {
  if (uiKits.includes("tailwindcss")) return "tailwindcss";
  return pickFirst(uiKits);
}

export class ObservedStackPresettler {
  buildSettlements(snapshot: L0StackSnapshot): readonly ObservedCriterionSettlement[] {
    const frameworks = snapshot.frameworks.map((f) => f.toLowerCase());
    const settlements: ObservedCriterionSettlement[] = [];

    if (snapshot.languagePrimary) {
      settlements.push({
        criterionId: "stack.language",
        value: snapshot.languagePrimary,
        basis: "observed",
        evidence: snapshot.configFiles.filter((p) => /tsconfig|pyproject|go\.mod|Cargo/i.test(p)),
      });
    }

    const framework = pickFirst(frameworks);
    if (framework) {
      settlements.push({
        criterionId: "stack.framework",
        value: framework,
        basis: "observed",
        evidence: snapshot.configFiles.filter((p) => /package\.json|next\.config/i.test(p)),
      });
    }

    const db = detectDb(snapshot.orms);
    if (db) {
      settlements.push({
        criterionId: "stack.db_engine",
        value: db,
        basis: "observed",
        evidence: snapshot.configFiles.filter((p) => /schema\.prisma|drizzle|migrations/i.test(p)),
      });
    }

    const auth = detectAuth(frameworks, snapshot);
    if (auth) {
      settlements.push({
        criterionId: "stack.auth_library",
        value: auth,
        basis: "observed",
        evidence: snapshot.configFiles.filter((p) => /auth/i.test(p)),
      });
    }

    const css = detectCss(snapshot.uiKits);
    if (css) {
      settlements.push({
        criterionId: "stack.css_system",
        value: css,
        basis: "observed",
        evidence: snapshot.configFiles.filter((p) => /tailwind|postcss/i.test(p)),
      });
    }

    const testRunner = pickFirst(snapshot.testRunners);
    if (testRunner) {
      settlements.push({
        criterionId: "stack.test_runner",
        value: testRunner,
        basis: "observed",
        evidence: [`test_files:${snapshot.testFileCount}`],
      });
    }

    return settlements;
  }

  greenfieldStackCriteria(): readonly StackCriterionId[] {
    return GREENFIELD_STACK_CRITERIA;
  }
}