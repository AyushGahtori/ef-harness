import type { AdapterConformanceWrite, GlobalBrokerDb } from "@ef-harness/db";
import type { GlobalDbConformancePort, AdapterConformanceRecord } from "./ports.js";
import type { AdapterMode, ConformanceCacheKey, ConformanceReport, SandboxTierId, TrustLevel } from "./types.js";

export class BrokerAdapterConformanceDb implements GlobalDbConformancePort {
  constructor(private readonly broker: GlobalBrokerDb) {}

  upsert(record: AdapterConformanceRecord): void {
    this.broker.upsertAdapterConformance({
      adapterId: record.adapterId,
      cliVersion: record.cliVersion,
      osSandboxTier: record.osSandboxTier,
      mode: record.mode,
      suiteVersion: record.suiteVersion,
      trust: record.trust,
      payload: record.payload,
      signature: record.signature,
      reportJson: JSON.stringify(record.report),
    });
  }

  activate(key: ConformanceCacheKey, mode: AdapterMode): void {
    this.broker.activateAdapterConformance({
      adapterId: key.adapterId,
      cliVersion: key.cliVersion,
      osSandboxTier: key.sandboxTier,
      suiteVersion: key.harnessConformanceSuiteVersion,
      mode,
    });
  }

  findActive(key: ConformanceCacheKey): AdapterConformanceRecord | null {
    const row = this.broker.findActiveAdapterConformance({
      adapterId: key.adapterId,
      cliVersion: key.cliVersion,
      osSandboxTier: key.sandboxTier,
      suiteVersion: key.harnessConformanceSuiteVersion,
    });
    if (!row) return null;
    return rowToRecord(row);
  }

  rewriteSignature(key: ConformanceCacheKey, signature: string): void {
    this.broker.rewriteAdapterConformanceSignature(
      {
        adapterId: key.adapterId,
        cliVersion: key.cliVersion,
        osSandboxTier: key.sandboxTier,
        suiteVersion: key.harnessConformanceSuiteVersion,
      },
      signature,
    );
  }
}

function rowToRecord(row: AdapterConformanceWrite): AdapterConformanceRecord {
  const report = JSON.parse(row.reportJson) as ConformanceReport;
  return {
    adapterId: row.adapterId,
    cliVersion: row.cliVersion,
    osSandboxTier: row.osSandboxTier as SandboxTierId,
    mode: row.mode as AdapterMode,
    suiteVersion: row.suiteVersion,
    trust: row.trust as TrustLevel,
    payload: row.payload,
    signature: row.signature,
    report,
  };
}
