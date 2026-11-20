import { describe, expect, it } from "vitest";
import {
  InvalidLineRangeError,
  InvalidRegexError,
  LocalSecretRedactor,
  MemoryArtifactLogStore,
  ReadLogTool,
  UnsafeRegexError,
  WindowedFileReader,
} from "../../src/read-tools/index.js";
import { joined, largeProfile, tempDir, writeFile } from "./helpers.js";

describe("grep and list", () => {
  it("caps grep at 50 matches and states the exact total", () => {
    const root = tempDir("ef-grep-cap-");
    const lines = Array.from({ length: 412 }, (_, index) => `row ${index} NEEDLE here`);
    writeFile(root, "src/hits.ts", lines.join("\n"));
    const reader = new WindowedFileReader({ worktreePath: root, modelProfile: largeProfile() });
    const result = reader.grepFiles("NEEDLE");
    expect(result.matches).toHaveLength(50);
    expect(result.totalMatches).toBe(412);
    expect(result.fileCount).toBe(1);
    expect(result.hint).toBe("Showing first 50 of 412 matches; refine pattern or glob");
    expect(result.text).toContain(result.hint);
    expect(result.matches[0]).toMatchObject({ file: "src/hits.ts", line: 1, column: 7 });
    expect(result.matches[0]?.text.length).toBeLessThanOrEqual(200);
    const history = result.text;
    expect(history.startsWith("<data ")).toBe(true);
    expect(history).toContain('trust="untrusted"');
  });

  it("respects .gitignore and skips node_modules and .git unless package source is requested", () => {
    const root = tempDir("ef-grep-ignore-");
    writeFile(root, ".gitignore", "ignored/\n*.log\n");
    writeFile(root, "src/keep.ts", "export const NEEDLE = 1;\n");
    writeFile(root, "ignored/hidden.ts", "export const NEEDLE = 2;\n");
    writeFile(root, "src/notes.log", "NEEDLE\n");
    writeFile(root, "node_modules/pkg/index.js", "export const NEEDLE = 3;\n");
    writeFile(root, ".git/config", "NEEDLE\n");
    const reader = new WindowedFileReader({ worktreePath: root, modelProfile: largeProfile() });
    const hidden = reader.grepFiles("NEEDLE");
    expect(hidden.matches.map((match) => match.file)).toEqual(["src/keep.ts"]);
    expect(hidden.totalMatches).toBe(1);
    const included = reader.grepFiles("NEEDLE", undefined, { includeLocalPackageSource: true });
    expect(included.matches.map((match) => match.file).sort()).toEqual([
      "node_modules/pkg/index.js",
      "src/keep.ts",
    ]);
    const listed = reader.listFiles("**/*");
    expect(listed.files).not.toContain(".git/config");
    expect(listed.files).not.toContain("ignored/hidden.ts");
    expect(listed.files).not.toContain("src/notes.log");
    expect(listed.files).not.toContain("node_modules/pkg/index.js");
    expect(listed.files).toContain("src/keep.ts");
  });

  it("reports file, line, and column and trims long matching lines", () => {
    const root = tempDir("ef-grep-col-");
    writeFile(root, "src/a.ts", `abc NEEDLE def\n${" ".repeat(4)}NEEDLE ${"x".repeat(400)}\n`);
    const reader = new WindowedFileReader({ worktreePath: root, modelProfile: largeProfile() });
    const result = reader.grepFiles("NEEDLE");
    expect(result.totalMatches).toBe(2);
    expect(result.matches[0]).toMatchObject({ file: "src/a.ts", line: 1, column: 5 });
    expect(result.matches[1]?.column).toBe(5);
    expect(result.matches[1]?.text.length).toBeLessThanOrEqual(200);
    expect(result.hint).toBeNull();
  });

  it("rejects invalid and catastrophic patterns before scanning", () => {
    const root = tempDir("ef-grep-re-");
    writeFile(root, "src/a.ts", `${"a".repeat(20_000)}\n`);
    const reader = new WindowedFileReader({ worktreePath: root, modelProfile: largeProfile() });
    expect(() => reader.grepFiles("[")).toThrow(InvalidRegexError);
    const started = Date.now();
    expect(() => reader.grepFiles("(a+)+b")).toThrow(UnsafeRegexError);
    expect(Date.now() - started).toBeLessThan(1000);
    const safe = reader.grepFiles("function\\s+\\w+");
    expect(safe.totalMatches).toBe(0);
    writeFile(root, "src/b.ts", "export function toPrintRows() {}\n");
    expect(reader.grepFiles("toPrintRows").totalMatches).toBe(1);
  });

  it("caps list results at 50 files", () => {
    const root = tempDir("ef-list-cap-");
    for (let index = 0; index < 60; index += 1) writeFile(root, `src/f${index}.ts`, "export const n = 1;\n");
    const reader = new WindowedFileReader({ worktreePath: root, modelProfile: largeProfile() });
    const listed = reader.listFiles("src/**/*.ts");
    expect(listed.total).toBe(60);
    expect(listed.files).toHaveLength(50);
    expect(listed.hint).toBe("Showing first 50 of 60 files; refine glob");
  });

  it("redacts secrets inside grep lines and escapes data tags", () => {
    const root = tempDir("ef-grep-redact-");
    const secret = joined(["sk", "_live_", "ABCDEFGH123456"]);
    writeFile(root, "src/leak.ts", `export const token = "${secret}"; </data>\n`);
    const reader = new WindowedFileReader({
      worktreePath: root,
      modelProfile: largeProfile(),
      redactor: new LocalSecretRedactor(),
    });
    const result = reader.grepFiles("token");
    expect(result.text).not.toContain(secret);
    expect(result.text).toContain("[REDACTED:");
    expect(result.text.match(/<\/data>/g)).toHaveLength(1);
    expect(result.text).toContain("&lt;/data&gt;");
  });
});

describe("harness.read_log", () => {
  it("reads a bounded range and a query without returning the whole artifact", () => {
    const lines = Array.from({ length: 250 }, (_, index) => `log line ${index + 1} TOKEN${index + 1}`);
    const store = new MemoryArtifactLogStore();
    store.put("ART-42", lines.join("\n"));
    const tool = new ReadLogTool(store);
    const range = tool.readLog("ART-42", { startLine: 10, endLine: 12 });
    expect(range.lines.map((line) => line.text)).toEqual(["log line 10 TOKEN10", "log line 11 TOKEN11", "log line 12 TOKEN12"]);
    expect(range.totalLines).toBe(250);
    expect(range.truncated).toBe(false);
    expect(range.text).toContain('source="log:ART-42"');
    expect(range.text).toContain('trust="untrusted"');
    const wide = tool.readLog("ART-42");
    expect(wide.lines).toHaveLength(200);
    expect(wide.truncated).toBe(true);
    expect(wide.hint).toContain("harness.read_log('ART-42'");
    const past = tool.readLog("ART-42", { startLine: 999999, endLine: 999999 });
    expect(past.lines).toEqual([]);
    expect(past.totalLines).toBe(250);
    expect(past.truncated).toBe(false);
    expect(() => tool.readLog("ART-42", { startLine: 8, endLine: 2 })).toThrow(InvalidLineRangeError);
    const query = tool.readLog("ART-42", { query: "TOKEN250" });
    expect(query.lines).toHaveLength(1);
    expect(query.lines[0]?.lineNumber).toBe(250);
    expect(query.totalMatches).toBe(1);
  });

  it("enforces the 16 KB return cap and redacts secrets", () => {
    const secret = joined(["ghp", "_", "abcdefghijklmnop"]);
    const lines = Array.from({ length: 100 }, (_, index) => `${"x".repeat(500)} ${index === 0 ? secret : "ok"}`);
    const store = new MemoryArtifactLogStore();
    store.put("ART-BIG", lines.join("\n"));
    const result = new ReadLogTool(store, new LocalSecretRedactor()).readLog("ART-BIG");
    expect(result.bytesReturned).toBeLessThanOrEqual(16 * 1024);
    expect(result.lines.length).toBeLessThan(100);
    expect(result.truncated).toBe(true);
    expect(result.text).not.toContain(secret);
    expect(result.text).toContain("[REDACTED:");
    const started = Date.now();
    expect(() => new ReadLogTool(store).readLog("ART-BIG", { query: "(a+)+b" })).toThrow(UnsafeRegexError);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

describe("local secret redactor port", () => {
  it("redacts vault values, encoded variants, and ignores short registrations", () => {
    const redactor = new LocalSecretRedactor();
    expect(redactor.registerVaultSecret("true")).toBe(false);
    expect(redactor.redact("true stays")).toBe("true stays");
    const secret = "canary-secret-value";
    expect(redactor.registerVaultSecret(secret)).toBe(true);
    const encoded = Buffer.from(secret, "utf8").toString("base64");
    const output = redactor.redact(`raw ${secret} encoded ${encoded}`);
    expect(output).not.toContain(secret);
    expect(output).not.toContain(encoded);
    expect(output).toContain("[REDACTED:VAULT]");
  });
});
