import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  contentViolations,
  decidePermission,
  forbiddenSnippets,
  handoffErrors,
  isFoundationFrozen,
  markerPattern,
  matchesOwned,
  parseFrontmatter,
  secretNeedles,
} from "./harmony-lib.mjs";
import { LIBRARY_PACKAGE_IDS } from "./layers.mjs";

test("library layout contains 28 packages", () => {
  assert.equal(LIBRARY_PACKAGE_IDS.length, 28);
  assert.ok(LIBRARY_PACKAGE_IDS.includes("shared-contracts"));
  assert.ok(LIBRARY_PACKAGE_IDS.includes("shared-observability"));
});

test("secret needles are assembled without storing the joined marker in this file", () => {
  const source = fs.readFileSync(new URL("./harmony.test.mjs", import.meta.url), "utf8");
  for (const needle of secretNeedles()) {
    assert.equal(source.includes(needle), false);
  }
  for (const snippet of forbiddenSnippets()) {
    assert.equal(source.includes(snippet), false);
  }
  const sample = ["sk", "_live_", "test123"].join("");
  assert.equal(contentViolations(sample, "sample").length > 0, true);
  assert.equal(contentViolations("ordinary sentence", "sample").length, 0);
});

test("anchored deferral markers are allowed", () => {
  const allowed = `see ${["TO", "DO"].join("")}(DEF-12)`;
  const bare = ["TO", "DO"].join("");
  assert.equal(markerPattern().test(allowed), false);
  assert.equal(markerPattern().test(bare), true);
});

test("owned paths and frozen foundation files", () => {
  assert.equal(matchesOwned("spikes/node-sqlite-electron/report.json", ["spikes/node-sqlite-electron/**"]), true);
  assert.equal(matchesOwned("packages/db/src/driver/index.ts", ["spikes/node-sqlite-electron/**"]), false);
  assert.equal(isFoundationFrozen("schema/state.sql"), true);
  assert.equal(isFoundationFrozen("package.json"), true);
  assert.equal(isFoundationFrozen("packages/db/src/driver/index.ts"), false);
  assert.equal(isFoundationFrozen(".agent-handoffs/task-002.md"), false);
});

test("handoff template contract parses", () => {
  const template = fs.readFileSync(path.join(checkoutDir(), ".agent-handoffs", "TEMPLATE.md"), "utf8");
  const filled = template
    .replaceAll("Task-NNN", "Task-002")
    .replaceAll("task/NNN-<slug>", "task/002-example")
    .replaceAll("0000000000000000000000000000000000000000", "a".repeat(40));
  const parsed = parseFrontmatter(filled);
  assert.deepEqual(handoffErrors(parsed.data, parsed.body, { nnn: "002", requireReady: true }), []);
});

test("opencode permission rules deny merge and allow status", () => {
  const config = JSON.parse(fs.readFileSync(path.join(checkoutDir(), "opencode.json"), "utf8"));
  assert.equal(decidePermission(config.permission, "bash", "git merge origin/main"), "deny");
  assert.equal(decidePermission(config.permission, "bash", "git push"), "deny");
  assert.equal(decidePermission(config.permission, "bash", "git status --short"), "allow");
  assert.equal(decidePermission(config.permission, "webfetch", "https://example.invalid"), "deny");
  assert.equal(decidePermission(config.permission, "read", "C:/Users/someone/.ssh/id_rsa"), "deny");
  assert.equal(decidePermission(config.permission, "read", ".env.example"), "allow");
  assert.equal(decidePermission(config.permission, "read", ".env.local"), "deny");
});

function checkoutDir() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}
