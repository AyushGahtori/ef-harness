import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SqliteEnvProvider } from "../../src/services/index.js";
import { envRequest, makeTemp, removeTemp } from "./helpers.js";

describe("SqliteEnvProvider", () => {
  const dirs: string[] = [];
  const providers: SqliteEnvProvider[] = [];

  afterEach(async () => {
    for (const provider of providers) await provider.closeProject("project-a");
    providers.length = 0;
    for (const dir of dirs) await removeTemp(dir);
    dirs.length = 0;
  });

  it("copies a template for two isolated environments and deletes only the destroyed copy", async () => {
    const root = await makeTemp("sqlite-env-");
    dirs.push(root);
    const template = path.join(root, "template.sqlite");
    const templateWal = `${template}-wal`;
    await writeFile(template, "seed-rows");
    await writeFile(templateWal, "wal-bytes");
    const provider = new SqliteEnvProvider();
    providers.push(provider);
    const firstDir = path.join(root, "env-1");
    const secondDir = path.join(root, "env-2");
    const [first, second] = await Promise.all([
      provider.create(envRequest(firstDir, "alpha", { templatePath: template })),
      provider.create(envRequest(secondDir, "beta", { templatePath: template })),
    ]);
    expect(first.connectionString).toBe(`file:${first.filePath}`);
    expect(second.connectionString).toBe(`file:${second.filePath}`);
    expect(first.filePath).not.toBe(second.filePath);
    expect(await readFile(first.filePath, "utf8")).toBe("seed-rows");
    expect(await readFile(`${first.filePath}-wal`, "utf8")).toBe("wal-bytes");
    await writeFile(first.filePath, "mutated");
    expect(await readFile(second.filePath, "utf8")).toBe("seed-rows");
    expect(await readFile(template, "utf8")).toBe("seed-rows");
    await provider.destroy("alpha");
    await expect(stat(first.filePath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(`${first.filePath}-wal`)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(second.filePath, "utf8")).toBe("seed-rows");
    await provider.destroy("alpha");
  });

  it("re-copies the template on reset", async () => {
    const root = await makeTemp("sqlite-reset-");
    dirs.push(root);
    const template = path.join(root, "template.sqlite");
    await writeFile(template, "original");
    const provider = new SqliteEnvProvider();
    providers.push(provider);
    const created = await provider.create(
      envRequest(path.join(root, "env"), "alpha", { templatePath: template }),
    );
    await writeFile(created.filePath, "dirty");
    await provider.resetData("alpha");
    expect(await readFile(created.filePath, "utf8")).toBe("original");
  });
});
