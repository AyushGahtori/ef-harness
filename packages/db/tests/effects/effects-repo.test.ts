import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { toPrefixedSha256 } from "@ef-harness/shared-contracts";
import { bindEffects, PayloadHashMismatchError } from "../../src/effects/index.js";
import { openProjectStateDb } from "../../src/state-db/index.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

describe("effects ledger on ProjectStateDb", () => {
  it("stores a bare payload hash on the open writer and rejects a reused key", () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "ef-c11-effects-"));
    dirs.push(rootDir);
    const stateDb = openProjectStateDb({ projectId: "C11Effects", rootDir });
    try {
      const repo = bindEffects(stateDb);
      const digest = createHash("sha256").update("effect-payload").digest("hex");
      const row = repo.record({
        id: "E1",
        kind: "git_push",
        target: "git_remote",
        payloadHash: toPrefixedSha256(digest),
        idempotencyKey: "push-1",
        now: 10,
      });
      expect(row.payloadHash).toBe(digest);
      expect(row.payloadHash).not.toContain("sha256:");
      expect(row.state).toBe("intended");
      expect(
        repo.record({
          id: "E-again",
          kind: "git_push",
          target: "git_remote",
          payloadHash: digest,
          idempotencyKey: "push-1",
          now: 11,
        }).id,
      ).toBe("E1");
      const other = createHash("sha256").update("other-payload").digest("hex");
      expect(() =>
        repo.record({
          id: "E2",
          kind: "git_push",
          target: "git_remote",
          payloadHash: other,
          idempotencyKey: "push-1",
          now: 12,
        }),
      ).toThrow(PayloadHashMismatchError);
      const sent = repo.transition("E1", "sent", 13, { leaseEpoch: 4, receipt: "ok" });
      expect(sent.state).toBe("sent");
      expect(sent.leaseEpoch).toBe(4);
      expect(sent.receipt).toBe("ok");
      const stored = stateDb.writer.get("SELECT payload_hash, state FROM effects WHERE id = ?", ["E1"]);
      expect(stored).toMatchObject({ payload_hash: digest, state: "sent" });
    } finally {
      if (!stateDb.isClosed()) stateDb.close();
    }
  });
});
