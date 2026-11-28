import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { findPrebuiltWin32Helper, isWin32HelperExecutable } from "../../src/telemetry/win32-helper-client.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("prebuilt win32 helper lookup", () => {
  it("uses an MZ helper and ignores a non-executable file", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ef-win32-helper-"));
    dirs.push(dir);
    const decoy = path.join(dir, "win32-helper.exe");
    fs.writeFileSync(decoy, "not a pe");
    expect(isWin32HelperExecutable(decoy)).toBe(false);
    expect(findPrebuiltWin32Helper([dir])).toBeNull();
    fs.writeFileSync(decoy, Buffer.from([0x4d, 0x5a, 0x00, 0x00]));
    expect(findPrebuiltWin32Helper([dir])).toBe(decoy);
  });
});
