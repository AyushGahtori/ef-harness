import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { lstat, mkdir, mkdtemp, open, readFile, readdir, readlink, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createNodeIo } from "../../src/safety-scan/fs-io.js";
import { isInsideRoot } from "../../src/safety-scan/paths.js";
import {
  BUILD_DIRECTORY_NAMES,
  GitSafetyError,
  GitSafetyScanner,
  HARNESS_EXCLUDE_ENTRIES,
  JUNK_FILE_NAMES,
  LARGE_FILE_BYTES,
  REVIEW_BANNER,
  createDefaultGitRunner,
  ensureGitInfoExclude,
} from "../../src/safety-scan/index.js";
import type {
  GitCommandResult,
  GitRunner,
  SafetyScanIo,
  SafetyScanReport,
} from "../../src/safety-scan/index.js";
import {
  entropyToken,
  fixtureMarker,
  livePrefix,
  pemBlock,
  syntheticLiveKey,
  vaultValue,
} from "./canaries.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fakeGitleaks = path.join(here, "fake-gitleaks.mjs");
const roots: string[] = [];

function git(cwd: string, args: readonly string[]): string {
  const result = spawnSync(
    "git",
    [
      "-c",
      "core.autocrlf=false",
      "-c",
      "user.name=Scanner Test",
      "-c",
      "user.email=scanner-test@example.com",
      ...args,
    ],
    { cwd, encoding: "utf8", windowsHide: true },
  );
  if (result.status !== 0) {
    throw new Error(`${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

async function withDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "ef-safety-"));
  roots.push(dir);
  return dir;
}

function scanner(root: string, extra: ConstructorParameters<typeof GitSafetyScanner>[0] = { root }) {
  return new GitSafetyScanner({ gitleaksBinary: "", ...extra, root });
}

function blob(value: unknown): string {
  return JSON.stringify(value);
}

function assertNoRaw(value: unknown, forbidden: readonly string[]): void {
  const text = blob(value);
  for (const secret of forbidden) {
    expect(text.includes(secret)).toBe(false);
  }
}

function ok(stdout: string): GitCommandResult {
  return { exitCode: 0, stdout, stderr: "", durationMs: 1 };
}

async function digestTree(root: string): Promise<string> {
  const files: string[] = [];
  async function walk(dir: string): Promise<void> {
    for (const name of (await readdir(dir)).sort()) {
      if (name === ".git") continue;
      const full = path.join(dir, name);
      const info = await lstat(full);
      const rel = path.relative(root, full).replaceAll("\\", "/");
      if (info.isSymbolicLink()) {
        files.push(`link ${rel} ${await readlink(full)}`);
        continue;
      }
      if (info.isDirectory()) {
        await walk(full);
        continue;
      }
      if (!info.isFile()) continue;
      const body = await readFile(full);
      files.push(`file ${rel} ${createHash("sha256").update(body).digest("hex")}`);
    }
  }
  await walk(root);
  return createHash("sha256").update(files.join("\n")).digest("hex");
}

function recordingGit(inner: GitRunner): GitRunner & { readonly calls: string[][] } {
  const calls: string[][] = [];
  return {
    calls,
    async execGit(args, options) {
      calls.push([...args]);
      return inner.execGit(args, options);
    },
  };
}

afterEach(async () => {
  while (roots.length > 0) {
    const dir = roots.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

describe("scanWorkingTreeForBaseline", () => {
  it("allows placeholder env examples and blocks real env files and live keys", async () => {
    const root = await withDir();
    const live = syntheticLiveKey();
    const placeholder = ["sk", "_test_", "replace_me"].join("");
    const longPlaceholder = `${placeholder}_placeholder_value_here`;
    await writeFile(path.join(root, ".env.example"), `STRIPE_SECRET_KEY=${placeholder}\n`);
    await writeFile(path.join(root, ".env.sample"), `STRIPE_SECRET_KEY=${longPlaceholder}\n`);
    await writeFile(path.join(root, ".env.template"), "TOKEN=example\n");
    await writeFile(path.join(root, ".env"), "PORT=3000\n");
    await writeFile(path.join(root, ".env.local"), `STRIPE_SECRET_KEY=${live}\n`);
    await writeFile(path.join(root, ".env.production"), "MODE=prod\n");
    const report = await scanner(root, {
      root,
      redactor: {
        redact(text: string) {
          if (text.includes(live)) throw new Error("raw secret reached redactor");
          return text;
        },
      },
    }).scanWorkingTreeForBaseline();
    const files = report.blockedSecrets.map((finding) => finding.file);
    expect(files).not.toContain(".env.example");
    expect(files).not.toContain(".env.sample");
    expect(files).not.toContain(".env.template");
    expect(files).toEqual(expect.arrayContaining([".env", ".env.local", ".env.production"]));
    const liveHit = report.blockedSecrets.find(
      (finding) => finding.file === ".env.local" && finding.ruleId === "stripe-live",
    );
    expect(liveHit?.severity).toBe("interrupt_now");
    expect(liveHit?.preview.startsWith(livePrefix())).toBe(true);
    expect(liveHit?.preview).toContain("****...****");
    expect(liveHit?.path).toBe(".env.local");
    expect(report.safeToCommit).toBe(false);
    expect(report.secretsNotCommitted).toEqual(expect.arrayContaining([".env.local"]));
    expect(report.recommendedIgnores).toEqual(
      expect.arrayContaining([".env", ".env.*", "!.env.example", "!.env.sample", "!.env.template"]),
    );
    assertNoRaw(report, [live, placeholder]);
  });

  it("blocks a live key or vault value inside an otherwise allowed env example", async () => {
    const root = await withDir();
    const live = syntheticLiveKey();
    const vault = vaultValue();
    await writeFile(path.join(root, ".env.example"), `STRIPE_SECRET_KEY=${live}\nTOKEN=${vault}\n`);
    const report = await scanner(root, {
      root,
      vaultSecrets: [{ label: "canary", value: vault }],
    }).scanWorkingTreeForBaseline();
    expect(report.blockedSecrets.map((finding) => finding.ruleId)).toEqual(
      expect.arrayContaining(["stripe-live", "vault-raw"]),
    );
    expect(report.safeToCommit).toBe(false);
    assertNoRaw(report, [live, vault, Buffer.from(vault, "utf8").toString("base64")]);
  });

  it("flags private keys, PEM blocks, and keystore magic without echoing key material", async () => {
    const root = await withDir();
    const pem = pemBlock();
    await mkdir(path.join(root, "keys"), { recursive: true });
    await writeFile(path.join(root, "keys", "server.pem"), pem);
    await writeFile(path.join(root, "id_rsa"), "private\n");
    await writeFile(path.join(root, "id_ed25519"), "private\n");
    await writeFile(path.join(root, "token.key"), "private\n");
    await writeFile(path.join(root, "store.p12"), "not-text\n");
    await writeFile(path.join(root, "store.pfx"), "not-text\n");
    const keystore = Buffer.concat([
      Buffer.from([0x30, 0x82, 0x00, 0x08, 0x06, 0x0a]),
      Buffer.from([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x0c]),
      Buffer.from([0x00]),
    ]);
    await writeFile(path.join(root, "cert.bin"), keystore);
    const report = await scanner(root).scanWorkingTreeForBaseline();
    expect(report.blockedSecrets.map((finding) => `${finding.file}:${finding.ruleId}`)).toEqual(
      expect.arrayContaining([
        "keys/server.pem:private-key-file",
        "keys/server.pem:pem-private-key",
        "id_rsa:private-key-file",
        "id_ed25519:private-key-file",
        "token.key:private-key-file",
        "store.p12:private-key-file",
        "store.pfx:private-key-file",
        "cert.bin:keystore-magic",
      ]),
    );
    expect(report.recommendedIgnores).toEqual(
      expect.arrayContaining(["*.pem", "*.key", "*.p12", "*.pfx", "id_rsa", "id_ed25519"]),
    );
    assertNoRaw(report, [pem, "AAAA"]);
  });

  it("flags synthetic high-entropy tokens and suppresses them only in marked fixture paths", async () => {
    const root = await withDir();
    const token = entropyToken();
    const marker = fixtureMarker();
    await mkdir(path.join(root, "src"), { recursive: true });
    await mkdir(path.join(root, "tests", "fixtures"), { recursive: true });
    const assignment = `export const API_TOKEN = "${token}"\n`;
    await writeFile(path.join(root, "src", "app.ts"), `// ${marker}\n${assignment}`);
    await writeFile(path.join(root, "tests", "fixtures", "sample.ts"), `// ${marker}\n${assignment}`);
    const report = await scanner(root).scanWorkingTreeForBaseline();
    expect(report.blockedSecrets.some((finding) => finding.file === "src/app.ts")).toBe(true);
    expect(report.blockedSecrets.some((finding) => finding.file === "tests/fixtures/sample.ts")).toBe(
      false,
    );
    expect(report.blockedSecrets.find((finding) => finding.file === "src/app.ts")?.ruleId).toBe(
      "high-entropy",
    );
    assertNoRaw(report, [token]);
  });

  it("still hard-blocks live keys and vault matches inside marked fixtures", async () => {
    const root = await withDir();
    const live = syntheticLiveKey();
    const vault = vaultValue();
    const marker = fixtureMarker();
    await mkdir(path.join(root, "tests", "fixtures"), { recursive: true });
    await writeFile(
      path.join(root, "tests", "fixtures", "live.ts"),
      `// ${marker}\nexport const KEY = "${live}"\n`,
    );
    await writeFile(
      path.join(root, "tests", "fixtures", "vault.json"),
      `{"note":"${marker}","token":"${vault}"}`,
    );
    const report = await scanner(root, {
      root,
      vaultSecrets: [{ label: "canary", value: vault }],
    }).scanWorkingTreeForBaseline();
    expect(report.blockedSecrets.map((finding) => finding.ruleId)).toEqual(
      expect.arrayContaining(["stripe-live", "vault-raw"]),
    );
    expect(report.safeToCommit).toBe(false);
    assertNoRaw(report, [live, vault]);
  });

  it("matches vault secrets in raw, base64, and url-encoded forms", async () => {
    const root = await withDir();
    const vault = vaultValue();
    const encoded = Buffer.from(vault, "utf8").toString("base64");
    const url = encodeURIComponent(vault);
    await writeFile(path.join(root, "raw.txt"), `token=${vault}\n`);
    await writeFile(path.join(root, "wrapped.txt"), `${encoded}\n`);
    await writeFile(path.join(root, "query.txt"), `q=${url}\n`);
    const report = await scanner(root, {
      root,
      vaultSecrets: [{ label: "canary", value: vault }],
    }).scanWorkingTreeForBaseline();
    expect(report.blockedSecrets.map((finding) => `${finding.file}:${finding.ruleId}`)).toEqual(
      expect.arrayContaining(["raw.txt:vault-raw", "wrapped.txt:vault-base64", "query.txt:vault-url"]),
    );
    assertNoRaw(report, [vault, encoded, url]);
  });

  it("flags build outputs and OS junk, and ignores content inside build directories", async () => {
    const root = await withDir();
    const token = entropyToken();
    const reads: string[] = [];
    const real = createNodeIo();
    const io: SafetyScanIo = {
      lstat: (file) => real.lstat(file),
      readlink: (file) => real.readlink(file),
      readdir: (file) => real.readdir(file),
      async readPrefix(file, maxBytes) {
        reads.push(path.relative(root, file).replaceAll("\\", "/"));
        return real.readPrefix(file, maxBytes);
      },
    };
    for (const name of BUILD_DIRECTORY_NAMES) {
      await mkdir(path.join(root, name, "pkg"), { recursive: true });
      await writeFile(
        path.join(root, name, "pkg", "index.js"),
        `export const API_TOKEN = "${token}"\n`,
      );
    }
    for (const name of JUNK_FILE_NAMES) {
      await writeFile(path.join(root, name), "junk\n");
    }
    const report = await scanner(root, { root, io }).scanWorkingTreeForBaseline();
    expect(report.safeToCommit).toBe(false);
    expect(report.recommendedIgnores).toEqual(
      expect.arrayContaining([...BUILD_DIRECTORY_NAMES.map((name) => `${name}/`), ...JUNK_FILE_NAMES]),
    );
    expect(report.blockedSecrets.some((finding) => finding.ruleId === "high-entropy")).toBe(false);
    expect(reads.some((file) => file.includes("pkg/index.js"))).toBe(false);
    assertNoRaw(report, [token]);
  });

  it("stats a multi-gigabyte file and a sparse file over 50 MB without reading them", async () => {
    const root = await withDir();
    const huge = path.join(root, "movie.iso");
    const video = path.join(root, "clip.mp4");
    await writeFile(huge, "");
    const handle = await open(video, "w");
    await handle.truncate(LARGE_FILE_BYTES + 1);
    await handle.close();
    const real = createNodeIo();
    const reads: string[] = [];
    const io: SafetyScanIo = {
      async lstat(file) {
        if (path.resolve(file) === path.resolve(huge)) {
          return {
            isFile: () => true,
            isDirectory: () => false,
            isSymbolicLink: () => false,
            size: 5 * 1024 * 1024 * 1024,
          };
        }
        return real.lstat(file);
      },
      readlink: (file) => real.readlink(file),
      readdir: (file) => real.readdir(file),
      async readPrefix(file, maxBytes) {
        const resolved = path.resolve(file);
        if (resolved === path.resolve(huge) || resolved === path.resolve(video)) {
          throw new Error(`read ${path.basename(file)}`);
        }
        reads.push(resolved);
        return real.readPrefix(file, maxBytes);
      },
    };
    const started = Date.now();
    const report = await scanner(root, { root, io }).scanWorkingTreeForBaseline();
    const elapsed = Date.now() - started;
    expect(elapsed).toBeLessThan(1000);
    expect(report.largeFiles).toEqual(
      expect.arrayContaining([
        { file: "movie.iso", sizeBytes: 5 * 1024 * 1024 * 1024 },
        { file: "clip.mp4", sizeBytes: LARGE_FILE_BYTES + 1 },
      ]),
    );
    expect(report.safeToCommit).toBe(false);
    expect(report.recommendedIgnores).toEqual(expect.arrayContaining(["movie.iso", "clip.mp4"]));
    expect(reads).toEqual([]);
    expect((await lstat(video)).size).toBe(LARGE_FILE_BYTES + 1);
  });

  it("skips text-entropy scans on binary payloads and still flags keystores", async () => {
    const root = await withDir();
    const token = entropyToken();
    const noise = Buffer.concat([
      Buffer.from([0x00]),
      Buffer.from(`export const API_TOKEN = "${token}"\n`),
    ]);
    await writeFile(path.join(root, "asset.png"), Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), noise]));
    await writeFile(path.join(root, "asset.pdf"), Buffer.concat([Buffer.from("%PDF-1.7"), noise]));
    await writeFile(path.join(root, "asset.woff2"), Buffer.concat([Buffer.from("wOF2"), noise]));
    const report = await scanner(root).scanWorkingTreeForBaseline();
    expect(report.blockedSecrets).toEqual([]);
    expect(report.safeToCommit).toBe(true);
    assertNoRaw(report, [token]);
  });

  it("flags an out-of-tree symlink and does not read the target", async () => {
    const parent = await withDir();
    const root = path.join(parent, "repo");
    const outside = path.join(parent, "outside-key");
    await mkdir(root, { recursive: true });
    const outsideBody = `outside-canary-${entropyToken()}`;
    await writeFile(outside, outsideBody);
    const link = path.join(root, "id_rsa");
    let linked = true;
    try {
      await symlink(outside, link, "file");
    } catch {
      linked = false;
    }
    const real = createNodeIo();
    const io: SafetyScanIo = linked
      ? {
          lstat: (file) => real.lstat(file),
          readlink: (file) => real.readlink(file),
          readdir: (file) => real.readdir(file),
          async readPrefix(file, maxBytes) {
            const resolved = await realpath(file).catch(() => file);
            if (!isInsideRoot(root, file) || !isInsideRoot(root, resolved)) {
              throw new Error("followed symlink");
            }
            return real.readPrefix(file, maxBytes);
          },
        }
      : {
          async lstat(file) {
            if (path.resolve(file) === path.resolve(link)) {
              return {
                isFile: () => false,
                isDirectory: () => false,
                isSymbolicLink: () => true,
                size: 0,
              };
            }
            return real.lstat(file);
          },
          async readlink(file) {
            if (path.resolve(file) === path.resolve(link)) return outside;
            return real.readlink(file);
          },
          async readdir(file) {
            if (path.resolve(file) === path.resolve(root)) return ["id_rsa"];
            return real.readdir(file);
          },
          async readPrefix(file, maxBytes) {
            if (!isInsideRoot(root, file)) throw new Error("followed symlink");
            return real.readPrefix(file, maxBytes);
          },
        };
    const report = await scanner(root, { root, io }).scanWorkingTreeForBaseline();
    expect(report.blockedSecrets.map((finding) => finding.ruleId)).toEqual(
      expect.arrayContaining(["symlink-escape", "private-key-file"]),
    );
    expect(report.safeToCommit).toBe(false);
    assertNoRaw(report, [outsideBody]);
  });

  it("does not modify the working tree while scanning", async () => {
    const root = await withDir();
    await writeFile(path.join(root, "README.md"), "hello\n");
    await writeFile(path.join(root, ".gitignore"), "coverage/\n");
    const gitRunner = recordingGit(createDefaultGitRunner());
    const before = await digestTree(root);
    const report = await scanner(root, { root, git: gitRunner }).scanWorkingTreeForBaseline();
    expect(report.safeToCommit).toBe(true);
    expect(await digestTree(root)).toBe(before);
    const commands = gitRunner.calls.map((args) => args[0]);
    expect(commands.every((command) => command === "rev-parse")).toBe(true);
  });
});

describe("generateGitignoreProposal", () => {
  it("preserves existing lines and deduplicates stack, junk, and secret ignores", async () => {
    const root = await withDir();
    const existing = "# keep me\nnode_modules/\n";
    await writeFile(path.join(root, ".gitignore"), existing);
    await writeFile(path.join(root, "package.json"), "{}\n");
    await writeFile(path.join(root, "pyproject.toml"), "[project]\nname='demo'\n");
    await writeFile(path.join(root, "Cargo.toml"), "[package]\nname='demo'\n");
    await writeFile(path.join(root, "go.mod"), "module example.com/demo\n");
    await writeFile(path.join(root, ".DS_Store"), "junk\n");
    await writeFile(path.join(root, ".env.local"), "PORT=1\n");
    const engine = scanner(root);
    const report = await engine.scanWorkingTreeForBaseline();
    const proposal = await engine.generateGitignoreProposal();
    expect(proposal.stack).toEqual(["node", "python", "rust", "go"]);
    expect(proposal.reviewBanner).toBe(REVIEW_BANNER);
    expect(proposal.existingText).toBe(existing);
    expect(proposal.proposedText.startsWith(existing)).toBe(true);
    expect(proposal.additions.filter((line) => line === "node_modules/" || line === "dist/" || line === "build/")).toEqual([
      "dist/",
      "build/",
    ]);
    expect(proposal.additions).toEqual(
      expect.arrayContaining([".venv/", "target/", "vendor/", ".DS_Store", ".env", ".env.*"]),
    );
    expect(proposal.secretsNotCommitted).toContain(".env.local");
    expect(proposal.proposedGitignoreDiff).toContain("+");
    expect(report.proposedGitignoreDiff).toBe(proposal.proposedGitignoreDiff);
    expect(report.recommendedIgnores).toEqual(proposal.additions);
  });

  it("applies an edited proposal without putting removed lines back", async () => {
    const root = await withDir();
    await writeFile(path.join(root, "package.json"), "{}\n");
    await writeFile(path.join(root, "Cargo.toml"), "[package]\nname='demo'\n");
    await writeFile(path.join(root, ".DS_Store"), "junk\n");
    const engine = scanner(root);
    const proposal = await engine.generateGitignoreProposal();
    expect(proposal.additions).toEqual(expect.arrayContaining([".DS_Store", "target/", "node_modules/"]));
    const edited = proposal.proposedText
      .split("\n")
      .filter((line) => line !== ".DS_Store" && line !== "target/")
      .join("\n");
    const applied = await engine.applyUserEditedProposal(edited, proposal);
    expect(applied.rejectedAdditions).toEqual(expect.arrayContaining([".DS_Store", "target/"]));
    expect(applied.acceptedAdditions).toContain("node_modules/");
    const written = await readFile(path.join(root, ".gitignore"), "utf8");
    expect(written).toBe(applied.writtenText);
    expect(written.includes(".DS_Store")).toBe(false);
    expect(written.includes("target/")).toBe(false);
    const again = await engine.generateGitignoreProposal();
    expect(again.additions).not.toContain(".DS_Store");
    expect(again.additions).not.toContain("target/");
    expect(again.proposedText.includes(".DS_Store")).toBe(false);
    expect(again.proposedText.includes("target/")).toBe(false);
  });
});

describe("ensureGitInfoExclude", () => {
  it("adds harness entries idempotently and does not touch .gitignore", async () => {
    const root = await withDir();
    git(root, ["init", "-b", "main"]);
    const gitignore = "# tracked ignore\nnode_modules/\n";
    await writeFile(path.join(root, ".gitignore"), gitignore);
    await writeFile(path.join(root, "README.md"), "hello\n");
    git(root, ["add", ".gitignore", "README.md"]);
    git(root, ["commit", "-m", "init"]);
    const worktree = await withDir();
    git(root, ["worktree", "add", "--detach", worktree]);
    const first = await ensureGitInfoExclude(worktree, { skillFolders: ["skills/runtime"] });
    expect(first.added).toEqual(
      expect.arrayContaining([...HARNESS_EXCLUDE_ENTRIES, "skills/runtime/"]),
    );
    const before = await readFile(first.excludePath, "utf8");
    expect(before).toContain(".harness/views/");
    expect(before).toContain(".harness/tmp/");
    expect(before).toContain("skills/runtime/");
    const second = await ensureGitInfoExclude(worktree, { skillFolders: ["skills/runtime"] });
    expect(second.added).toEqual([]);
    expect(second.alreadyPresent).toEqual(
      expect.arrayContaining([...HARNESS_EXCLUDE_ENTRIES, "skills/runtime/"]),
    );
    expect(await readFile(second.excludePath, "utf8")).toBe(before);
    expect((before.match(/\.harness\/views\//g) ?? []).length).toBe(1);
    expect(await readFile(path.join(worktree, ".gitignore"), "utf8")).toBe(gitignore);
    expect(await readFile(path.join(root, ".gitignore"), "utf8")).toBe(gitignore);
    git(root, ["worktree", "remove", "--force", worktree]);
  });

  it("resolves a gitdir pointer and refuses to invent a .git directory", async () => {
    const common = await withDir();
    const root = await withDir();
    await mkdir(path.join(common, "info"), { recursive: true });
    await writeFile(path.join(root, ".git"), `gitdir: ${common}\n`);
    const failingGit: GitRunner = {
      async execGit() {
        return { exitCode: 1, stdout: "", stderr: "no", durationMs: 1 };
      },
    };
    const result = await ensureGitInfoExclude(root, { git: failingGit });
    expect(path.resolve(result.excludePath)).toBe(path.join(common, "info", "exclude"));
    expect(await readFile(result.excludePath, "utf8")).toContain(".harness/views/");
    const plain = await withDir();
    await expect(ensureGitInfoExclude(plain, { git: failingGit })).rejects.toBeInstanceOf(GitSafetyError);
    await expect(readdir(plain)).resolves.not.toContain(".git");
    await expect(ensureGitInfoExclude(root, { git: failingGit, skillFolders: ["../escape"] })).rejects.toBeInstanceOf(
      GitSafetyError,
    );
  });
});

describe("scanCommitDiffForSecrets", () => {
  it("hard-rejects candidate diffs that contain vault, live, or entropy secrets", async () => {
    const root = await withDir();
    const live = syntheticLiveKey();
    const vault = vaultValue();
    const token = entropyToken();
    const encoded = Buffer.from(vault, "utf8").toString("base64");
    const url = encodeURIComponent(vault);
    const marker = fixtureMarker();
    git(root, ["init", "-b", "main"]);
    await writeFile(path.join(root, "README.md"), "hello\n");
    git(root, ["add", "README.md"]);
    git(root, ["commit", "-m", "base"]);
    const base = git(root, ["rev-parse", "HEAD"]).trim();
    await mkdir(path.join(root, "tests", "fixtures"), { recursive: true });
    await mkdir(path.join(root, "src"), { recursive: true });
    await mkdir(path.join(root, "data"), { recursive: true });
    await writeFile(
      path.join(root, "tests", "fixtures", "ok.ts"),
      `// ${marker}\nexport const API_TOKEN = "${token}"\n`,
    );
    const markedToken = entropyToken();
    await writeFile(
      path.join(root, "src", "app.ts"),
      `// ${marker}\nexport const API_TOKEN = "${markedToken}"\n`,
    );
    const srcToken = entropyToken();
    await writeFile(path.join(root, "src", "other.ts"), `export const API_TOKEN = "${srcToken}"\n`);
    await writeFile(path.join(root, "src", "live.ts"), `export const KEY = "${live}"\n`);
    await writeFile(path.join(root, "data", "raw.json"), `{\n  "token": "${vault}"\n}\n`);
    await writeFile(path.join(root, "data", "wrapped.txt"), `${encoded}\n`);
    await writeFile(path.join(root, "data", "query.txt"), `${url}\n`);
    git(root, ["add", "-A"]);
    git(root, ["commit", "-m", "candidate"]);
    const candidate = git(root, ["rev-parse", "HEAD"]).trim();
    const gitRunner = recordingGit(createDefaultGitRunner());
    const before = git(root, ["status", "--porcelain"]);
    const digest = await digestTree(root);
    const result = await scanner(root, {
      root,
      git: gitRunner,
      vaultSecrets: [{ label: "canary", value: vault }],
    }).scanCommitDiffForSecrets(base, candidate);
    expect(result.rejected).toBe(true);
    expect(result.severity).toBe("interrupt_now");
    expect(result.findings.some((finding) => finding.file === "tests/fixtures/ok.ts")).toBe(false);
    expect(result.findings.map((finding) => `${finding.file}:${finding.ruleId}`)).toEqual(
      expect.arrayContaining([
        "src/other.ts:high-entropy",
        "src/live.ts:stripe-live",
        "data/raw.json:vault-raw",
        "data/wrapped.txt:vault-base64",
        "data/query.txt:vault-url",
      ]),
    );
    const liveHit = result.findings.find((finding) => finding.ruleId === "stripe-live");
    expect(liveHit?.line).toBe(1);
    expect(liveHit?.preview.startsWith(livePrefix())).toBe(true);
    expect(liveHit?.preview).toContain("****...****");
    expect(result.findings.find((finding) => finding.ruleId === "vault-raw")?.line).toBe(2);
    expect(gitRunner.calls.some((args) => args.includes("--unified=0"))).toBe(true);
    expect(
      gitRunner.calls.every((args) => args[0] === "diff" || args[0] === "cat-file" || args[0] === "rev-parse"),
    ).toBe(true);
    expect(git(root, ["status", "--porcelain"])).toBe(before);
    expect(await digestTree(root)).toBe(digest);
    assertNoRaw(result, [live, vault, encoded, url, srcToken, markedToken, token]);
  });

  it("does not request a unified diff for a blob over 50 MB", async () => {
    const root = await withDir();
    const calls: string[][] = [];
    const gitRunner: GitRunner = {
      async execGit(args) {
        calls.push([...args]);
        if (args.includes("--name-only")) return ok("huge.bin\0small.txt\0");
        if (args[0] === "cat-file") {
          const spec = String(args[2] ?? "");
          return ok(spec.endsWith("huge.bin") ? String(LARGE_FILE_BYTES + 8) : "5");
        }
        if (args.includes("--unified=0")) {
          if (args.includes("huge.bin")) throw new Error("diffed a large blob");
          return ok(
            [
              "diff --git a/small.txt b/small.txt",
              "--- a/small.txt",
              "+++ b/small.txt",
              "@@ -1 +1 @@",
              "-old",
              "+hello",
              "",
            ].join("\n"),
          );
        }
        return ok("");
      },
    };
    const result = await scanner(root, { root, git: gitRunner }).scanCommitDiffForSecrets("aaa", "bbb");
    expect(result.rejected).toBe(true);
    expect(result.severity).toBe("interrupt_now");
    expect(result.findings).toEqual([
      expect.objectContaining({
        file: "huge.bin",
        path: "huge.bin",
        ruleId: "large-file",
        severity: "interrupt_now",
      }),
    ]);
    expect(calls.some((args) => args.includes("--unified=0") && args.includes("small.txt"))).toBe(true);
    expect(calls.some((args) => args.includes("--unified=0") && args.includes("huge.bin"))).toBe(false);
  });
});

describe("bundled gitleaks and the pure TypeScript fallback", () => {
  function gitleaksScanner(root: string, env: Record<string, string>) {
    return new GitSafetyScanner({
      root,
      gitleaksBinary: process.execPath,
      gitleaksArgsPrefix: [fakeGitleaks],
      gitleaksTimeoutMs: 2_000,
      gitleaksEnv: env,
    });
  }

  it("runs detect --no-git --report-format json without a shell and redacts findings", async () => {
    const root = await withDir();
    const argvFile = path.join(root, "argv.json");
    const secret = entropyToken();
    await writeFile(path.join(root, "notes.txt"), "hello\n");
    const report = await gitleaksScanner(root, {
      FAKE_GITLEAKS_MODE: "findings",
      FAKE_GITLEAKS_FILE: "notes.txt",
      FAKE_GITLEAKS_SECRET: secret,
      FAKE_GITLEAKS_ARGV_OUT: argvFile,
    }).scanWorkingTreeForBaseline();
    const argv = JSON.parse(await readFile(argvFile, "utf8")) as string[];
    expect(argv[1]).toBe(fakeGitleaks);
    expect(argv).toEqual(expect.arrayContaining(["detect", "--no-git", "--report-format", "json"]));
    expect(report.gitleaks).toMatchObject({ available: true, exitCode: 1, outcome: "findings", repairSignal: false });
    expect(report.blockedSecrets).toEqual([
      expect.objectContaining({
        file: "notes.txt",
        ruleId: "gitleaks:generic-api-key",
        preview: "****...****",
        severity: "interrupt_now",
      }),
    ]);
    expect(report.safeToCommit).toBe(false);
    assertNoRaw(report, [secret]);
  });

  it("keeps a live gitleaks hit in a fixture path and suppresses a marked benign hit", async () => {
    const root = await withDir();
    const live = syntheticLiveKey();
    const marker = fixtureMarker();
    await mkdir(path.join(root, "tests", "fixtures"), { recursive: true });
    await writeFile(path.join(root, "tests", "fixtures", "sample.txt"), `hello\n${marker}\n`);
    const blocked = await gitleaksScanner(root, {
      FAKE_GITLEAKS_MODE: "findings",
      FAKE_GITLEAKS_FILE: "tests/fixtures/sample.txt",
      FAKE_GITLEAKS_SECRET: live,
      FAKE_GITLEAKS_LINE: "1",
    }).scanWorkingTreeForBaseline();
    expect(blocked.blockedSecrets.some((finding) => finding.ruleId === "gitleaks:generic-api-key")).toBe(true);
    assertNoRaw(blocked, [live]);
    const benign = entropyToken();
    const allowed = await gitleaksScanner(root, {
      FAKE_GITLEAKS_MODE: "findings",
      FAKE_GITLEAKS_FILE: "tests/fixtures/sample.txt",
      FAKE_GITLEAKS_SECRET: benign,
      FAKE_GITLEAKS_LINE: "1",
    }).scanWorkingTreeForBaseline();
    expect(allowed.blockedSecrets.some((finding) => finding.ruleId.startsWith("gitleaks:"))).toBe(false);
    expect(allowed.gitleaks.outcome).toBe("findings");
    assertNoRaw(allowed, [benign]);
  });

  it("distinguishes leak findings from a crash, bad json, a hang, and a missing binary", async () => {
    const root = await withDir();
    await writeFile(path.join(root, "notes.txt"), "hello\n");
    const crashed = await gitleaksScanner(root, { FAKE_GITLEAKS_MODE: "crash" }).scanWorkingTreeForBaseline();
    expect(crashed.gitleaks).toMatchObject({ exitCode: 2, outcome: "crashed", repairSignal: true, timedOut: false });
    expect(crashed.warnings).toContain("gitleaks-repair");
    expect(crashed.blockedSecrets).toEqual([]);
    expect(crashed.safeToCommit).toBe(true);
    const bad = await gitleaksScanner(root, { FAKE_GITLEAKS_MODE: "bad-json" }).scanWorkingTreeForBaseline();
    expect(bad.gitleaks).toMatchObject({ exitCode: 1, outcome: "crashed", repairSignal: true });
    const clean = await gitleaksScanner(root, { FAKE_GITLEAKS_MODE: "clean" }).scanWorkingTreeForBaseline();
    expect(clean.gitleaks).toMatchObject({ exitCode: 0, outcome: "clean", repairSignal: false });
    const hung = await gitleaksScanner(root, { FAKE_GITLEAKS_MODE: "hang" }).scanWorkingTreeForBaseline();
    expect(hung.gitleaks.timedOut).toBe(true);
    expect(hung.gitleaks.repairSignal).toBe(true);
    expect(hung.gitleaks.outcome).toBe("crashed");
    const absent = await scanner(root).scanWorkingTreeForBaseline();
    expect(absent.gitleaks).toMatchObject({ available: false, outcome: "absent", repairSignal: false });
    expect(absent.safeToCommit).toBe(true);
  });

  it("still flags a TypeScript-detected secret when the gitleaks binary is absent", async () => {
    const root = await withDir();
    const live = syntheticLiveKey();
    await writeFile(path.join(root, "config.ts"), `export const KEY = "${live}"\n`);
    const report: SafetyScanReport = await scanner(root).scanWorkingTreeForBaseline();
    expect(report.gitleaks.outcome).toBe("absent");
    expect(report.blockedSecrets.some((finding) => finding.ruleId === "stripe-live")).toBe(true);
    assertNoRaw(report, [live]);
  });
});
