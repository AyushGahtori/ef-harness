import { describe, expect, it } from "vitest";
import { globToPathPrefix } from "../../src/leases/index.js";
import { countRows, openState, textValue } from "./harness.js";

describe("globToPathPrefix", () => {
  it("converts the canonical write-scope examples", () => {
    expect(globToPathPrefix("src/app/kitchen/**")).toBe("src/app/kitchen/");
    expect(globToPathPrefix("tests/kitchen/print.*")).toBe("tests/kitchen/print.");
    expect(globToPathPrefix("src/app/**")).toBe("src/app/");
    expect(globToPathPrefix("src/app/foo*.ts")).toBe("src/app/foo");
    expect(globToPathPrefix("src/app")).toBe("src/app/");
    expect(globToPathPrefix("src\\app\\**")).toBe("src/app/");
    expect(globToPathPrefix("**")).toBe("");
    expect(globToPathPrefix("*")).toBe("");
    expect(globToPathPrefix("/**")).toBe("");
  });

  it("keeps a directory boundary so src/app/ does not prefix-match src/app-extra/", () => {
    const app = globToPathPrefix("src/app");
    const extra = globToPathPrefix("src/app-extra");
    expect(app).toBe("src/app/");
    expect(extra).toBe("src/app-extra/");
    expect(prefixesOverlap(app, extra)).toBe(false);
    expect(prefixesOverlap(app, "src/app/kitchen/")).toBe(true);
    expect(prefixesOverlap("src/app", "src/app-extra/")).toBe(true);
  });

  it("collapses dot segments and duplicate slashes without keeping backslashes", () => {
    expect(globToPathPrefix("./src/./app/**")).toBe("src/app/");
    expect(globToPathPrefix("src//app/**")).toBe("src/app/");
    expect(globToPathPrefix("src/app/")).toBe("src/app/");
    expect(globToPathPrefix("SRC\\App\\**")).toBe("SRC/App/");
    expect(globToPathPrefix("src/app/**/*.ts")).toBe("src/app/");
  });
});

describe("task scope registration", () => {
  it("persists normalized POSIX prefixes and replaces them on republish", () => {
    const fixture = openState();
    try {
      fixture.seed.addTask("T1");
      expect(fixture.manager.registerTaskScopes("T1", ["src\\app\\**", "src/app/", "tests/kitchen/print.*"])).toEqual([
        "src/app/",
        "tests/kitchen/print.",
      ]);
      expect(
        fixture.raw
          .prepare("SELECT path_prefix FROM task_scopes WHERE task = ? ORDER BY path_prefix")
          .all("T1")
          .map((row) => String(row.path_prefix)),
      ).toEqual(["src/app/", "tests/kitchen/print."]);
      expect(countRows(fixture.raw, "SELECT count(*) FROM task_scopes WHERE instr(path_prefix, char(92)) > 0")).toBe(0);
      expect(fixture.manager.registerTaskScopes("T1", ["**"])).toEqual([""]);
      expect(textValue(fixture.raw, "SELECT path_prefix FROM task_scopes WHERE task = ?", "T1")).toBe("");
    } finally {
      fixture.close();
    }
  });

  it("does not treat src/app/ as overlapping src/app-extra/ when a sweep is open", () => {
    const fixture = openState();
    try {
      fixture.seed.addTask("T-app");
      fixture.seed.addTask("T-extra");
      fixture.manager.registerTaskScopes("T-app", ["src/app"]);
      fixture.manager.registerTaskScopes("T-extra", ["src/app-extra"]);
      fixture.manager.openSweepIntent({
        leaseId: "L-app",
        sweepTask: "S-app",
        globs: ["src/app/**"],
        now: 1,
      });
      expect(fixture.manager.claimTask(fixture.seed.claimInput("T-app", "A-app"))).toEqual({
        claimed: false,
        reason: "sweep_overlap",
      });
      expect(fixture.manager.claimTask(fixture.seed.claimInput("T-extra", "A-extra"))).toMatchObject({
        claimed: true,
        attemptId: "A-extra",
      });
    } finally {
      fixture.close();
    }
  });

  it("treats a root wildcard as the empty prefix and blocks every scoped claim", () => {
    const fixture = openState();
    try {
      fixture.seed.addTask("T-root");
      fixture.manager.registerTaskScopes("T-root", ["**"]);
      fixture.manager.openSweepIntent({
        leaseId: "L-docs",
        sweepTask: "S-docs",
        globs: ["docs/**"],
        now: 1,
      });
      expect(fixture.manager.claimTask(fixture.seed.claimInput("T-root", "A-root"))).toEqual({
        claimed: false,
        reason: "sweep_overlap",
      });
    } finally {
      fixture.close();
    }
  });
});

function prefixesOverlap(left: string, right: string): boolean {
  return left.startsWith(right) || right.startsWith(left);
}
