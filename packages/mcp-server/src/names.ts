export const HARNESS_TOOL_NAMES = [
  "harness.get_brief",
  "harness.read_result",
  "harness.ask_owner",
  "harness.dispute_test",
  "harness.report_progress",
  "harness.request_dependency",
  "harness.submit_candidate",
  "harness.run",
  "harness.read_log",
  "harness.start_service",
  "harness.fetch_docs",
  "harness.flag_blocked",
] as const;

export const KB_TOOL_NAMES = [
  "kb.search",
  "kb.get",
  "kb.neighbors",
  "kb.contract",
  "kb.why",
  "kb.code",
] as const;

export const MCP_TOOL_NAMES = [...HARNESS_TOOL_NAMES, ...KB_TOOL_NAMES] as const;

export type HarnessToolName = (typeof HARNESS_TOOL_NAMES)[number];
export type KbToolName = (typeof KB_TOOL_NAMES)[number];
export type McpToolName = (typeof MCP_TOOL_NAMES)[number];

const TOOL_NAME_SET = new Set<string>(MCP_TOOL_NAMES);

export function isMcpToolName(value: string): value is McpToolName {
  return TOOL_NAME_SET.has(value);
}

export function isKbTool(name: string): name is KbToolName {
  return (KB_TOOL_NAMES as readonly string[]).includes(name);
}

/**
 * Tools not listed in `task-packet@1.tools` are not registered.
 * `kb.*` and `harness.*` expand to the full read-only or harness families.
 * Names that are not harness MCP tools (for example `edit`) are ignored.
 */
export function resolveVisibleTools(listed: readonly string[]): McpToolName[] {
  const visible = new Set<McpToolName>();
  for (const entry of listed) {
    if (entry === "kb.*") {
      for (const name of KB_TOOL_NAMES) visible.add(name);
      continue;
    }
    if (entry === "harness.*") {
      for (const name of HARNESS_TOOL_NAMES) visible.add(name);
      continue;
    }
    if (isMcpToolName(entry)) visible.add(entry);
  }
  return MCP_TOOL_NAMES.filter((name) => visible.has(name));
}
