import { describe, expect, it } from "vitest";
import { atomicWriteFile, type AtomicFs } from "../../src/edits/index.js";

function errno(code: string): NodeJS.ErrnoException {
  const error = new Error(code) as NodeJS.ErrnoException;
  error.code = code;
  return error;
}

describe("atomicWriteFile", () => {
  it("retries Windows EPERM renames and never writes a partial target", () => {
    const files = new Map<string, string>([["dir/app.ts", "original"]]);
    const history: string[] = [];
    let renames = 0;
    const io: AtomicFs = {
      writeFileSync(file, data) {
        files.set(file, data);
      },
      renameSync(from, to) {
        renames += 1;
        if (renames <= 2) throw errno("EPERM");
        const data = files.get(from);
        if (data === undefined) throw errno("ENOENT");
        files.delete(from);
        files.set(to, data);
      },
      rmSync(file) {
        files.delete(file);
      },
      existsSync(file) {
        return files.has(file);
      },
      mkdirSync() {
        return undefined;
      },
    };
    const recording: AtomicFs = {
      ...io,
      writeFileSync(file, data) {
        io.writeFileSync(file, data);
        if (file === "dir/app.ts") history.push(data);
      },
      renameSync(from, to) {
        io.renameSync(from, to);
        if (to === "dir/app.ts") history.push(files.get(to) ?? "");
      },
    };
    atomicWriteFile("dir/app.ts", "complete replacement", {
      fs: recording,
      retryDelaysMs: [0, 0, 0, 0, 0],
    });
    expect(files.get("dir/app.ts")).toBe("complete replacement");
    expect(history).not.toContain("");
    expect(history).not.toContain("complete");
    expect([...files.keys()].some((name) => name.endsWith(".ef-tmp") || name.endsWith(".ef-bak"))).toBe(false);
  });

  it("restores the original file when the replacement rename fails", () => {
    const files = new Map<string, string>([["dir/app.ts", "original"]]);
    let renamedAside = false;
    const io: AtomicFs = {
      writeFileSync(file, data) {
        files.set(file, data);
      },
      renameSync(from, to) {
        if (from === "dir/app.ts") renamedAside = true;
        if (renamedAside && to === "dir/app.ts" && from !== "dir/app.ts" && !from.endsWith(".ef-bak")) {
          throw errno("EIO");
        }
        const data = files.get(from);
        if (data === undefined) throw errno("ENOENT");
        files.delete(from);
        files.set(to, data);
      },
      rmSync(file) {
        files.delete(file);
      },
      existsSync(file) {
        return files.has(file);
      },
      mkdirSync() {
        return undefined;
      },
    };
    expect(() =>
      atomicWriteFile("dir/app.ts", "next", { fs: io, retryDelaysMs: [0, 0, 0] }),
    ).toThrow("EIO");
    expect(files.get("dir/app.ts")).toBe("original");
  });
});
