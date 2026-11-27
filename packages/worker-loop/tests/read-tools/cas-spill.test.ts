import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { CasBlobStore } from "@ef-harness/db";
import { describe, expect, it } from "vitest";
import { ToolOutputShrinker } from "../../src/read-tools/index.js";
import { largeProfile } from "./helpers.js";

const SPILL_BYTES = 500 * 1024;

function providerToken(): string {
  return ["sk-ant", "-", "a".repeat(24)].join("");
}

function oversizedLog(token: string): string {
  const head = "HEAD-MARKER-7f3c";
  const tail = "TAIL-MARKER-7f3c";
  const middle = "MIDDLE-MARKER-7f3c";
  const leak = `leak ${token}`;
  const parts: string[] = [`${head}\n`];
  let size = Buffer.byteLength(parts[0] ?? "");
  let index = 1;
  let leaked = false;
  let marked = false;
  while (size < SPILL_BYTES) {
    let line = `custom-runner line ${index}`;
    if (!leaked && size >= 64 * 1024) {
      line = leak;
      leaked = true;
    } else if (!marked && size >= 250 * 1024) {
      line = middle;
      marked = true;
    }
    const next = `${line}\n`;
    parts.push(next);
    size += Buffer.byteLength(next);
    index += 1;
  }
  parts.push(`${tail}\n`);
  return parts.join("");
}

describe("ToolOutputShrinker CasBlobStore spill", () => {
  it("stores a 500 KB redacted tool log and returns a head and tail excerpt", async () => {
    const token = providerToken();
    const raw = oversizedLog(token);
    expect(Buffer.byteLength(raw)).toBeGreaterThanOrEqual(SPILL_BYTES);
    expect(raw.includes(token)).toBe(true);

    const root = await mkdtemp(path.join(tmpdir(), "ef-shrink-"));
    const globalDb = new DatabaseSync(":memory:");
    try {
      globalDb.exec("PRAGMA foreign_keys = ON");
      globalDb.exec(
        readFileSync(fileURLToPath(new URL("../../../../schema/global.sql", import.meta.url)), "utf8"),
      );
      const store = await CasBlobStore.open({ globalDb, rootDir: root });
      const history = await new ToolOutputShrinker(largeProfile(), { blobs: store }).shrinkForHistory({
        kind: "test",
        output: raw,
        artifactId: "ART-500",
      });

      const digest = history.digest;
      expect(history.omitted).toBe(true);
      expect(history.artifactId).toBe("ART-500");
      expect(digest).toMatch(/^sha256:[0-9a-f]{64}$/);
      if (!digest) throw new Error("CasBlobStore spill did not return a digest");
      expect(history.text).toContain("HEAD-MARKER-7f3c");
      expect(history.text).toContain("TAIL-MARKER-7f3c");
      expect(history.text).not.toContain("MIDDLE-MARKER-7f3c");
      expect(history.text).not.toContain(token);
      expect(history.text).toContain(`cas:${digest}`);
      expect(Buffer.byteLength(history.text)).toBeLessThan(64 * 1024);

      const stored = await store.getBlob(digest, "diagnostic");
      const text = stored.toString("utf8");
      expect(text).toContain("HEAD-MARKER-7f3c");
      expect(text).toContain("MIDDLE-MARKER-7f3c");
      expect(text).toContain("TAIL-MARKER-7f3c");
      expect(text).toContain("[REDACTED:ANTHROPIC_KEY]");
      expect(text.includes(token)).toBe(false);
      expect(Buffer.byteLength(text)).toBeGreaterThanOrEqual(SPILL_BYTES - token.length);
    } finally {
      globalDb.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});
