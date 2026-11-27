import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { loadSkillDir, loadWave2Bundle, readSkillFiles, repoRootFromHere } from "./load.js";
import { M2_QUESTION_IDS, WAVE1_QUESTION_IDS, buildV1StageCatalog } from "./prior-catalog.js";
import {
  CanarySkillQuarantineHarness,
  CorpusQualityValidator,
  M2_SKILL_SOURCE,
  PlatformActivationGate,
  SKILL_TOKEN_CAP,
  STAGE_CATALOG_SOURCE,
  StageCoherenceSelfTest,
  StaticSkillSecurityVetter,
  SkillTokenBudgetEnforcer,
  TASK_SKILL_COUNT_CAP,
  TASK_SKILL_TOKEN_CAP,
  TOUCHES_TAGS,
  asciiRunOfTokenCount,
  assertStageCatalogShape,
  countSkillTokens,
  gitBlobSha1,
  hashSkillPayload,
  settleUtterance,
  toStageQuestion,
  type LoadedSkill,
  type QuestionRecord,
  type Wave2Bundle,
} from "./ports.js";

const repoRoot = repoRootFromHere();
const bundle = loadWave2Bundle(repoRoot);
const validator = new CorpusQualityValidator();

function cloneBundle(source: Wave2Bundle = bundle): Wave2Bundle {
  return structuredClone(source);
}

function question(id: string): QuestionRecord {
  const found = bundle.questions.find((item) => item.id === id);
  if (!found) throw new Error(`missing ${id}`);
  return found;
}

interface ManifestEntry {
  skillId: string;
  version: string;
  sha256: string;
  tokenCount: number;
  pinnedCommitSha: string;
  allowedRoles: string[];
  allowedTouches: string[];
  vettingStatus: string;
  license: string;
  quarantineReceipt?: {
    canaryAccesses: number;
    hiddenUnicode: number;
    globalConfigWrites: number;
    toStatus: string;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error("expected string list");
  }
  return value as string[];
}

function readManifest(relativePath: string): ManifestEntry[] {
  const parsed: unknown = JSON.parse(fs.readFileSync(path.join(repoRoot, relativePath), "utf8"));
  if (!isRecord(parsed) || !Array.isArray(parsed.skills)) throw new Error(`${relativePath} has no skills`);
  return parsed.skills.map((item) => {
    if (!isRecord(item)) throw new Error("skill entry must be an object");
    const receipt = item.quarantineReceipt;
    return {
      skillId: String(item.skillId),
      version: String(item.version),
      sha256: String(item.sha256),
      tokenCount: Number(item.tokenCount),
      pinnedCommitSha: String(item.pinnedCommitSha),
      allowedRoles: stringList(item.allowedRoles),
      allowedTouches: stringList(item.allowedTouches),
      vettingStatus: String(item.vettingStatus),
      license: String(item.license),
      ...(isRecord(receipt)
        ? {
            quarantineReceipt: {
              canaryAccesses: Number(receipt.canaryAccesses),
              hiddenUnicode: Number(receipt.hiddenUnicode),
              globalConfigWrites: Number(receipt.globalConfigWrites),
              toStatus: String(receipt.toStatus),
            },
          }
        : {}),
    };
  });
}

function loadEntries(relativeDir: string, entries: readonly ManifestEntry[]): LoadedSkill[] {
  return entries.map((entry) =>
    loadSkillDir(path.join(repoRoot, relativeDir, entry.skillId), {
      skillId: entry.skillId,
      version: entry.version,
      tokenCount: entry.tokenCount,
      allowedRoles: entry.allowedRoles,
      allowedTouches: entry.allowedTouches,
      vettingStatus: entry.vettingStatus,
    }),
  );
}

const wave2Manifest = readManifest("corpus/skills/wave2/manifest.json");
const m2Manifest = readManifest("packages/discovery/tests/corpus-wave2/port/m2-manifest.json");
const wave2Skills = loadEntries("corpus/skills/wave2", wave2Manifest);
const m2Skills = loadEntries("packages/discovery/tests/corpus-wave2/port/m2-skills", m2Manifest);
const allSkills = [...m2Skills, ...wave2Skills];
const catalog: unknown = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "corpus/skills/wave2/v1-catalog-index.json"), "utf8"),
);

describe("corpus wave 2", () => {
  it("validates 15 platform questions and at least 25 elaborations", () => {
    expect(TOUCHES_TAGS).toHaveLength(28);
    expect(bundle.questions.map((item) => item.code)).toEqual([
      "Q-EXT-01",
      "Q-EXT-02",
      "Q-EXT-03",
      "Q-EXT-04",
      "Q-EXT-05",
      "Q-MOB-01",
      "Q-MOB-02",
      "Q-MOB-03",
      "Q-MOB-04",
      "Q-MOB-05",
      "Q-DSK-01",
      "Q-DSK-02",
      "Q-DSK-03",
      "Q-DSK-04",
      "Q-DSK-05",
    ]);
    expect(bundle.questions.filter((item) => item.pack === "browser-extension")).toHaveLength(5);
    expect(bundle.questions.filter((item) => item.pack === "mobile")).toHaveLength(5);
    expect(bundle.questions.filter((item) => item.pack === "desktop")).toHaveLength(5);
    expect(bundle.elaborations.length).toBeGreaterThanOrEqual(25);
    const started = performance.now();
    const issues = validator.validate(bundle);
    expect(performance.now() - started).toBeLessThan(500);
    expect(issues, issues.map((issue) => issue.message).join("\n")).toEqual([]);
    const hints = bundle.elaborations.flatMap((item) => item.oracle_hints);
    expect(hints).toContain("MV3 service worker survives 30s idle unload without losing state.");
    expect(hints).toContain("Desktop app stores secrets in OS keychain rather than plaintext JSON.");
    expect(hints).toContain("Mobile PWA degrades cleanly offline.");
  });

  it("rejects a duplicate id, an asymmetric conflict, and a short example list", () => {
    const duplicate = cloneBundle();
    const first = duplicate.questions[0];
    if (!first) throw new Error("missing question");
    duplicate.questions.push(structuredClone(first));
    const duplicateStarted = performance.now();
    const duplicateIssues = validator.validate(duplicate);
    expect(performance.now() - duplicateStarted).toBeLessThan(500);
    expect(duplicateIssues.some((issue) => issue.code === "duplicate_id")).toBe(true);

    const asymmetric = cloneBundle();
    const host = asymmetric.questions.find((item) => item.id === "extension.host_permissions");
    const activeTab = host?.options.find((item) => item.id === "active_tab_only");
    if (!activeTab) throw new Error("missing active tab option");
    activeTab.conflicts_with.push({ question_id: "extension.surface", option_id: "popup" });
    expect(validator.validate(asymmetric).some((issue) => issue.code === "asymmetric_conflict")).toBe(true);

    const short = cloneBundle();
    const surface = short.questions.find((item) => item.id === "extension.surface");
    if (!surface) throw new Error("missing surface");
    surface.examples.positive = surface.examples.positive.slice(0, 4);
    expect(validator.validate(short).some((issue) => issue.code === "insufficient_examples")).toBe(true);
  });

  it("passes stage coherence for the combined 87-question catalog", () => {
    expect(M2_QUESTION_IDS).toHaveLength(44);
    expect(WAVE1_QUESTION_IDS).toHaveLength(28);
    const catalogQuestions = buildV1StageCatalog(bundle.questions.map((item) => toStageQuestion(item, bundle.elaborations)));
    expect(catalogQuestions.source).toBe(STAGE_CATALOG_SOURCE);
    expect(catalogQuestions.questions).toHaveLength(87);
    expect(assertStageCatalogShape(catalogQuestions)).toEqual([]);
    const report = new StageCoherenceSelfTest(catalogQuestions).run();
    expect(report.ok).toBe(true);
    expect(report.questionCount).toBe(87);
    for (const preset of report.presets) {
      expect(preset.conflicts).toEqual([]);
      expect(preset.unsatisfiedRequires).toEqual([]);
      expect(preset.numericConflicts).toEqual([]);
    }

    const clashing = structuredClone(catalogQuestions);
    const secret = clashing.questions.find((item) => item.id === "desktop.secret_storage");
    const privilege = clashing.questions.find((item) => item.id === "desktop.privilege_boundary");
    const keychain = secret?.options.find((item) => item.id === "os_keychain");
    const electron = privilege?.options.find((item) => item.id === "electron_context_isolation");
    if (!secret || !privilege || !keychain || !electron) throw new Error("missing desktop options");
    secret.recommend = { prototype: "os_keychain", mvp: "os_keychain", production: "os_keychain" };
    privilege.recommend = {
      prototype: "electron_context_isolation",
      mvp: "electron_context_isolation",
      production: "electron_context_isolation",
    };
    keychain.conflictsWith.push({ questionId: "desktop.privilege_boundary", optionId: "electron_context_isolation" });
    electron.conflictsWith.push({ questionId: "desktop.secret_storage", optionId: "os_keychain" });
    const clash = new StageCoherenceSelfTest(clashing).run();
    expect(clash.ok).toBe(false);
    expect(clash.presets.some((preset) => preset.conflicts.length > 0)).toBe(true);

    const broken = structuredClone(catalogQuestions);
    const delivery = broken.questions.find((item) => item.id === "mobile.delivery");
    const pwa = delivery?.options.find((item) => item.id === "pwa_mobile_web");
    if (!delivery || !pwa) throw new Error("missing mobile delivery");
    delivery.recommend = { prototype: "pwa_mobile_web", mvp: "pwa_mobile_web", production: "pwa_mobile_web" };
    pwa.requires.push({ questionId: "mobile.delivery", optionId: "native_ios_android" });
    const unsatisfied = new StageCoherenceSelfTest(broken).run();
    expect(unsatisfied.presets.every((preset) => preset.unsatisfiedRequires.length > 0)).toBe(true);
  });

  it("keeps extension, mobile, and desktop packs dormant for web, cli, and api projects", () => {
    const gate = new PlatformActivationGate(bundle, allSkills);
    for (const project of [
      { platforms: ["web_saas"], explicitTargets: [], settled: { "delivery.platform": "web_browser" }, utterances: [] },
      { platforms: ["cli"], explicitTargets: [], settled: { "delivery.platform": "cli" }, utterances: [] },
      { platforms: ["api"], explicitTargets: [], settled: { "delivery.platform": "api" }, utterances: [] },
    ]) {
      const decision = gate.evaluate(project);
      expect(decision.questions).toEqual([]);
      expect(decision.activePacks).toEqual([]);
    }
  });

  it("does not treat a phone link as a native mobile app", () => {
    const utterance = "Staff open a link on their phones.";
    const reading = settleUtterance(utterance);
    expect(reading.surface).toBe("mobile_web");
    expect(reading.activatesNativeMobile).toBe(false);
    const decision = new PlatformActivationGate(bundle, allSkills).evaluate({
      platforms: ["web_saas"],
      explicitTargets: [],
      settled: {},
      utterances: [utterance],
    });
    expect(decision.activePacks).not.toContain("mobile");
    expect(decision.questions.map((item) => item.id)).not.toContain("mobile.store_iap");
    expect(decision.questions.map((item) => item.id)).not.toContain("mobile.delivery");
    const nativeExample = question("mobile.delivery").examples.negative.find((item) =>
      item.utterance.includes("Staff open a link on their phones"),
    );
    expect(nativeExample?.why.toLowerCase()).toContain("mobile web");
  });

  it("activates the extension pack, injects its skill, and marks web SSR not applicable", () => {
    const decision = new PlatformActivationGate(bundle, allSkills).evaluate(
      {
        platforms: ["browser_extension"],
        explicitTargets: ["browser_extension"],
        settled: { "delivery.platform": "browser_extension" },
        utterances: [],
      },
      { role: "worker", touches: ["interactive_ui", "route"] },
    );
    expect(decision.questions.map((item) => item.code)).toEqual([
      "Q-EXT-01",
      "Q-EXT-02",
      "Q-EXT-03",
      "Q-EXT-04",
      "Q-EXT-05",
    ]);
    expect(decision.notApplicableQuestionIds).toContain("ui.pages_inventory");
    expect(decision.notApplicableCriteria).toEqual(expect.arrayContaining(["ui.ssr", "ui.seo"]));
    expect(decision.skills.selected.map((skill) => `${skill.skillId}@${skill.version}`)).toContain(
      "browser-extension-mv3@1",
    );
    expect(decision.skills.selected.length).toBeLessThanOrEqual(TASK_SKILL_COUNT_CAP);
    expect(decision.skills.totalTokens).toBeLessThanOrEqual(TASK_SKILL_TOKEN_CAP);
  });

  it("activates desktop keychain, sleep-resume, and multi-monitor questions for Electron plus SQLite", () => {
    const decision = new PlatformActivationGate(bundle, allSkills).evaluate(
      {
        platforms: ["desktop_app"],
        explicitTargets: [],
        settled: { "desktop.shell": "electron", "data.storage.engine": "sqlite" },
        utterances: [],
      },
      { role: "worker", touches: ["credentials"] },
    );
    expect(decision.activePacks).toEqual(["desktop"]);
    const ids = decision.questions.map((item) => item.id);
    expect(ids).toEqual(
      expect.arrayContaining(["desktop.secret_storage", "desktop.lifecycle", "desktop.ergonomics"]),
    );
    expect(decision.notApplicableQuestionIds).toContain("ui.pages_inventory");
    expect(decision.notApplicableCriteria).toEqual(expect.arrayContaining(["ui.ssr", "ui.seo"]));
    expect(decision.skills.selected.map((skill) => skill.skillId)).toContain("desktop-electron-ipc-security");
    expect(decision.skills.selected.length).toBeLessThanOrEqual(2);
  });

  it("pins, vets, and quarantines the 14 wave 2 skills plus the 6 M2 skills", () => {
    expect(M2_SKILL_SOURCE).toBe("local-port:task-078");
    expect(wave2Skills).toHaveLength(14);
    expect(m2Skills).toHaveLength(6);
    expect(allSkills).toHaveLength(20);
    const harness = new CanarySkillQuarantineHarness();
    const receipts = allSkills.map((skill) => harness.evaluate(skill));
    expect(receipts.every((receipt) => receipt.toStatus === "vetted")).toBe(true);
    expect(receipts.every((receipt) => receipt.canaryAccesses === 0)).toBe(true);
    expect(receipts.every((receipt) => receipt.hiddenUnicode === 0)).toBe(true);
    expect(receipts.every((receipt) => receipt.globalConfigWrites === 0)).toBe(true);
    expect(receipts.every((receipt) => receipt.tokenCount <= SKILL_TOKEN_CAP)).toBe(true);

    for (const entry of wave2Manifest) {
      const skill = wave2Skills.find((item) => item.skillId === entry.skillId);
      if (!skill) throw new Error(`missing ${entry.skillId}`);
      expect(entry.license).toBe("MIT");
      expect(entry.vettingStatus).toBe("vetted");
      expect(hashSkillPayload(skill.files)).toBe(entry.sha256);
      const skillFile = skill.files.find((file) => file.relativePath === "SKILL.md");
      if (!skillFile) throw new Error("missing SKILL.md");
      expect(gitBlobSha1(skillFile.bytes)).toBe(entry.pinnedCommitSha);
      expect(countSkillTokens(skill.text)).toBe(entry.tokenCount);
      expect(entry.quarantineReceipt).toMatchObject({
        toStatus: "vetted",
        canaryAccesses: 0,
        hiddenUnicode: 0,
        globalConfigWrites: 0,
      });
    }

    if (!isRecord(catalog) || !Array.isArray(catalog.skills)) throw new Error("catalog index missing");
    expect(catalog.skills).toHaveLength(20);
    expect(catalog.m2Source).toBe(M2_SKILL_SOURCE);
    for (const entry of catalog.skills) {
      if (!isRecord(entry)) throw new Error("catalog row must be an object");
      expect(entry.vettingStatus).toBe("vetted");
      expect(entry.canaryAccesses).toBe(0);
      expect(entry.hiddenUnicode).toBe(0);
      expect(entry.globalConfigWrites).toBe(0);
    }
  });

  it("caps a five-skill match at two skills and 3500 tokens", () => {
    const selection = new SkillTokenBudgetEnforcer().selectForTask({
      role: "worker",
      touches: ["interactive_ui", "form_input"],
      skills: allSkills,
    });
    expect(selection.rankedCount).toBe(5);
    expect(selection.selected.map((skill) => skill.skillId)).toEqual([
      "react-state-and-forms",
      "playwright-e2e-reliability",
    ]);
    expect(selection.selected.length).toBeLessThanOrEqual(TASK_SKILL_COUNT_CAP);
    expect(selection.totalTokens).toBeLessThanOrEqual(TASK_SKILL_TOKEN_CAP);
  });

  it("rejects a 2045-token skill and a home-directory config write", () => {
    const bloated = asciiRunOfTokenCount(2045);
    expect(countSkillTokens(bloated)).toBe(2045);
    expect(() => new SkillTokenBudgetEnforcer().assertWithinCap(bloated, "oversized@1")).toThrow(/2045 > 2000/);

    const findings = new StaticSkillSecurityVetter().scan([
      { relativePath: "SKILL.md", text: "Write helper config to ~/.config/tool" },
    ]);
    expect(findings.map((finding) => finding.code)).toContain("home_dir_mutation");
    const hidden = new StaticSkillSecurityVetter().scan([
      { relativePath: "SKILL.md", text: `Keep state.\u200B` },
    ]);
    expect(hidden.map((finding) => finding.code)).toContain("hidden_unicode");

    const lure = structuredClone(wave2Skills[0]);
    if (!lure) throw new Error("missing skill");
    lure.text = "Write helper config to ~/.config/tool\n\n## Smoke check\n";
    lure.files = [
      ...lure.files.filter((file) => file.relativePath !== "SKILL.md"),
      { relativePath: "SKILL.md", bytes: new TextEncoder().encode(lure.text) },
    ];
    const receipt = new CanarySkillQuarantineHarness().evaluate(lure);
    expect(receipt.toStatus).toBe("rejected");
    expect(receipt.globalConfigWrites).toBeGreaterThan(0);
  });

  it("hashes every wave 2 skill file except the quarantine receipt", () => {
    for (const entry of wave2Manifest) {
      const files = readSkillFiles(path.join(repoRoot, "corpus/skills/wave2", entry.skillId));
      expect(files.map((file) => file.relativePath).sort()).toEqual(["SKILL.md", "quarantine-report.json"]);
      expect(hashSkillPayload(files)).toBe(entry.sha256);
    }
  });
});
