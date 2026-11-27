import { describe, expect, it } from "vitest";
import {
  LocalSecretRedactor,
  MemoryArtifactLogStore,
  ReadLogTool,
  ToolOutputShrinker,
  oneLineSummary,
  shrinkBuildOutput,
  shrinkKbOutput,
  shrinkTestOutput,
} from "../../src/read-tools/index.js";
import { joined, largeProfile, smallProfile } from "./helpers.js";

function vitestLog(options?: { readonly failures?: number; readonly noise?: number }): string {
  const failures = options?.failures ?? 1;
  const lines: string[] = [];
  for (let index = 0; index < failures; index += 1) {
    const name = failures === 1 ? "AC-31" : `AC-${index + 1}`;
    lines.push(` FAIL  src/App.test.tsx > render loop > ${name}`);
    lines.push("AssertionError: expected 1 to be 2");
    if (index === 0) {
      for (let frame = 0; frame < 312; frame += 1) lines.push(" ❯ render src/App.tsx:10:1");
      for (let frame = 0; frame < 400; frame += 1) {
        lines.push(" ❯ node_modules/react-dom/cjs/react-dom.development.js:100:1");
      }
      for (let repeat = 0; repeat < 84; repeat += 1) {
        lines.push("Warning: each child in a list should have a key");
      }
    }
  }
  const noise = options?.noise ?? 0;
  while (lines.length < noise) lines.push(`noise ${lines.length}`);
  lines.push(" Test Files  1 failed (1)");
  lines.push(`      Tests  ${failures} failed | 14 passed (${14 + failures})`);
  return lines.join("\n");
}

function playwrightLog(): string {
  const lines: string[] = [];
  lines.push("  1) [chromium] › tests/login.spec.ts:12:3 › login › AC-31");
  lines.push("");
  lines.push("    Error: expect(received).toBe(expected)");
  for (let frame = 0; frame < 312; frame += 1) lines.push("       at tests/login.spec.ts:15:5");
  for (let frame = 0; frame < 400; frame += 1) lines.push("       at node_modules/playwright/lib/worker.js:1:1");
  for (let repeat = 0; repeat < 84; repeat += 1) lines.push("Warning: render loop");
  while (lines.length < 3997) lines.push(`noise ${lines.length}`);
  lines.push("  1 failed");
  lines.push("  14 passed (1.2s)");
  lines.push("  2 skipped");
  return lines.join("\n");
}

describe("shrinkTestOutput", () => {
  it("condenses a 4,000-line Vitest failure and keeps harness.read_log usable", async () => {
    const raw = vitestLog({ noise: 3998 });
    expect(raw.split("\n").length).toBeGreaterThanOrEqual(4000);
    const artifactId = "ART-42";
    const shrunk = shrinkTestOutput(raw, { artifactId, modelProfile: largeProfile() });
    expect(shrunk.lineCount).toBeLessThanOrEqual(25);
    expect(shrunk.text).not.toContain("node_modules");
    expect(shrunk.text).toContain("× 312");
    expect(shrunk.text).toContain("[repeated 84 times]");
    expect(shrunk.text).toContain("expected 1 to be 2");
    expect(shrunk.text).toContain(`harness.read_log('${artifactId}')`);
    expect(shrunk.passed).toBe(14);
    expect(shrunk.failed).toBe(1);
    expect(shrunk.oneLine).toBe("test: 14 passed, 1 failed (AC-31) [ART-42]");
    const store = new MemoryArtifactLogStore();
    store.put(artifactId, raw);
    const lookedUp = new ReadLogTool(store).readLog(artifactId, { startLine: 3, endLine: 5 });
    expect(lookedUp.lines.map((line) => line.text)).toEqual(raw.split("\n").slice(2, 5));
    const history = await new ToolOutputShrinker(largeProfile()).shrinkForHistory({
      kind: "test",
      output: raw,
      artifactId,
    });
    expect(history.text).toBe(shrunk.text);
    expect(history.oneLine).toBe(shrunk.oneLine);
    expect(history.text.split("\n").length).toBeLessThan(raw.split("\n").length);
  });

  it("condenses a 4,000-line Playwright failure to project frames only", () => {
    const raw = playwrightLog();
    expect(raw.split("\n").length).toBeGreaterThanOrEqual(4000);
    const shrunk = shrinkTestOutput(raw, { artifactId: "ART-PW", modelProfile: largeProfile() });
    expect(shrunk.lineCount).toBeLessThanOrEqual(25);
    expect(shrunk.text).not.toContain("node_modules");
    expect(shrunk.text).toContain("× 312");
    expect(shrunk.text).toContain("[repeated 84 times]");
    expect(shrunk.passed).toBe(14);
    expect(shrunk.failed).toBe(1);
    expect(shrunk.skipped).toBe(2);
    expect(shrunk.failures[0]?.name).toBe("AC-31");
  });

  it("parses Jest, pytest, Go, and Cargo failures", () => {
    const jest = shrinkTestOutput(
      [
        "FAIL src/foo.test.js",
        "  ● suite › AC-31",
        "    Expected: 2",
        "    Received: 1",
        "      at Object.<anonymous> (src/foo.test.js:10:20)",
        "      at node_modules/jest-circus/build/jestAdapterInit.js:1:1",
        "Tests:       1 failed, 14 passed, 2 skipped, 17 total",
      ].join("\n"),
      { artifactId: "ART-J", modelProfile: largeProfile() },
    );
    expect(jest.passed).toBe(14);
    expect(jest.failed).toBe(1);
    expect(jest.skipped).toBe(2);
    expect(jest.failures[0]?.name).toBe("AC-31");
    expect(jest.text).not.toContain("jest-circus");
    expect(jest.text).toContain("src/foo.test.js:10:20");

    const pytest = shrinkTestOutput(
      [
        "FAILED tests/test_print.py::test_rows - AssertionError: expected 2",
        "========================= 1 failed, 14 passed, 2 skipped in 0.12s =========================",
      ].join("\n"),
      { artifactId: "ART-PY", modelProfile: largeProfile() },
    );
    expect(pytest.failed).toBe(1);
    expect(pytest.passed).toBe(14);
    expect(pytest.failures[0]?.name).toBe("test_rows");
    expect(pytest.failures[0]?.assertion).toContain("expected 2");

    const go = shrinkTestOutput(
      ["--- FAIL: TestRows (0.00s)", "    print_test.go:18: expected 2", "--- PASS: TestOk (0.00s)", "FAIL"].join("\n"),
      { artifactId: "ART-GO", modelProfile: largeProfile() },
    );
    expect(go.failed).toBe(1);
    expect(go.passed).toBe(1);
    expect(go.failures[0]?.name).toBe("TestRows");

    const cargo = shrinkTestOutput(
      [
        "test print::rows ... FAILED",
        "test print::ok ... ok",
        "thread 'print::rows' panicked at src/print.rs:18:5:",
        "assertion `left == right` failed",
        "test result: FAILED. 14 passed; 1 failed; 2 ignored; 0 measured; 0 filtered out; finished in 0.01s",
      ].join("\n"),
      { artifactId: "ART-RS", modelProfile: largeProfile() },
    );
    expect(cargo.passed).toBe(14);
    expect(cargo.failed).toBe(1);
    expect(cargo.skipped).toBe(2);
    expect(cargo.failures[0]?.name).toBe("print::rows");
    expect(cargo.failures[0]?.assertion).toContain("panicked at");
  });

  it("caps failures at 10 on small models and 25 on large models", () => {
    const raw = vitestLog({ failures: 30, noise: 0 });
    const small = shrinkTestOutput(raw, { artifactId: "ART-S", modelProfile: smallProfile(16_000) });
    expect(small.failures).toHaveLength(10);
    expect(small.failuresOmitted).toBe(20);
    const large = shrinkTestOutput(raw, { artifactId: "ART-L", modelProfile: largeProfile() });
    expect(large.failures).toHaveLength(25);
    expect(large.failuresOmitted).toBe(5);
  });

  it("falls back to the head and tail of an unrecognized runner without returning empty", () => {
    const lines = Array.from({ length: 200 }, (_, index) => `custom-runner line ${index + 1}`);
    lines[20] = "same";
    lines[21] = "same";
    lines[22] = "same";
    const shrunk = shrinkTestOutput(lines.join("\n"), {
      artifactId: "ART-U",
      modelProfile: largeProfile(),
    });
    expect(shrunk.recognized).toBe(false);
    expect(shrunk.text).toContain("unrecognized test output [ART-U]");
    expect(shrunk.text).toContain("custom-runner line 1");
    expect(shrunk.text).toContain("custom-runner line 200");
    expect(shrunk.text).toContain("same [repeated 3 times]");
    expect(shrunk.text).toContain("lines omitted; use harness.read_log('ART-U')");
    expect(shrunk.text).not.toContain("custom-runner line 80");
    const empty = shrinkTestOutput("", { artifactId: "ART-E", modelProfile: largeProfile() });
    expect(empty.text).toContain("(empty output)");
    expect(empty.text.trim().length).toBeGreaterThan(0);
  });
});

describe("shrinkBuildOutput", () => {
  it("keeps the first 30 of 100 tsc errors, grouped by file, with the real total", () => {
    const lines: string[] = [];
    for (let file = 0; file < 5; file += 1) {
      for (let row = 0; row < 20; row += 1) {
        const index = file * 20 + row;
        lines.push(
          `src/f${file}.ts(${row + 1},1): error TS${2300 + (index % 7)}: Unique message ${index}`,
        );
      }
    }
    expect(lines).toHaveLength(100);
    const shrunk = shrinkBuildOutput(lines.join("\n"), { artifactId: "ART-9" });
    expect(shrunk.rawCount).toBe(100);
    expect(shrunk.dedupedCount).toBe(100);
    expect(shrunk.shownCount).toBe(30);
    expect(shrunk.text).toContain("showing 30 of 100 deduplicated errors (100 raw) [ART-9]");
    expect(shrunk.text).toContain("70 deduplicated errors omitted; use harness.read_log('ART-9')");
    expect(shrunk.byFile.map((group) => group.file)).toEqual(["src/f0.ts", "src/f1.ts"]);
    expect(shrunk.byFile[0]?.errors).toHaveLength(20);
    expect(shrunk.byFile[1]?.errors).toHaveLength(10);
    expect(shrunk.text).toContain("src/f0.ts");
    expect(shrunk.text).toContain("src/f1.ts");
    expect(shrunk.oneLine).toBe("build: 30 of 100 errors [ART-9]");
  });

  it("deduplicates identical tsc diagnostics before the cap", () => {
    const line = "src/a.ts(10,5): error TS2322: Type 'string' is not assignable to type 'number'.";
    const shrunk = shrinkBuildOutput(Array.from({ length: 10 }, () => line).join("\n"), { artifactId: "ART-D" });
    expect(shrunk.rawCount).toBe(10);
    expect(shrunk.dedupedCount).toBe(1);
    expect(shrunk.shownCount).toBe(1);
    expect(shrunk.text).toContain("(×10)");
    expect(shrunk.byFile).toHaveLength(1);
  });

  it("parses ESLint, Vite, Next.js, Rust, and Go diagnostics", () => {
    const eslint = shrinkBuildOutput(
      [
        "src/app.ts",
        "  10:5  error  'x' is defined but never used  @typescript-eslint/no-unused-vars",
        "  12:3  error  Unexpected console statement  no-console",
      ].join("\n"),
      { artifactId: "ART-ES" },
    );
    expect(eslint.dedupedCount).toBe(2);
    expect(eslint.byFile[0]?.file).toBe("src/app.ts");
    expect(eslint.byFile[0]?.errors[0]?.code).toBe("@typescript-eslint/no-unused-vars");

    const vite = shrinkBuildOutput("src/main.tsx:10:4: ERROR: Expected '}' but found end of file", {
      artifactId: "ART-V",
    });
    expect(vite.byFile[0]?.errors[0]).toMatchObject({ file: "src/main.tsx", line: 10, column: 4, code: "VITE" });

    const next = shrinkBuildOutput(
      ["./src/app/page.tsx:8:5", "Type error: Type 'string' is not assignable to type 'number'."].join("\n"),
      { artifactId: "ART-N" },
    );
    expect(next.byFile[0]?.errors[0]?.code).toBe("NEXT");
    expect(next.byFile[0]?.errors[0]?.line).toBe(8);

    const rust = shrinkBuildOutput(
      ["error[E0308]: mismatched types", " --> src/main.rs:10:5", "  |", "10 |     let x: i32 = \"hi\";"].join("\n"),
      { artifactId: "ART-C" },
    );
    expect(rust.byFile[0]?.errors[0]).toMatchObject({ file: "src/main.rs", line: 10, column: 5, code: "E0308" });

    const go = shrinkBuildOutput('./main.go:10:5: cannot use "hi" (untyped string constant) as int value', {
      artifactId: "ART-G",
    });
    expect(go.byFile[0]?.errors[0]).toMatchObject({ file: "main.go", line: 10, column: 5, code: "GO" });
  });
});

describe("one-line summaries and kb shrinker", () => {
  it("matches the turn-log summary examples", () => {
    expect(oneLineSummary({ kind: "read", path: "src/kitchen/print.tsx", start: 1, end: 120 })).toBe(
      "read src/kitchen/print.tsx L1-120",
    );
    expect(oneLineSummary({ kind: "grep", pattern: "toPrintRows", hits: 4, fileCount: 2 })).toBe(
      'grep "toPrintRows": 4 hits in 2 files',
    );
    expect(
      oneLineSummary({ kind: "test", passed: 14, failed: 1, failureLabel: "AC-31", artifactId: "ART-42" }),
    ).toBe("test: 14 passed, 1 failed (AC-31) [ART-42]");
  });

  it("shrinks a knowledge node to its id, version, and a bounded text slice", () => {
    const redactor = new LocalSecretRedactor();
    const secret = joined(["sk", "_live_", "ABCDEFGH123456"]);
    const shrunk = shrinkKbOutput(
      { id: "NODE-1", version: "3", text: `${"x".repeat(4500)}\n${secret}` },
      redactor,
    );
    expect(shrunk.oneLine).toBe("kb NODE-1@3");
    expect(shrunk.text).toContain('trust="kb"');
    expect(shrunk.text).toContain("NODE-1@3");
    expect(shrunk.omittedChars).toBeGreaterThan(0);
    expect(shrunk.text).toContain("characters omitted");
    expect(shrunk.text).not.toContain(secret);
  });
});
