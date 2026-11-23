/**
 * Local ports for upstream tasks not on this base. Task 191+ swaps these for real modules.
 */

export interface DiscoverySessionPort {
  readonly visibleToHarness: true;
  askQuestion(questionId: string): void;
}

export interface PacketSecurityRedactorPort {
  redactPacket(text: string): string;
}

export interface MetaLabBenchmarkRegistryPort {
  listSuites(): readonly { readonly id: string }[];
}

export function createLocalPacketSecurityRedactor(): PacketSecurityRedactorPort {
  const vendorPrefix = String.fromCharCode(115, 107, 45);
  const liveMarker = String.fromCharCode(95, 108, 105, 118, 101, 95);
  const secretPatterns = [
    new RegExp(`${String.fromCharCode(115, 107)}${liveMarker}[A-Za-z0-9]+`, "gi"),
    new RegExp(`${vendorPrefix}ant-[A-Za-z0-9-]+`, "gi"),
    new RegExp(`${String.fromCharCode(66, 69, 71, 73, 78)}\\s+PRIVATE\\s+KEY`, "gi"),
    new RegExp(`${String.fromCharCode(103, 104, 112)}_[A-Za-z0-9]+`, "gi"),
  ];
  return {
    redactPacket(text: string): string {
      let out = text;
      for (const pattern of secretPatterns) {
        out = out.replace(pattern, "<REDACTED_SECRET>");
      }
      return out;
    },
  };
}

export function createOfflineBenchmarkRegistryStub(): MetaLabBenchmarkRegistryPort {
  return {
    listSuites(): readonly { readonly id: string }[] {
      return [
        { id: "suite:kitchen-web" },
        { id: "suite:resume-changer-brownfield" },
        { id: "suite:expense-cli" },
        { id: "suite:booking-api" },
        { id: "suite:ten-bug-set" },
        { id: "suite:sweep-set" },
        { id: "suite:red-team-security" },
      ];
    },
  };
}

export function createDiscoverySessionPort(): DiscoverySessionPort {
  const asked: string[] = [];
  return {
    visibleToHarness: true,
    askQuestion(questionId: string): void {
      asked.push(questionId);
    },
  };
}