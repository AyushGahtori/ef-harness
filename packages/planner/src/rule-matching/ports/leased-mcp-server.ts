import type { KbToolName, PullCallContext } from "../types.js";

export interface McpToolDefinition {
  readonly name: KbToolName;
  readonly description: string;
  readonly readOnly: true;
  readonly inputSchema: Readonly<Record<string, unknown>>;
}

export type McpInvoke = (
  name: KbToolName,
  args: Readonly<Record<string, unknown>>,
  ctx: PullCallContext,
) => unknown;

/**
 * Local port of the leased per-attempt MCP server.
 * Task 089 names `LeasedMcpServer` (Task 049). The MCP host that actually leases attempts is
 * Task 048's `AttemptMcpServer`. Register these tools there when that branch is integrated.
 */
export interface LeasedMcpServerPort {
  register(tools: readonly McpToolDefinition[], invoke: McpInvoke): void;
}

export class LocalLeasedMcpServer implements LeasedMcpServerPort {
  private tools = new Map<KbToolName, McpToolDefinition>();
  private invoke: McpInvoke | null = null;

  constructor(private readonly epoch: number) {}

  register(tools: readonly McpToolDefinition[], invoke: McpInvoke): void {
    this.tools = new Map(tools.map((tool) => [tool.name, tool]));
    this.invoke = invoke;
  }

  definitions(): readonly McpToolDefinition[] {
    return [...this.tools.values()];
  }

  call(
    name: KbToolName,
    args: Readonly<Record<string, unknown>>,
    ctx: PullCallContext,
  ): unknown {
    if (ctx.leaseEpoch !== undefined && ctx.leaseEpoch !== this.epoch) {
      return {
        ok: false,
        code: "LEASE_FENCED",
        message: "MCP lease epoch is not current",
        trust: "kb",
        label: "data",
        source: name,
      };
    }
    if (!this.invoke || !this.tools.has(name)) {
      return {
        ok: false,
        code: "TOOL_NOT_REGISTERED",
        message: `${name} is not registered on this lease`,
        trust: "kb",
        label: "data",
        source: name,
      };
    }
    return this.invoke(name, args, ctx);
  }
}
