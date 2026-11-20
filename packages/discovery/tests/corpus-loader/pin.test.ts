import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { loadCorpusPacks } from "../../src/corpus-loader/load.js";
import {
  CORPUS_BUNDLE_HASH_META_KEY,
  CORPUS_OBSERVED_HASH_META_KEY,
  reconcileCorpusUpgrade,
} from "../../src/corpus-loader/reconcile.js";
import { SqliteCorpusPinStore } from "../../src/corpus-loader/sqlite-pin-store.js";
import { buildQuestion, questionPack, writeCorpus } from "./fixture.js";

function openStateDb(): { directory: string; store: SqliteCorpusPinStore } {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ef-state-"));
  const database = new DatabaseSync(path.join(directory, "state.db"));
  database.exec(`
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT, WITHOUT ROWID;
    CREATE TABLE nodes (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      fields TEXT NOT NULL,
      status TEXT NOT NULL
    );
    CREATE TABLE scope_criteria (
      work_item TEXT NOT NULL,
      scope_rev INTEGER NOT NULL,
      decision TEXT NOT NULL,
      needed_for_planning INTEGER NOT NULL,
      critical INTEGER NOT NULL,
      PRIMARY KEY (work_item, scope_rev, decision)
    ) STRICT, WITHOUT ROWID;
  `);
  database
    .prepare("INSERT INTO nodes(id, kind, fields, status) VALUES (?, ?, ?, ?)")
    .run(
      "D1",
      "decision",
      JSON.stringify({
        question_id: "Q-CORE-01",
        criterion: "fixture.q_core_01",
        status: "settled",
        value: "chosen",
        basis: "explicit",
      }),
      "active",
    );
  database
    .prepare(
      `INSERT INTO scope_criteria(work_item, scope_rev, decision, needed_for_planning, critical)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run("project", 1, "D1", 1, 1);
  database.close();
  return { directory, store: SqliteCorpusPinStore.open(path.join(directory, "state.db")) };
}

describe("project corpus pin", () => {
  it("pins corpus_bundle_hash and preserves settled decisions and scope_criteria across an upgrade", () => {
    const v1 = writeCorpus([
      { relativePath: "packs/core/core.json", document: questionPack("core", [buildQuestion("Q-CORE-01")]) },
    ]);
    const renamed = buildQuestion("Q-CORE-11", {
      criteria: ["fixture.q_core_11"],
      renamed_from: "Q-CORE-01",
    });
    const added = buildQuestion("Q-CORE-02");
    const v2 = writeCorpus([
      { relativePath: "packs/core/core.json", document: questionPack("core", [renamed, added]) },
    ]);
    const first = loadCorpusPacks(v1);
    const second = loadCorpusPacks(v2);
    expect(first.corpusBundleHash).not.toBe(second.corpusBundleHash);

    const { store } = openStateDb();
    try {
      const initial = reconcileCorpusUpgrade(store, first);
      expect(initial.initialPin).toBe(true);
      expect(initial.pinnedHash).toBe(first.corpusBundleHash);
      expect(store.getMeta(CORPUS_BUNDLE_HASH_META_KEY)).toBe(first.corpusBundleHash);
      expect(initial.settledDecisions).toEqual([
        {
          decisionId: "D1",
          questionId: "Q-CORE-01",
          criterion: "fixture.q_core_01",
          value: "chosen",
          basis: "explicit",
        },
      ]);
      expect(initial.scopeCriteria).toEqual([
        { workItem: "project", scopeRev: 1, decision: "D1", neededForPlanning: 1, critical: 1 },
      ]);

      const upgrade = reconcileCorpusUpgrade(store, second);
      expect(upgrade.upgraded).toBe(true);
      expect(upgrade.pinnedHash).toBe(first.corpusBundleHash);
      expect(store.getMeta(CORPUS_BUNDLE_HASH_META_KEY)).toBe(first.corpusBundleHash);
      expect(store.getMeta(CORPUS_OBSERVED_HASH_META_KEY)).toBe(second.corpusBundleHash);
      expect(upgrade.renamed).toEqual([{ from: "Q-CORE-01", to: "Q-CORE-11" }]);
      expect(upgrade.addedQuestionIds).toEqual(["Q-CORE-02"]);
      expect(upgrade.removedQuestionIds).toEqual([]);
      expect(upgrade.settledDecisions[0]?.value).toBe("chosen");
      expect(upgrade.settledDecisions[0]?.questionId).toBe("Q-CORE-01");
      expect(upgrade.scopeCriteria).toEqual(initial.scopeCriteria);
    } finally {
      store.close();
    }
  });

  it("loads json packs, elaborations, policies, rules, and seams into one hash", () => {
    const question = buildQuestion("Q-AUTH-01", { must_ask: true, reversibility: "irreversible" });
    const root = writeCorpus([
      { relativePath: "packs/auth/auth.json", document: questionPack("auth", [question]) },
      {
        relativePath: "elaborations/magic.json",
        document: {
          kind: "option_elaborations",
          id: "magic",
          version: 1,
          elaborations: [
            {
              id: "ELAB-AUTH-MAGIC-LINK",
              question: "Q-AUTH-01",
              option: "chosen",
              cells: [{ cell: "auth.magic_link.lifetime", value: "Single-use link that expires in 15 minutes." }],
              edge_cases: ["An expired link offers a way to request a new one."],
              bounds: ["Resend is rate limited."],
              oracle_hints: ["The response does not reveal whether an account exists."],
            },
          ],
        },
      },
      {
        relativePath: "policies/universal.json",
        document: {
          kind: "universal_policies",
          id: "universal",
          version: 1,
          policies: [{ id: "UP-01", cell: "screen.loading", value: "Skeleton or spinner after 300 ms." }],
        },
      },
      {
        relativePath: "rules-seams/rules.json",
        document: {
          kind: "cross_cutting_rules",
          id: "rules",
          version: 1,
          rules: [
            {
              id: "X-01",
              rule: "Every server action checks the caller's role.",
              scope: { all: ["route", "authz"] },
              check_kind: "generated_negative_test",
            },
          ],
        },
      },
      {
        relativePath: "rules-seams/seams.json",
        document: {
          kind: "seam_templates",
          id: "seams",
          version: 1,
          seams: [
            {
              id: "SEAM-WEB-API",
              title: "Web UI to own API",
              activates_when: ["web", "api"],
              contract_template: "Typed endpoint client and error mapping.",
              edge_cases: ["A slow response.", "A 401 during submit."],
              rules_activated: ["X-01"],
            },
          ],
        },
      },
    ]);
    const bundle = loadCorpusPacks(root);
    expect(bundle.questions).toHaveLength(1);
    expect(bundle.elaborations).toHaveLength(1);
    expect(bundle.policies[0]?.id).toBe("UP-01");
    expect(bundle.rules[0]?.id).toBe("X-01");
    expect(bundle.seams[0]?.id).toBe("SEAM-WEB-API");
    expect(bundle.corpusBundleHash).toMatch(/^[a-f0-9]{64}$/);
  });
});
