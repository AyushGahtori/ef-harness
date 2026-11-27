import { gitOk, runGit } from "./git.js";

export const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

export interface TreeEntry {
  readonly mode: string;
  readonly sha: string;
  readonly path: string;
}

interface DirNode {
  readonly files: Map<string, { mode: string; sha: string }>;
  readonly dirs: Map<string, DirNode>;
}

function emptyDir(): DirNode {
  return { files: new Map(), dirs: new Map() };
}

export async function listTree(repo: string, treeish: string): Promise<TreeEntry[]> {
  const result = await gitOk({ repo, args: ["ls-tree", "-r", treeish] });
  const entries: TreeEntry[] = [];
  for (const line of result.stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const match = /^(\d{6}) \w+ ([0-9a-f]{40})\t(.+)$/.exec(line);
    const mode = match?.[1];
    const sha = match?.[2];
    const path = match?.[3];
    if (!mode || !sha || !path) continue;
    entries.push({ mode, sha, path });
  }
  return entries;
}

export async function tryReadPath(repo: string, treeish: string, filePath: string): Promise<string | null> {
  const result = await runGit({
    repo,
    args: ["cat-file", "-p", `${treeish}:${filePath.replaceAll("\\", "/")}`],
  });
  if (result.status !== 0) return null;
  return result.stdout;
}

export async function writeBlob(repo: string, text: string): Promise<string> {
  const normalized = text.endsWith("\n") ? text : `${text}\n`;
  return (await gitOk({ repo, args: ["hash-object", "-w", "--stdin"], input: normalized })).stdout.trim();
}

export async function buildTree(repo: string, entries: readonly TreeEntry[]): Promise<string> {
  const root = emptyDir();
  for (const entry of entries) {
    const parts = entry.path.split("/").filter((part) => part.length > 0);
    if (parts.length === 0) continue;
    let dir = root;
    for (let index = 0; index < parts.length - 1; index += 1) {
      const name = parts[index];
      if (!name) continue;
      let next = dir.dirs.get(name);
      if (!next) {
        next = emptyDir();
        dir.dirs.set(name, next);
      }
      dir = next;
    }
    const base = parts[parts.length - 1];
    if (!base) continue;
    dir.files.set(base, { mode: entry.mode, sha: entry.sha });
  }
  return writeDir(repo, root);
}

async function writeDir(repo: string, dir: DirNode): Promise<string> {
  const lines: string[] = [];
  for (const name of [...dir.files.keys()].sort()) {
    const file = dir.files.get(name);
    if (!file) continue;
    lines.push(`${file.mode} blob ${file.sha}\t${name}`);
  }
  for (const name of [...dir.dirs.keys()].sort()) {
    const child = dir.dirs.get(name);
    if (!child) continue;
    const sha = await writeDir(repo, child);
    lines.push(`040000 tree ${sha}\t${name}`);
  }
  if (lines.length === 0) return EMPTY_TREE;
  return (await gitOk({ repo, args: ["mktree"], input: `${lines.join("\n")}\n` })).stdout.trim();
}

export async function replaceFiles(
  repo: string,
  treeish: string,
  files: readonly { readonly path: string; readonly text: string }[],
): Promise<string> {
  const map = new Map<string, TreeEntry>();
  for (const entry of await listTree(repo, treeish)) {
    map.set(entry.path, entry);
  }
  for (const file of files) {
    const filePath = file.path.replaceAll("\\", "/");
    map.set(filePath, { mode: "100644", path: filePath, sha: await writeBlob(repo, file.text) });
  }
  return buildTree(repo, [...map.values()]);
}

export async function snapshotFiles(repo: string, treeish: string): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  for (const entry of await listTree(repo, treeish)) {
    if (entry.mode === "120000" || entry.mode === "160000") continue;
    const text = await tryReadPath(repo, treeish, entry.path);
    if (text === null || text.includes("\u0000")) continue;
    files.set(entry.path, text);
  }
  return files;
}

export async function commitTree(
  repo: string,
  tree: string,
  parents: readonly string[],
  message: string,
): Promise<string> {
  const args = ["commit-tree", tree];
  for (const parent of parents) {
    args.push("-p", parent);
  }
  args.push("-F", "-");
  const input = message.endsWith("\n") ? message : `${message}\n`;
  return (await gitOk({ repo, args, input })).stdout.trim();
}
