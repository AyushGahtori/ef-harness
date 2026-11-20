import { OPENCODE_DENY_SHELL_WEB, OPENCODE_PERMISSION_KEYS } from "./opencode-permissions.ts";

export const PINNED_PROTOCOLS = {
  acp: {
    minimumProtocolVersion: 1,
    sdk: "2.8.0",
    methods: ["initialize", "session/new", "session/prompt", "session/cancel", "session/update", "session/request_permission"],
  },
  codex: {
    command: ["codex", "app-server"],
    methods: ["initialize", "initialized", "thread/start", "thread/resume", "turn/start", "account/rateLimits/read", "item/commandExecution/requestApproval", "item/fileChange/requestApproval"],
    wire: "newline-delimited JSON-RPC with the jsonrpc member omitted",
  },
  copilot: {
    command: ["copilot", "--acp", "--stdio"],
    protocol: "acp",
  },
  claude: {
    command: ["claude", "-p", "--output-format", "stream-json", "--input-format", "stream-json", "--permission-prompt-tool", "stdio"],
    credential: "explicit console API key only",
  },
  gemini: {
    command: ["gemini", "--acp"],
    credential: "ACP handshake only; credential files are not opened",
  },
  opencode: {
    command: ["opencode", "acp"],
    permission: "ordered per-action rules, last glob wins, unmatched action asks",
  },
};

export function buildReport(input) {
  const liveCodex = input.live?.codex ?? null;
  const schedulingVerdict = liveCodex?.multiplexes === true ? "light" : "session-process";
  const liveStatus = typeof liveCodex?.handshake === "string" ? liveCodex.handshake : liveCodex?.status ?? "not_run";
  return {
    schema: "foreign-runtimes-report/1",
    unknownEventResilience: "log-and-ignore",
    codexMultiplexing: {
      fakeProcessHostsMultipleThreads: input.fake?.codex?.multiplexes === true,
      fakeVerdict: input.fake?.codex?.multiplexes === true ? "light" : "unmeasured",
      liveMultiplexes: liveCodex?.multiplexes === true,
      liveStatus,
      schedulingVerdict,
    },
    opencodePermission: {
      rule: "last-matching glob wins; a string rule matches every resource; unmatched actions ask",
      keys: OPENCODE_PERMISSION_KEYS,
      shellAndWebDenied: OPENCODE_DENY_SHELL_WEB,
      fakeEnforcement: input.fake?.opencode?.summary?.opencode ?? null,
    },
    pinnedMinimums: pinnedMinimums(input.live ?? {}),
    runtimes: {
      acp: runtimeRow("acp", input, "fake-acp"),
      codex: runtimeRow("codex", input, "fake-codex/0.0.0"),
      copilot: runtimeRow("copilot", input, "fake-copilot"),
      claude: runtimeRow("claude", input, "stream-json"),
      gemini: runtimeRow("gemini", input, "fake-gemini"),
      opencode: runtimeRow("opencode", input, "fake-opencode"),
    },
    protocols: PINNED_PROTOCOLS,
  };
}

function runtimeRow(name, input, fakeLabel) {
  const fake = input.fake?.[name] ?? {};
  const live = input.live?.[name] ?? { status: "not_run" };
  return {
    fake: {
      label: fakeLabel,
      ok: fake.ok === true,
      ignoredUnknown: fake.ignored ?? [],
    },
    live,
  };
}

function pinnedMinimums(live) {
  const pins = {};
  for (const [name, protocol] of Object.entries(PINNED_PROTOCOLS)) {
    const observed = live[name]?.version;
    pins[name] = {
      protocol,
      minimumVersion: typeof observed === "string" && observed.length > 0 ? observed : null,
    };
  }
  return pins;
}

export function renderReport(report) {
  const lines = [
    "# Foreign runtime protocol spike",
    "",
    "Fake CLIs exercise every parser without vendor accounts. Live rows record only version and handshake results from installed binaries. No model turn is sent to a paid runtime.",
    "",
    `Codex scheduling verdict: \`${report.codexMultiplexing.schedulingVerdict}\`.`,
    `Fake app-server multiplexed threads: ${report.codexMultiplexing.fakeProcessHostsMultipleThreads ? "yes" : "no"}.`,
    `Live multiplex confirmed: ${report.codexMultiplexing.liveMultiplexes ? "yes" : "no"} (handshake ${report.codexMultiplexing.liveStatus}).`,
    "",
    "Unknown JSON-RPC notifications and stream-json event types are logged and ignored. Split UTF-8 chunks, non-JSON stdout banners, and malformed lines stay on the framing buffer and do not desynchronize later messages.",
    "",
    liveIgnored(report),
    "",
    "## OpenCode permission schema",
    "",
    report.opencodePermission.rule,
    "",
    `Config keys: ${report.opencodePermission.keys.join(", ")}.`,
    "",
    "Shell and web are denied by an ordered rule set: `bash` uses `{ \"*\": \"deny\" }` (last match wins), and `webfetch` / `websearch` are the string rule `deny`. Unmatched actions such as `edit` stay `ask` until a later rule matches.",
    "",
    "## Pinned protocols",
    "",
  ];
  for (const [name, pin] of Object.entries(report.pinnedMinimums)) {
    const version = pin.minimumVersion ?? "unpinned until a live binary is observed";
    lines.push(`- ${name}: minimum observed version ${version}`);
  }
  lines.push("", "## Runtime matrix", "");
  for (const [name, row] of Object.entries(report.runtimes)) {
    const source = row.live.versionSource ? `, ${row.live.versionSource}` : "";
    lines.push(`- ${name}: fake ${row.fake.ok ? "passed" : "failed"}; live ${row.live.status}${row.live.version ? ` (${row.live.version}${source})` : ""}`);
  }
  lines.push("");
  return lines.join("\n");
}

const SECRET_MARKERS = [
  ["sk", "_live_"].join(""),
  ["sk", "-ant", "-"].join(""),
  ["sk", "-proj", "-"].join(""),
  ["ghp", "_"].join(""),
  ["AK", "IA"].join(""),
  ["BEGIN ", "PRIVATE KEY"].join(""),
];

function liveIgnored(report) {
  const ignored = report.runtimes?.codex?.live?.ignored;
  if (!Array.isArray(ignored) || ignored.length === 0) return "";
  return `Live Codex app-server notifications logged and ignored: ${[...new Set(ignored)].join(", ")}.`;
}

export function redact(text) {
  const value = text.trim();
  if (SECRET_MARKERS.some((marker) => value.includes(marker))) return "redacted";
  return value.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? "";
}
