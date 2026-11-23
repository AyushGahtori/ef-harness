export const CLOSED_TOUCHES = [
  "personal_data",
  "credentials",
  "money",
  "user_content",
  "authn",
  "authz",
  "session",
  "scheduling",
  "time_display",
  "file_upload",
  "file_download",
  "external_api",
  "inbound_webhook",
  "outbound_message",
  "background_job",
  "realtime",
  "destructive_write",
  "bulk_write",
  "migration",
  "search",
  "form_input",
  "route",
  "interactive_ui",
  "logging",
  "config_env",
  "caching",
  "rate_limited",
  "concurrent_edit",
] as const;

const TAGS = new Set<string>(CLOSED_TOUCHES);
export const JUNIOR_CAP = 3000;
export const SENIOR_CAP = 6000;

export const AREA_C_EVIDENCE = [
  "closed-28-tags",
  "any-all-only",
  "must-should-could",
  "start-end-checklist",
  "junior-senior-caps",
  "hard-split-oversized-must",
  "no-sealed-leak",
] as const;

export function tokens(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

export function evaluateScope(scope: { any?: readonly string[]; all?: readonly string[] }, tags: readonly string[]): boolean {
  for (const key of Object.keys(scope)) {
    if (key !== "any" && key !== "all") throw new Error(`scope language rejects ${key}`);
  }
  for (const tag of [...(scope.any ?? []), ...(scope.all ?? [])]) {
    if (!TAGS.has(tag)) throw new Error(`unknown touches tag ${tag}`);
  }
  const present = new Set(tags);
  const anyOk = scope.any === undefined || scope.any.some((tag) => present.has(tag));
  const allOk = scope.all === undefined || scope.all.every((tag) => present.has(tag));
  return anyOk && allOk;
}

export interface PacketInput {
  level: "junior" | "senior";
  goal: string;
  must: readonly string[];
  should: readonly string[];
  could: readonly string[];
  checklist: readonly string[];
  sealed: readonly string[];
}

export function compilePacket(input: PacketInput): { action: "push" | "split"; body: string } {
  const cap = input.level === "junior" ? JUNIOR_CAP : SENIOR_CAP;
  const mustTokens = input.must.reduce((sum, item) => sum + tokens(item), 0);
  if (mustTokens > cap) return { action: "split", body: "" };
  let used = mustTokens;
  const should: string[] = [];
  for (const item of input.should) {
    const cost = tokens(item);
    if (used + cost <= cap) {
      should.push(item);
      used += cost;
    }
  }
  const checklist = input.checklist;
  const last = checklist[checklist.length - 1];
  if (!last) throw new Error("checklist is required at the end of the packet");
  const lines = [input.goal, ...input.must, ...should, ...checklist];
  const body = lines.join("\n");
  for (const secret of input.sealed) {
    if (body.includes(secret)) throw new Error("sealed oracle leaked into the worker packet");
  }
  for (const extra of input.could) {
    if (body.includes(extra)) throw new Error("could band was pushed");
  }
  if (!body.startsWith(input.goal) || !body.endsWith(last)) {
    throw new Error("packet must start with the goal and end with the checklist");
  }
  return { action: "push", body };
}

function words(count: number, label: string): string {
  return Array.from({ length: count }, (_, index) => `${label}${index}`).join(" ");
}

export async function runAreaC(): Promise<string[]> {
  const evidence: string[] = [];
  if (CLOSED_TOUCHES.length !== 28 || new Set(CLOSED_TOUCHES).size !== 28) {
    throw new Error("touches vocabulary is not the closed set of 28");
  }
  evidence.push("closed-28-tags");
  if (!evaluateScope({ any: ["route"], all: ["personal_data", "logging"] }, ["route", "personal_data", "logging"])) {
    throw new Error("matching any/all scope was rejected");
  }
  if (evaluateScope({ all: ["personal_data", "logging"] }, ["personal_data"])) {
    throw new Error("incomplete all-scope matched");
  }
  let foreign = false;
  try {
    evaluateScope({ predicate: "endpoints" } as { any?: string[] }, ["route"]);
  } catch (error) {
    foreign = error instanceof Error && error.message.includes("scope language");
  }
  if (!foreign) throw new Error("non any/all scope was accepted");
  evidence.push("any-all-only");
  const pushed = compilePacket({
    level: "junior",
    goal: "GOAL print totals",
    must: ["MUST cutoff rule"],
    should: ["SHOULD page header"],
    could: ["COULD neighboring feature digest"],
    checklist: ["CHECKLIST print button", "CHECKLIST error banner"],
    sealed: ["SEALED held-back oracle AC-99"],
  });
  if (pushed.action !== "push" || !pushed.body.includes("MUST cutoff rule") || !pushed.body.includes("SHOULD page header")) {
    throw new Error("must and should were not pushed");
  }
  if (pushed.body.includes("COULD neighboring")) throw new Error("could band was pushed");
  evidence.push("must-should-could", "start-end-checklist", "no-sealed-leak");
  const oversized = compilePacket({
    level: "junior",
    goal: "GOAL",
    must: [words(JUNIOR_CAP + 1, "m")],
    should: ["SHOULD keep"],
    could: [],
    checklist: ["CHECKLIST end"],
    sealed: [],
  });
  if (oversized.action !== "split" || oversized.body !== "") {
    throw new Error("oversized must was truncated instead of split");
  }
  const senior = compilePacket({
    level: "senior",
    goal: "GOAL",
    must: [words(JUNIOR_CAP + 1, "s")],
    should: [],
    could: [],
    checklist: ["CHECKLIST end"],
    sealed: [],
  });
  if (senior.action !== "push") throw new Error("senior cap rejected a packet inside 4-6k");
  if (JUNIOR_CAP !== 3000 || SENIOR_CAP !== 6000) throw new Error("token caps drifted");
  evidence.push("junior-senior-caps", "hard-split-oversized-must");
  const missing = AREA_C_EVIDENCE.filter((id) => !evidence.includes(id));
  if (missing.length > 0) throw new Error(`area C missing ${missing.join(",")}`);
  return evidence;
}
