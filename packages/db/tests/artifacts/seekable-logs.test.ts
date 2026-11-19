import { TextDecoder } from "node:util";
import { zstdDecompressSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  decodeSeekableFrames,
  encodeSeekableLog,
  InvalidLineRangeError,
  parseLineIndex,
  SEEKABLE_FRAME_BYTES,
  UnsafeLogPatternError,
} from "../../src/artifacts/index.js";
import { openFixture } from "./fixture.js";

const FRAME = SEEKABLE_FRAME_BYTES;

function fixedLine(n: number, width: number): string {
  const head = `L${String(n).padStart(6, "0")} `;
  return head + "x".repeat(width - 1 - head.length);
}

function fixedLog(lineCount: number, width: number): string {
  const lines = new Array<string>(lineCount);
  for (let n = 1; n <= lineCount; n += 1) lines[n - 1] = fixedLine(n, width);
  return `${lines.join("\n")}\n`;
}

function plantBoundaryEmoji(text: string): string {
  const bytes = Buffer.from(text, "utf8");
  for (let boundary = FRAME; boundary < bytes.length; boundary += FRAME) {
    const at = boundary - 2;
    if (at < 0 || at + 4 > bytes.length) continue;
    bytes.set(Buffer.from("🚀", "utf8"), at);
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

describe("seekable zstd logs", () => {
  it("keeps UTF-8 characters intact on every independent frame", () => {
    const text = `${"A".repeat(FRAME - 2)}🚀BBBB\nsecond\n`;
    const encoded = encodeSeekableLog(text, FRAME);
    const frames = decodeSeekableFrames(encoded.stored);
    const decoder = new TextDecoder("utf-8", { fatal: true });
    expect(frames.length).toBeGreaterThanOrEqual(2);
    for (const frame of frames) {
      const decoded = decoder.decode(frame);
      expect(decoded.includes("\uFFFD")).toBe(false);
    }
    expect(Buffer.concat(frames).equals(Buffer.from(text, "utf8"))).toBe(true);
  });

  it("reassembles a line and a regex match that cross a 1 MB frame boundary", () => {
    const fx = openFixture();
    try {
      const text = `${"A".repeat(FRAME - 2)}🚀BBBB\nsecond\n`;
      const stored = fx.manager.storeArtifact({
        content: text,
        kind: "log",
        retention: "diagnostic",
      });
      expect(stored.format).toBe("zstd-seekable");
      expect(stored.frameCount).toBeGreaterThanOrEqual(2);
      const range = fx.manager.readLogRange(stored.artifactId, 1, 1);
      expect(range.lines).toEqual([`${"A".repeat(FRAME - 2)}🚀BBBB`]);
      expect(range.lines[0]).not.toContain("\uFFFD");
      expect(range.framesDecompressed).toBeLessThanOrEqual(2);
      expect(range.truncated).toBe(false);
      const found = fx.manager.queryLogStream(stored.artifactId, "A🚀BBBB", 5);
      expect(found.matches.map((match) => match.lineNumber)).toEqual([1]);
      expect(found.matches[0]?.text.endsWith("🚀BBBB")).toBe(true);

      fx.state.prepare("UPDATE artifacts SET line_index = ? WHERE id = ?").run("missing-sidecar", stored.artifactId);
      const fallback = fx.manager.readLogRange(stored.artifactId, 1, 1, { regenerateMissingIndex: false });
      expect(fallback.lines).toEqual([`${"A".repeat(FRAME - 2)}🚀BBBB`]);
      expect(fallback.indexSource).toBe("frame-scan");
      expect(fallback.framesDecompressed).toBeGreaterThan(0);
      expect(fx.logs.some((event) => event.code === "LineIndexMissing")).toBe(true);
    } finally {
      fx.close();
    }
  });

  it("reads an exact 51-line window of a 5 MB log while decompressing at most two frames", () => {
    const fx = openFixture();
    try {
      const text = plantBoundaryEmoji(fixedLog(80_000, 63));
      const expected = text.split("\n");
      expected.pop();
      expect(expected).toHaveLength(80_000);
      expect(Buffer.byteLength(text)).toBeGreaterThan(5_000_000);
      const stored = fx.manager.storeArtifact({ content: text, kind: "log", retention: "diagnostic" });
      expect(stored.format).toBe("zstd-seekable");
      expect(stored.frameCount).toBeGreaterThanOrEqual(5);

      const format = fx.globalDb.prepare("SELECT format FROM cas_blobs WHERE hash = ?").get(stored.hash);
      expect(format?.format).toBe("zstd-seekable");
      const parent = fx.state.prepare("SELECT line_index FROM artifacts WHERE id = ?").get(stored.artifactId);
      const sidecarId = String(parent?.line_index);
      const sidecar = fx.state.prepare("SELECT hash FROM artifacts WHERE id = ?").get(sidecarId);
      const indexBlob = fx.cas.readCompressed(String(sidecar?.hash));
      const index = parseLineIndex(Buffer.from(zstdDecompressSync(indexBlob.storedPayload)));
      expect(index.totalLines).toBe(80_000);
      expect(index.sampleEvery).toBe(1000);
      expect(index.entries.some((entry) => entry.lineNumber === 60_000)).toBe(true);

      const range = fx.manager.readLogRange(stored.artifactId, 60_000, 60_050);
      expect(range.lines).toEqual(expected.slice(59_999, 60_050));
      expect(range.totalLines).toBe(80_000);
      expect(range.truncated).toBe(false);
      expect(range.framesDecompressed).toBeLessThanOrEqual(2);
      expect(range.framesDecompressed).toBeLessThan(stored.frameCount);
      expect(range.indexSource).toBe("sidecar");

      const emojiAt = expected.findIndex((line) => line.includes("🚀"));
      expect(emojiAt).toBeGreaterThanOrEqual(0);
      const emojiLine = fx.manager.readLogRange(stored.artifactId, emojiAt + 1, emojiAt + 1);
      expect(emojiLine.lines).toEqual([expected[emojiAt]]);
      expect(emojiLine.lines[0]).not.toContain("\uFFFD");
      expect(emojiLine.framesDecompressed).toBeLessThanOrEqual(2);

      const line = expected[emojiAt] ?? "";
      const emoji = line.indexOf("🚀");
      const cross = line.slice(emoji - 1, emoji + 3);
      const found = fx.manager.queryLogStream(stored.artifactId, escapeRegExp(cross), 3);
      expect(found.matches.some((match) => match.lineNumber === emojiAt + 1)).toBe(true);

      const past = fx.manager.readLogRange(stored.artifactId, 999_999, 999_999);
      expect(past.lines).toEqual([]);
      expect(past.totalLines).toBe(80_000);
      expect(past.truncated).toBe(false);
      expect(past.framesDecompressed).toBe(0);
      expect(() => fx.manager.readLogRange(stored.artifactId, -1, 2)).toThrow(InvalidLineRangeError);
      expect(() => fx.manager.readLogRange(stored.artifactId, 0, 1)).toThrow(InvalidLineRangeError);
      expect(() => fx.manager.readLogRange(stored.artifactId, 20, 10)).toThrow(InvalidLineRangeError);

      fx.state.prepare("UPDATE artifacts SET line_index = NULL WHERE id = ?").run(stored.artifactId);
      const scanned = fx.manager.readLogRange(stored.artifactId, 60_000, 60_050, {
        regenerateMissingIndex: false,
      });
      expect(scanned.lines).toEqual(expected.slice(59_999, 60_050));
      expect(scanned.indexSource).toBe("frame-scan");
      expect(scanned.framesDecompressed).toBe(stored.frameCount);
      expect(fx.logs.some((event) => event.code === "LineIndexMissing")).toBe(true);

      const regenerated = fx.manager.readLogRange(stored.artifactId, 60_000, 60_050);
      expect(regenerated.indexSource).toBe("regenerated");
      expect(regenerated.lines).toEqual(expected.slice(59_999, 60_050));
      const linked = fx.state.prepare("SELECT line_index FROM artifacts WHERE id = ?").get(stored.artifactId);
      expect(linked?.line_index).toEqual(expect.any(String));
      const again = fx.manager.readLogRange(stored.artifactId, 60_000, 60_050);
      expect(again.indexSource).toBe("sidecar");
      expect(again.framesDecompressed).toBeLessThanOrEqual(2);
    } finally {
      fx.close();
    }
  }, 60_000);

  it("reads lines 95000-95100 of a 10 MB log from the covering frames only", () => {
    const fx = openFixture();
    try {
      const lineCount = 100_000;
      const text = fixedLog(lineCount, 100);
      expect(Buffer.byteLength(text)).toBeGreaterThanOrEqual(10_000_000);
      const stored = fx.manager.storeArtifact({ content: text, kind: "trace", retention: "diagnostic" });
      expect(stored.frameCount).toBeGreaterThanOrEqual(9);
      const range = fx.manager.readLogRange(stored.artifactId, 95_000, 95_100);
      expect(range.lines).toHaveLength(101);
      expect(range.lines[0]).toBe(fixedLine(95_000, 100));
      expect(range.lines[100]).toBe(fixedLine(95_100, 100));
      expect(range.framesDecompressed).toBeLessThanOrEqual(2);
      expect(range.framesDecompressed).toBeGreaterThan(0);
      expect(range.framesDecompressed).toBeLessThan(stored.frameCount);
    } finally {
      fx.close();
    }
  }, 60_000);

  it("caps matches and rejects catastrophic regular expressions before decompressing", () => {
    const fx = openFixture();
    try {
      const stored = fx.manager.storeArtifact({
        content: Array.from({ length: 20 }, (_, index) => `hit-${String(index + 1)}`).join("\n"),
        kind: "log",
        retention: "ephemeral",
      });
      const capped = fx.manager.queryLogStream(stored.artifactId, "hit-\\d+", 3);
      expect(capped.matches).toHaveLength(3);
      expect(capped.capped).toBe(true);
      expect(capped.matches.map((match) => match.lineNumber)).toEqual([1, 2, 3]);

      const started = Date.now();
      expect(() => fx.manager.queryLogStream(stored.artifactId, "(a+)+$", 4)).toThrow(UnsafeLogPatternError);
      expect(() => fx.manager.queryLogStream(stored.artifactId, "(a*)*", 4)).toThrow(UnsafeLogPatternError);
      expect(() => fx.manager.queryLogStream(stored.artifactId, "(.+)+", 4)).toThrow(UnsafeLogPatternError);
      expect(() => fx.manager.queryLogStream(stored.artifactId, "(a|aa)+", 4)).toThrow(UnsafeLogPatternError);
      expect(Date.now() - started).toBeLessThan(200);

      const big = fx.manager.storeArtifact({
        content: `${"A".repeat(FRAME + 100)}\nneedle-tail\n`,
        kind: "log",
        retention: "diagnostic",
      });
      const budgeted = fx.manager.queryLogStream(big.artifactId, "needle-tail", 2, { byteBudget: 1 });
      expect(budgeted.truncated).toBe(true);
      expect(budgeted.framesDecompressed).toBe(1);
      expect(budgeted.framesDecompressed).toBeLessThan(big.frameCount);
    } finally {
      fx.close();
    }
  });
});

function escapeRegExp(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}
