import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { BaselineMetrics, HiddenCheckResult, HiddenSuiteDoc, KitchenBuild } from "./types.ts";

export function secretNeedles(): string[] {
  return [
    ["sk", "_live_"].join(""),
    ["sk-ant", "-"].join(""),
    ["sk-proj", "-"].join(""),
    ["ghp", "_"].join(""),
    ["AK", "IA"].join(""),
    ["BEGIN ", "PRIVATE KEY"].join(""),
  ];
}

export function secretHits(text: string): number {
  let hits = 0;
  for (const needle of secretNeedles()) {
    if (needle.length > 0 && text.includes(needle)) hits += 1;
  }
  return hits;
}

export class WindowsDpapiSecretsVault {
  private readonly stored = new Map<string, string>();

  put(name: string, plaintext: string): string {
    const digest = createHash("sha256").update(plaintext, "utf8").digest("hex");
    const record = `dpapi:v1:${digest}`;
    if (record.includes(plaintext)) throw new Error("ciphertext contained the plaintext secret");
    this.stored.set(name, record);
    return record;
  }

  readStored(name: string): string | undefined {
    return this.stored.get(name);
  }
}

export function scanTreeForSecrets(root: string): number {
  let found = 0;
  const walk = (dir: string): void => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === ".git" || entry.name === "node_modules") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) found += secretHits(fs.readFileSync(full, "utf8"));
    }
  };
  walk(root);
  return found;
}

export function plantNeedle(file: string): void {
  const needle = secretNeedles()[0];
  if (!needle) throw new Error("missing secret needle");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `token ${needle}\n`, "utf8");
}

const CHECK_OWNER: Record<string, string> = {
  "H-M2-01": "F-Orders",
  "H-M2-02": "F-Orders",
  "H-M2-03": "F-Orders",
  "H-M2-04": "F-Orders",
  "H-M2-05": "F-Orders",
  "H-M2-06": "F-Orders",
  "H-M2-07": "F-Orders",
  "H-M2-08": "F-Orders",
  "H-M2-09": "F-Orders",
  "H-M2-10": "F-Orders",
  "H-M2-11": "F-Orders",
  "H-M2-12": "F-Orders",
  "H-M2-13": "F-Orders",
  "H-M2-14": "F-Print",
  "H-M2-15": "F-Print",
  "H-M2-16": "F-CateringEmail",
  "H-M2-17": "F-CateringEmail",
  "H-M2-18": "F-CateringEmail",
  "H-M2-19": "F-Menu",
  "H-M2-20": "F-Menu",
  "H-M2-21": "F-CateringEmail",
  "H-M2-22": "F-CateringEmail",
  "H-M2-23": "shell",
  "H-M2-24": "shell",
  "H-M2-25": "shell",
  "H-M2-26": "shell",
  "H-M2-27": "shell",
  "H-M2-28": "shell",
  "H-M2-29": "F-Orders",
};

export function checkOwner(id: string): string {
  return CHECK_OWNER[id] ?? "shell";
}

export function kitchenFromLanded(landed: readonly string[], defect?: "strip-cutoff"): KitchenBuild {
  const has = (id: string) => landed.includes(id);
  const orders = has("F-Orders");
  const menu = has("F-Menu");
  const print = has("F-Print");
  const email = has("F-CateringEmail");
  const cutoff = orders && defect !== "strip-cutoff";
  return {
    orderPersisted: orders,
    dietaryStored: orders,
    modifyBeforeCutoff: orders,
    cancelBeforeCutoff: orders,
    serverRejectsAt1101: cutoff,
    serverRejectsEditAt1101: orders,
    serverRejectsAt1100: orders,
    uiSubmitDisabledAfterCutoff: orders,
    uiEditDisabledAfterCutoff: orders,
    noDuplicateSubmit: orders,
    noDuplicateRace: orders,
    kitchenTotalsExact: orders,
    dietaryVisible: orders,
    printOverflowPx: print ? 0 : 40,
    printTotalsMatch: print,
    emailArrived: email,
    emailMatchesDb: email,
    emailDeduped: email,
    anonMenuStatus: menu ? 401 : 200,
    staffMenuStatus: menu ? 403 : 200,
    anonEmailStatus: email ? 401 : 200,
    staffEmailStatus: email ? 403 : 200,
    consoleErrors: 0,
    brokenImages: 0,
    axeSerious: 0,
    styleguideInBundle: false,
    styleguideRoute: false,
    tokenLintOk: true,
    clientTimestampIgnored: cutoff,
  };
}

function predicate(id: string, build: KitchenBuild): boolean {
  switch (id) {
    case "H-M2-01":
      return build.orderPersisted;
    case "H-M2-02":
      return build.dietaryStored;
    case "H-M2-03":
      return build.modifyBeforeCutoff;
    case "H-M2-04":
      return build.cancelBeforeCutoff;
    case "H-M2-05":
      return build.serverRejectsAt1101;
    case "H-M2-06":
      return build.serverRejectsEditAt1101;
    case "H-M2-07":
      return build.serverRejectsAt1100;
    case "H-M2-08":
      return build.uiSubmitDisabledAfterCutoff;
    case "H-M2-09":
      return build.uiEditDisabledAfterCutoff;
    case "H-M2-10":
      return build.noDuplicateSubmit;
    case "H-M2-11":
      return build.noDuplicateRace;
    case "H-M2-12":
      return build.kitchenTotalsExact;
    case "H-M2-13":
      return build.dietaryVisible;
    case "H-M2-14":
      return build.printOverflowPx === 0;
    case "H-M2-15":
      return build.printTotalsMatch;
    case "H-M2-16":
      return build.emailArrived;
    case "H-M2-17":
      return build.emailMatchesDb;
    case "H-M2-18":
      return build.emailDeduped;
    case "H-M2-19":
      return build.anonMenuStatus === 401;
    case "H-M2-20":
      return build.staffMenuStatus === 403;
    case "H-M2-21":
      return build.anonEmailStatus === 401;
    case "H-M2-22":
      return build.staffEmailStatus === 403;
    case "H-M2-23":
      return build.consoleErrors === 0;
    case "H-M2-24":
      return build.brokenImages === 0;
    case "H-M2-25":
      return build.axeSerious === 0;
    case "H-M2-26":
      return build.styleguideInBundle === false;
    case "H-M2-27":
      return build.styleguideRoute === false;
    case "H-M2-28":
      return build.tokenLintOk;
    case "H-M2-29":
      return build.clientTimestampIgnored;
    default:
      return false;
  }
}

export class KitchenHiddenAcceptanceSuite {
  constructor(private readonly doc: HiddenSuiteDoc) {}

  get canary(): string {
    return this.doc.canary;
  }

  get total(): number {
    return this.doc.checks.length;
  }

  run(build: KitchenBuild): HiddenCheckResult[] {
    return this.doc.checks.map((check) => {
      const pass = predicate(check.id, build);
      return {
        id: check.id,
        title: check.title,
        pass,
        detail: pass ? "pass" : `${check.id} failed on the parallel kitchen build`,
      };
    });
  }
}

export class M2KitchenE2eBenchmarkRunner {
  constructor(private readonly baseline: BaselineMetrics) {}

  readBaseline(): BaselineMetrics {
    return this.baseline;
  }
}

export function buildWorkerPrompts(opening: string, taskIds: readonly string[], hiddenCount: number): string[] {
  return taskIds.map(
    (taskId) => `${opening}\nTask ${taskId}\nchecks_hidden_count: ${hiddenCount}\n`,
  );
}

export function promptsLeakHidden(prompts: readonly string[], suite: HiddenSuiteDoc): boolean {
  const blob = prompts.join("\n");
  if (blob.includes(suite.canary)) return true;
  return suite.checks.some((check) => blob.includes(check.title));
}

export interface SharedHelper {
  name: string;
  owner: string;
  users: string[];
}

export interface UndoState {
  features: string[];
  helpers: SharedHelper[];
}

export function undoFeature(state: UndoState, featureId: string): UndoState {
  const features = state.features.filter((id) => id !== featureId);
  const helpers = state.helpers.map((helper) => {
    const users = helper.users.filter((id) => id !== featureId);
    let owner = helper.owner;
    if (owner === featureId) {
      const replacement = users[0];
      if (!replacement) throw new Error(`${helper.name} would be orphaned`);
      owner = replacement;
    }
    return { name: helper.name, owner, users };
  });
  return { features, helpers };
}

export function migrationFileName(stamp: string, slug: string, sql: string): string {
  const hash = createHash("sha256").update(sql, "utf8").digest("hex").slice(0, 6);
  return `migrations/${stamp}_${hash}_${slug}.sql`;
}
