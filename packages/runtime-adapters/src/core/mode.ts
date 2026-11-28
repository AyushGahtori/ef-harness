import { DEFAULT_LEASED_MCP_TOOLS } from "./ports.js";
import type { ExecutionMode, SandboxTierId } from "./types.js";

export interface ModeSelectionInput {
  readonly requestedMode?: ExecutionMode;
  readonly tighterIsolation?: boolean;
  /** False when Task 151 native permission hooks fail conformance. */
  readonly nativeHooksConformant: boolean;
  readonly tier: SandboxTierId;
  readonly tierHeld: boolean;
}

export interface ModeSelection {
  readonly mode: ExecutionMode;
  readonly reason: string;
  readonly nativeFileTools: boolean;
  readonly nativeShell: boolean;
  readonly nativeWeb: boolean;
  readonly mcpTools: readonly string[];
  readonly sandboxRequired: true;
  readonly proxyRequired: true;
  readonly permissionHook: "DeterministicSupervisionPolicyEngine";
}

/**
 * Wrapped keeps the vendor edit loop inside the OS sandbox, loopback proxy,
 * and deterministic permission hook. Stripped turns native shell, file, and
 * web tools off and leaves only leased kernel MCP tools.
 */
export class WrappedVsStrippedModeSelector {
  select(input: ModeSelectionInput): ModeSelection {
    const strippedReason = this.strippedReason(input);
    if (strippedReason) {
      return {
        mode: "stripped",
        reason: strippedReason,
        nativeFileTools: false,
        nativeShell: false,
        nativeWeb: false,
        mcpTools: DEFAULT_LEASED_MCP_TOOLS,
        sandboxRequired: true,
        proxyRequired: true,
        permissionHook: "DeterministicSupervisionPolicyEngine",
      };
    }
    return {
      mode: "wrapped",
      reason: "default wrapped posture inside the OS sandbox and permission hook",
      nativeFileTools: true,
      nativeShell: true,
      nativeWeb: false,
      mcpTools: DEFAULT_LEASED_MCP_TOOLS,
      sandboxRequired: true,
      proxyRequired: true,
      permissionHook: "DeterministicSupervisionPolicyEngine",
    };
  }

  private strippedReason(input: ModeSelectionInput): string | null {
    if (input.tighterIsolation) return "tighter isolation requested";
    if (!input.nativeHooksConformant) return "native hooks failed conformance";
    if (input.tierHeld) return "sandbox tier is held";
    if (input.tier === "C") return "only a restricted sandbox tier is available";
    if (input.requestedMode === "stripped") return "stripped mode was requested";
    return null;
  }
}
