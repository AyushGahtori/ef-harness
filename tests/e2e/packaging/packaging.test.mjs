import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { CleanMachineWinSmokeSuite } from "./CleanMachineWinSmokeSuite.mjs";
import { MissingCodeSigningCredentialsError } from "../../../scripts/packaging/lib/integrity-manifest.mjs";
import { assertReleaseSigningCredentials } from "../../../scripts/packaging/lib/signing.mjs";
import { repoRoot } from "../../../scripts/packaging/lib/paths.mjs";

const suites = [];

afterEach(() => {
  for (const suite of suites.splice(0)) {
    suite.dispose();
  }
});

describe("packaging pipeline", () => {
  it("builds unsigned win-unpacked with integrity manifest, SBOM, and asar audit", () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), "ef-pack-build-"));
    const build = spawnSync(
      process.execPath,
      [
        "scripts/packaging/build-win-nsis.mjs",
        "--unsigned-dev",
        "--dir",
        "--output",
        out,
      ],
      {
        cwd: repoRoot(),
        encoding: "utf8",
        windowsHide: true,
      },
    );
    expect(build.status, build.stderr || build.stdout).toBe(0);
    expect(fs.existsSync(path.join(out, "win-unpacked", "resources", "integrity-manifest.json"))).toBe(true);
    expect(fs.existsSync(path.join(out, "win-unpacked", "sbom.cdx.json"))).toBe(true);
    expect(fs.existsSync(path.join(out, "win-unpacked", "resources", "app.asar"))).toBe(true);
    const audit = spawnSync(
      process.execPath,
      ["scripts/packaging/audit-asar.mjs", "--target", path.join(out, "win-unpacked")],
      {
        cwd: repoRoot(),
        encoding: "utf8",
      },
    );
    expect(audit.status, audit.stderr || audit.stdout).toBe(0);
  });

  it("fails closed for --release without signing credentials", () => {
    const build = spawnSync(process.execPath, ["scripts/packaging/build-win-nsis.mjs", "--release", "--dir"], {
      cwd: repoRoot(),
      encoding: "utf8",
      env: {
        ...process.env,
        EF_CODE_SIGNING_CERT_THUMBPRINT: "",
        AZURE_TRUSTED_SIGNING_ACCOUNT: "",
        WINDOWS_SIGNING_CERTIFICATE_FILE: "",
      },
    });
    expect(build.status).toBe(2);
    expect(() => assertReleaseSigningCredentials("release")).toThrow(MissingCodeSigningCredentialsError);
  });

  it("confirms per-user NSIS config avoids mandatory elevation", () => {
    const yml = fs.readFileSync(path.join(repoRoot(), "apps", "desktop", "build", "electron-builder.yml"), "utf8");
    expect(yml).toMatch(/perMachine:\s*false/);
    expect(yml).toMatch(/allowElevation:\s*false/);
    expect(yml).toMatch(/oneClick:\s*false/);
    expect(
      fs.readFileSync(path.join(repoRoot(), "apps", "desktop", "build", "nsis", "uninstall-preserve-repos.nsh"), "utf8"),
    ).toMatch(/repositories are never deleted/i);
  });
});

describe("CleanMachineWinSmokeSuite", () => {
  it("passes stripped-PATH unicode profile smoke", async () => {
    const suite = new CleanMachineWinSmokeSuite();
    suites.push(suite);
    const started = performance.now();
    const result = await suite.runAll();
    const elapsed = (performance.now() - started) / 1000;
    expect(result.ok, CleanMachineWinSmokeSuite.formatIssues(result.issues)).toBe(true);
    expect(result.integrityPercent).toBe(100);
    expect(result.launchMs).toBeLessThan(4000);
    expect(elapsed).toBeLessThan(30);
  });
});