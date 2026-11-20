import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  CorpusPackError,
  CorpusQualityError,
  CorpusQualityValidator,
  TOUCHES_TAGS,
  applicableSlice,
  inventoryIssues,
  isWebUiOnlyScope,
  numericBoundConflicts,
  stageDefaultConflicts,
  type CorpusBundle,
  type ElaborationRecord,
  type QuestionRecord,
} from "./corpus-port.js";
import { CorpusPackLoader, findRepoRoot, parseCorpusYaml } from "./load-bundle.js";

const repoRoot = findRepoRoot(path.dirname(fileURLToPath(import.meta.url)));
const loader = new CorpusPackLoader(repoRoot);
const bundle = loader.load();
const validator = new CorpusQualityValidator();

function cloneBundle(overrides: Partial<CorpusBundle> = {}): CorpusBundle {
  return {
    questions: bundle.questions.map((question) => structuredClone(question)),
    elaborations: bundle.elaborations.map((item) => structuredClone(item)),
    policies: bundle.policies.map((item) => structuredClone(item)),
    core_source: bundle.core_source,
    files: [...bundle.files],
    ...overrides,
  };
}

function question(pack: QuestionRecord["pack"], id: string): QuestionRecord {
  const found = bundle.questions.find((item) => item.id === id && item.pack === pack);
  if (!found) throw new Error(`missing ${pack} question ${id}`);
  return found;
}

describe("corpus web api cli", () => {
  it("loads web, api, and cli packs through the quality validator", () => {
    expect(bundle.questions.filter((item) => item.pack === "web").map((item) => item.id)).toEqual([
      "ui.responsive_targets",
      "ui.pages_inventory",
      "ui.forms_validation_style",
      "ui.states_style",
      "ui.look_and_feel",
      "ui.accessibility_level",
    ]);
    expect(bundle.questions.filter((item) => item.pack === "api").map((item) => item.id)).toEqual([
      "api.style",
      "api.consumers",
      "api.pagination",
      "api.rate_limits",
      "jobs.background_needed",
    ]);
    expect(bundle.questions.filter((item) => item.pack === "cli").map((item) => item.id)).toEqual([
      "cli.output_format",
      "cli.config_location",
      "cli.exit_codes",
      "cli.distribution",
    ]);
    const issues = validator.validate(bundle);
    expect(issues, issues.map((issue) => issue.message).join("\n")).toEqual([]);
  });

  it("keeps the combined M2 bundle at 44 questions, at least 60 elaborations, and UP-01 through UP-08", () => {
    expect(bundle.questions.filter((item) => item.pack === "core")).toHaveLength(18);
    expect(bundle.questions.filter((item) => item.pack === "data")).toHaveLength(6);
    expect(bundle.questions.filter((item) => item.pack === "auth")).toHaveLength(5);
    expect(inventoryIssues(bundle)).toEqual([]);
    expect(bundle.elaborations.length).toBeGreaterThanOrEqual(60);
    expect(bundle.policies.map((policy) => policy.id)).toEqual([
      "UP-01",
      "UP-02",
      "UP-03",
      "UP-04",
      "UP-05",
      "UP-06",
      "UP-07",
      "UP-08",
    ]);
    expect(bundle.core_source).toBe("task-075-port");
  });

  it("links every elaboration to a real option and only uses the closed 28 touches tags", () => {
    const pairs = new Set(
      bundle.questions.flatMap((item) => item.options.map((option) => `${item.id}:${option.id}`)),
    );
    for (const elaboration of bundle.elaborations) {
      expect(pairs.has(`${elaboration.question_id}:${elaboration.option_id}`)).toBe(true);
      for (const tag of [...(elaboration.touches.any ?? []), ...(elaboration.touches.all ?? [])]) {
        expect(TOUCHES_TAGS).toContain(tag);
      }
    }
    for (const policy of bundle.policies) {
      for (const tag of [...(policy.touches.any ?? []), ...(policy.touches.all ?? [])]) {
        expect(TOUCHES_TAGS).toContain(tag);
      }
      expect(policy.oracle_hints.length).toBeGreaterThan(0);
    }
    for (const item of bundle.questions) {
      expect(item.examples.positive.length).toBeGreaterThanOrEqual(5);
      expect(item.examples.negative.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("hashes the bundle stably and covers every owned question with an elaboration", () => {
    expect(loader.bundleHash(bundle)).toBe(loader.bundleHash(loader.load()));
    const covered = new Set(bundle.elaborations.map((item) => item.question_id));
    for (const item of bundle.questions) {
      expect(covered.has(item.id)).toBe(true);
    }
  });

  it("keeps stage defaults free of conflicts", () => {
    expect(stageDefaultConflicts(bundle, "prototype")).toEqual([]);
    expect(stageDefaultConflicts(bundle, "mvp")).toEqual([]);
    expect(stageDefaultConflicts(bundle, "production")).toEqual([]);
  });

  it("gives a CLI task CLI and shared policies and no web-ui policy", () => {
    const slice = applicableSlice(
      bundle,
      ["config_env", "logging", "credentials"],
      [
        { question_id: "cli.output_format", option_id: "json_noninteractive" },
        { question_id: "cli.exit_codes", option_id: "conventional_split" },
        { question_id: "cli.config_location", option_id: "flags_env_project_user" },
        { question_id: "cli.distribution", option_id: "os_config_dirs" },
      ],
    );
    expect(slice.policyIds).toContain("UP-01");
    expect(slice.policyIds).toContain("UP-08");
    expect(slice.policyIds).not.toContain("UP-07");
    for (const policyId of slice.policyIds) {
      const policy = bundle.policies.find((item) => item.id === policyId);
      expect(isWebUiOnlyScope(policy?.touches)).toBe(false);
    }
    const text = slice.clauses.map((clause) => clause.text).join("\n");
    expect(text).toContain("Logs go strictly to stderr; stdout is reserved for machine-readable output.");
    expect(slice.clauses.some((clause) => clause.questionId === "cli.exit_codes")).toBe(true);
    expect(slice.clauses.some((clause) => clause.questionId === "ui.forms_validation_style")).toBe(false);
  });

  it("gives a web form task UP-07 and form elaborations, and withholds them from a formless page", () => {
    const form = applicableSlice(
      bundle,
      ["form_input", "interactive_ui", "route"],
      [
        { question_id: "ui.forms_validation_style", option_id: "autosave_drafts" },
        { question_id: "ui.accessibility_level", option_id: "wcag_aa_evergreen" },
      ],
    );
    expect(form.policyIds).toContain("UP-07");
    expect(form.clauses.some((clause) => clause.optionId === "autosave_drafts")).toBe(true);
    expect(form.clauses.some((clause) => clause.questionId === "cli.exit_codes")).toBe(false);
    expect(form.clauses.some((clause) => clause.optionId === "json_noninteractive")).toBe(false);

    const staticPage = applicableSlice(
      bundle,
      ["route", "interactive_ui"],
      [{ question_id: "ui.forms_validation_style", option_id: "autosave_drafts" }],
    );
    expect(staticPage.clauses.some((clause) => clause.optionId === "autosave_drafts")).toBe(false);
    expect(staticPage.policyIds).toContain("UP-07");
  });

  it("gives a greenfield API task shared server policies and not the UI floor", () => {
    const api = applicableSlice(
      bundle,
      ["route", "external_api", "rate_limited", "logging", "authz"],
      [
        { question_id: "api.style", option_id: "rest_openapi" },
        { question_id: "api.rate_limits", option_id: "basic_limits" },
        { question_id: "jobs.background_needed", option_id: "durable_jobs" },
      ],
    );
    expect(api.policyIds).toEqual(expect.arrayContaining(["UP-02", "UP-03", "UP-04", "UP-06", "UP-08"]));
    expect(api.policyIds).not.toContain("UP-07");
    expect(api.clauses.some((clause) => clause.questionId?.startsWith("cli."))).toBe(false);
  });

  it("records the magic-link, PostgreSQL, and JSON oracle contracts", () => {
    const magic = bundle.elaborations.find((item) => item.question_id === "auth.method" && item.option_id === "magic_link");
    const postgres = bundle.elaborations.find((item) => item.question_id === "data.storage.engine" && item.option_id === "postgres");
    const json = bundle.elaborations.find((item) => item.option_id === "json_noninteractive");
    expect(magic?.oracle_hints.join(" ")).toContain("Expired magic link returns 400/410 and shows resend link");
    expect(magic?.clauses.map((clause) => clause.text).join(" ")).toMatch(/15-min|15 minute/);
    expect(postgres?.clauses.map((clause) => clause.text).join(" ")).toContain("timestamptz");
    expect(json?.oracle_hints.join(" ")).toContain(
      "CLI --json emits valid single JSON doc on stdout and zero logs on stdout",
    );
    expect(question("api", "api.style").criteria).toContain("api.error_format");
  });

  it("rejects a dangling elaboration, a bad tag, a short example list, a cycle, and asymmetric conflicts", () => {
    const dangling: ElaborationRecord = structuredClone(bundle.elaborations[0]!);
    dangling.id = "ELAB-DANGLING";
    dangling.question_id = "ui.responsive_targets";
    dangling.option_id = "missing_option";
    const danglingIssues = validator.validate(cloneBundle({ elaborations: [...bundle.elaborations, dangling] }));
    expect(danglingIssues.some((issue) => issue.code === "dangling_elaboration")).toBe(true);

    const badTag = cloneBundle();
    const target = badTag.questions.find((item) => item.id === "ui.look_and_feel");
    if (!target) throw new Error("missing look and feel");
    target.touches = ["graphql_magic" as never];
    const tagIssues = validator.validate(badTag);
    expect(tagIssues.some((issue) => issue.code === "bad_touches_tag" && issue.message.includes("graphql_magic"))).toBe(true);
    expect(tagIssues.some((issue) => issue.message.includes("personal_data"))).toBe(true);

    const short = cloneBundle();
    const forms = short.questions.find((item) => item.id === "ui.forms_validation_style");
    if (!forms) throw new Error("missing forms");
    forms.examples.positive = forms.examples.positive.slice(0, 4);
    expect(validator.validate(short).some((issue) => issue.code === "insufficient_examples")).toBe(true);

    const cycled = cloneBundle();
    const left = cycled.questions.find((item) => item.id === "ui.look_and_feel");
    const right = cycled.questions.find((item) => item.id === "ui.accessibility_level");
    if (!left || !right) throw new Error("missing cycle pair");
    left.requires = ["ui.accessibility_level"];
    right.requires = ["ui.look_and_feel"];
    expect(validator.validate(cycled).some((issue) => issue.code === "requires_cycle")).toBe(true);

    const asymmetric = cloneBundle();
    const style = asymmetric.questions.find((item) => item.id === "api.style");
    const internal = style?.options.find((option) => option.id === "internal_rpc_only");
    if (!internal) throw new Error("missing internal rpc");
    internal.conflicts_with.push({ question_id: "api.pagination", option_id: "offset_page" });
    expect(validator.validate(asymmetric).some((issue) => issue.code === "asymmetric_conflict")).toBe(true);
  });

  it("flags conflicting numeric bounds and framework-specific elaboration text", () => {
    const conflicted = cloneBundle();
    const [first, second] = conflicted.elaborations;
    if (!first || !second) throw new Error("need two elaborations");
    first.question_id = "ui.responsive_targets";
    first.option_id = "mobile_first";
    second.question_id = "ui.look_and_feel";
    second.option_id = "light_only";
    first.bounds = [{ key: "upload.max_bytes", value: 5 * 1024 * 1024, unit: "bytes" }];
    second.bounds = [{ key: "upload.max_bytes", value: 20 * 1024 * 1024, unit: "bytes" }];
    expect(numericBoundConflicts(conflicted).some((issue) => issue.code === "numeric_bound_conflict")).toBe(true);

    const framework = cloneBundle();
    const sample = framework.elaborations[0];
    if (!sample) throw new Error("missing elaboration");
    sample.clauses[0]!.text = "Register the route with app.use(express.json()) before the handler.";
    expect(validator.validate(framework).some((issue) => issue.code === "framework_syntax")).toBe(true);
  });

  it("fails closed on duplicate YAML keys and malformed YAML", () => {
    expect(() => parseCorpusYaml("id: a\nid: b\n", "fixture.yaml")).toThrow(CorpusPackError);
    expect(() => parseCorpusYaml("questions:\n  - id: [\n", "fixture.yaml")).toThrow(CorpusPackError);
  });

  it("fails inventory when the combined catalog drops below 44 or elaborations drop below 60", () => {
    const dropped = cloneBundle({ questions: bundle.questions.slice(0, 43) });
    expect(inventoryIssues(dropped).some((issue) => issue.message.includes("44"))).toBe(true);
    const thin = cloneBundle({ elaborations: bundle.elaborations.slice(0, 59) });
    expect(inventoryIssues(thin).some((issue) => issue.message.includes("60"))).toBe(true);
  });

  it("rejects a costly question that clears must_ask", () => {
    const loosened = cloneBundle();
    const routing = loosened.questions.find((item) => item.id === "ui.pages_inventory");
    if (!routing) throw new Error("missing routing");
    routing.must_ask = false;
    expect(validator.validate(loosened).some((issue) => issue.code === "costly_must_ask")).toBe(true);
    expect(() => validator.validateOrThrow(loosened)).toThrow(CorpusQualityError);
  });
});
