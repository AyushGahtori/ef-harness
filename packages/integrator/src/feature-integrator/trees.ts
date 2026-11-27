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

export function listTree(repo: string, treeish: string): TreeEntry[] {
  const result = gitOk({ repo, args: ["ls-tree", "-r", treeish] });
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

export function tryReadPath(repo: string, treeish: string, filePath: string): string | null {
  const result = runGit({
    repo,
    args: ["cat-file", "-p", `${treeish}:${filePath.replaceAll("\\", "/")}`],
  });
  if (result.status !== 0) return null;
  return result.stdout;
}

export function writeBlob(repo: string, text: string): string {
  const normalized = text.endsWith("\n") ? text : `${text}\n`;
  return gitOk({ repo, args: ["hash-object", "-w", "--stdin"], input: normalized }).stdout.trim();
}

export function buildTree(repo: string, entries: readonly TreeEntry[]): string {
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

function writeDir(repo: string, dir: DirNode): string {
  const lines: string[] = [];
  for (const name of [...dir.files.keys()].sort()) {
    const file = dir.files.get(name);
    if (!file) continue;
    lines.push(`${file.mode} blob ${file.sha}\t${name}`);
  }
  for (const name of [...dir.dirs.keys()].sort()) {
    const child = dir.dirs.get(name);
    if (!child) continue;
    const sha = writeDir(repo, child);
    lines.push(`040000 tree ${sha}\t${name}`);
  }
  if (lines.length === 0) return EMPTY_TREE;
  return gitOk({ repo, args: ["mktree"], input: `${lines.join("\n")}\n` }).stdout.trim();
}

export function replaceFiles(
  repo: string,
  treeish: string,
  files: readonly { readonly path: string; readonly text: string }[],
): string {
  const map = new Map<string, TreeEntry>();
  for (const entry of listTree(repo, treeish)) {
    map.set(entry.path, entry);
  }
  for (const file of files) {
    const path = file.path.replaceAll("\\", "/");
    map.set(path, { mode: "100644", path, sha: writeBlob(repo, file.text) });
  }
  return buildTree(repo, [...map.values()]);
}

export function snapshotFiles(repo: string, treeish: string): Map<string, string> {
  const files = new Map<string, string>();
  for (const entry of listTree(repo, treeish)) {
    if (entry.mode === "120000" || entry.mode === "160000") continue;
    const text = tryReadPath(repo, treeish, entry.path);
    if (text === null || text.includes("\u0000")) continue;
    files.set(entry.path, text);
  }
  return files;
}

export function commitTree(
  repo: string,
  tree: string,
  parents: readonly string[],
  message: string,
): string {
  const args = ["commit-tree", tree];
  for (const parent of parents) {
    args.push("-p", parent);
  }
  args.push("-F", "-");
  const input = message.endsWith("\n") ? message : `${message}\n`;
  return gitOk({ repo, args, input }).stdout.trim();
}
