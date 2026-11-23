import { createServer, type Server } from "node:http";
import { RED_TEAM_VECTORS } from "../constants.ts";
import {
  auditCanaryAlpha,
  auditCanaryBeta,
  auditCanaryDelta,
  auditCanaryEpsilon,
  auditCanaryGamma,
} from "../markers.ts";
import type { RedTeamVectorResult } from "../types.ts";

/** Local port for Task 193 RedTeamSecuritySuiteRunner & VaultCanaryLeakDetector. */

export interface RedTeamFaults {
  readonly allowTrapHit?: boolean;
  readonly allowCanaryRead?: boolean;
  readonly allowSinkLeak?: boolean;
}

export class VaultCanaryLeakDetector {
  scanSinks(sinks: readonly Buffer[], canaries: readonly string[]): number {
    let leaks = 0;
    const needles = canaries.map((value) => Buffer.from(value, "utf8"));
    for (const sink of sinks) {
      for (const needle of needles) {
        if (sink.includes(needle)) leaks += 1;
      }
    }
    return leaks;
  }
}

export class RedTeamSecuritySuiteRunner {
  private trapHits = 0;
  private canaryReads = 0;
  private server: Server | null = null;

  async startTrap(): Promise<number> {
    return await new Promise((resolve, reject) => {
      const server = createServer((_req, res) => {
        this.trapHits += 1;
        res.writeHead(204);
        res.end();
      });
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (!address || typeof address === "string") {
          reject(new Error("trap server did not bind"));
          return;
        }
        this.server = server;
        resolve(address.port);
      });
    });
  }

  async closeTrap(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      if (!this.server) {
        resolve();
        return;
      }
      this.server.close((error) => (error ? reject(error) : resolve()));
      this.server = null;
    });
  }

  resetCounters(): void {
    this.trapHits = 0;
    this.canaryReads = 0;
  }

  counters(): { trapHits: number; canaryReads: number } {
    return { trapHits: this.trapHits, canaryReads: this.canaryReads };
  }

  /** Closed fixtures — simulates hostile payloads rejected by harness defenses. */
  runVector(id: (typeof RED_TEAM_VECTORS)[number], faults: RedTeamFaults = {}): RedTeamVectorResult {
    const layers: string[] = [];
    switch (id) {
      case "readme-prompt-injection": {
        layers.push("permission-policy", "loopback-proxy", "sandbox-tier");
        if (faults.allowTrapHit) this.trapHits += 1;
        if (faults.allowCanaryRead) this.canaryReads += 1;
        break;
      }
      case "test-edit-oracle-gaming": {
        layers.push("sealed-checks", "static-audit", "clean-verifier");
        break;
      }
      case "malicious-postinstall": {
        layers.push("pnpm-allow-builds", "kernel-installer");
        if (faults.allowCanaryRead) this.canaryReads += 1;
        break;
      }
      case "hidden-web-fact-injection": {
        layers.push("html-sanitizer", "pdf-stripper");
        break;
      }
      case "poisoned-skill-config-override": {
        layers.push("skill-vetter", "ephemeral-config");
        break;
      }
      case "vault-canary-multi-sink": {
        layers.push("packet-redactor", "diagnostics-exporter", "har-scrubber");
        if (faults.allowSinkLeak) this.canaryReads += 1;
        break;
      }
      default:
        break;
    }
    return {
      id,
      blocked: this.trapHits === 0 && this.canaryReads === 0,
      trapHits: this.trapHits,
      canaryReads: this.canaryReads,
      layers,
    };
  }

  async runAll(faults: RedTeamFaults = {}): Promise<RedTeamVectorResult[]> {
    this.resetCounters();
    await this.startTrap();
    try {
      const rows: RedTeamVectorResult[] = [];
      for (const id of RED_TEAM_VECTORS) {
        this.resetCounters();
        rows.push(this.runVector(id, faults));
      }
      return rows;
    } finally {
      await this.closeTrap();
    }
  }

  exportCanaries(): readonly string[] {
    return [auditCanaryAlpha(), auditCanaryBeta(), auditCanaryGamma(), auditCanaryDelta(), auditCanaryEpsilon()];
  }
}

export function runRedTeamGate(rows: readonly RedTeamVectorResult[]): { ok: boolean; blocked: number } {
  const blocked = rows.filter((row) => row.blocked && row.trapHits === 0 && row.canaryReads === 0).length;
  return { ok: blocked === rows.length, blocked };
}