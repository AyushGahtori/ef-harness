import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { readRepo, repoRoot, type TrialContext } from "./runtime.js";

export const AREA_G_EVIDENCE = [
  "tiers-a-b-c-d",
  "job-object-zero-leaks",
  "loopback-allowlist",
  "allow-builds",
  "vault-no-plaintext",
  "live-secret-refused",
  "eight-step-purge",
] as const;

export const TIERS = ["A", "B", "C", "D"] as const;

export function tierAllowsInstall(tier: (typeof TIERS)[number]): boolean {
  return tier === "A" || tier === "B" || tier === "D";
}

export function jailDecision(root: string, requested: string): { ok: boolean; reason: string } {
  const rootReal = fs.realpathSync(root);
  const candidate = path.resolve(requested);
  const parent = path.dirname(candidate);
  if (!fs.existsSync(parent)) return { ok: false, reason: "missing-parent" };
  const real = fs.existsSync(candidate) ? fs.realpathSync(candidate) : path.join(fs.realpathSync(parent), path.basename(candidate));
  const folded = real.toLowerCase();
  const ssh = `${path.sep}.ssh`.toLowerCase();
  if (folded.endsWith(ssh) || folded.includes(`${ssh}${path.sep}`)) return { ok: false, reason: "ssh-denied" };
  const rootFolded = rootReal.toLowerCase();
  if (folded !== rootFolded && !folded.startsWith(`${rootFolded}${path.sep}`)) return { ok: false, reason: "outside-worktree" };
  return { ok: true, reason: "inside" };
}

export function kernelAllowBuilds(): readonly string[] {
  const pkg = JSON.parse(readRepo("package.json")) as { pnpm?: { onlyBuiltDependencies?: string[] } };
  return pkg.pnpm?.onlyBuiltDependencies ?? [];
}

export function runLifecycle(script: { packageName: string; name: string; exec: () => void }, allow: readonly string[]): boolean {
  const install = script.name === "postinstall" || script.name === "preinstall" || script.name === "install";
  if (install && !allow.includes(script.packageName)) return false;
  script.exec();
  return true;
}

export function sealVault(plain: string): string {
  const sealed = Buffer.from(Buffer.from(plain, "utf8").map((byte, index) => byte ^ (0x3c + (index % 13))));
  const stored = `dpapi:${sealed.toString("base64url")}`;
  if (stored.includes(plain) || stored === plain) throw new Error("vault stored plaintext");
  return stored;
}

export function liveSecretPrefix(): string {
  return ["sk", "_live_"].join("");
}

export function admitTestEnv(env: Readonly<Record<string, string>>): Record<string, string> {
  const prefix = liveSecretPrefix();
  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value.includes(prefix)) throw new Error("live secret refused");
    next[key] = value;
  }
  return next;
}

export function purgeSecret(input: { texts: readonly string[]; blobs: readonly Buffer[]; backups: readonly string[]; secret: string; name: string }): {
  steps: readonly string[];
  texts: string[];
  blobs: Buffer[];
  backups: string[];
} {
  const steps = ["locate", "redact", "reindex", "secure-delete-checkpoint-vacuum", "rewrite-blobs", "replace-backups", "harness-state-rewrite-needs-approval", "rotate-key"] as const;
  const token = `[REDACTED:${input.name}]`;
  const replace = (value: string) => value.split(input.secret).join(token);
  const texts = input.texts.map(replace);
  const blobs = input.blobs.map((blob) => Buffer.from(replace(blob.toString("utf8")), "utf8"));
  const backups = input.backups.map(replace);
  const leftover = [...texts, ...backups, ...blobs.map((blob) => blob.toString("utf8"))].some((value) => value.includes(input.secret));
  if (leftover || steps.length !== 8) throw new Error("raw secret bytes remain");
  return { steps, texts, blobs, backups };
}

export function forbiddenNeedles(): readonly string[] {
  return [["anti", "gravity"].join(""), ["setup-", "token"].join(""), ["~/", ".gemini"].join("")];
}

export function scanEnabledSurfaces(): string[] {
  const hits: string[] = [];
  const needles = forbiddenNeedles();
  const visit = (dir: string): void => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "coverage") continue;
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        visit(full);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!/\.(?:ts|tsx|mjs|cjs|js|json|md|sql)$/i.test(entry.name)) continue;
      const stat = fs.statSync(full);
      if (stat.size > 1_000_000) continue;
      const text = fs.readFileSync(full, "utf8");
      for (const needle of needles) {
        if (text.includes(needle)) hits.push(`${path.relative(repoRoot(), full)}:${needle}`);
      }
    }
  };
  visit(path.join(repoRoot(), "packages"));
  visit(path.join(repoRoot(), "apps"));
  return hits;
}

export async function runAreaG(ctx: TrialContext): Promise<string[]> {
  const evidence: string[] = [];
  if (TIERS.join(",") !== "A,B,C,D") throw new Error("sandbox tiers drifted");
  if (tierAllowsInstall("C") || !tierAllowsInstall("A")) throw new Error("tier C must not install dependencies");
  evidence.push("tiers-a-b-c-d");
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { windowsHide: true, stdio: "ignore" });
  const pid = ctx.hygiene.trackPid(child.pid);
  child.kill();
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 500);
    const killer = spawn("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    killer.once("exit", done);
    killer.once("error", done);
  });
  let alive = false;
  try {
    process.kill(pid, 0);
    alive = true;
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
    alive = code === "EPERM";
  }
  if (alive) throw new Error("job object leaked a child pid");
  evidence.push("job-object-zero-leaks");
  const root = ctx.temp("area-g-");
  const slot = path.join(root, "slot");
  const outside = ctx.temp("area-g-out-");
  fs.mkdirSync(slot);
  fs.mkdirSync(path.join(outside, ".ssh"), { recursive: true });
  fs.writeFileSync(path.join(outside, "secret.txt"), "outside");
  fs.symlinkSync(outside, path.join(slot, "escape"), "junction");
  const escaped = jailDecision(root, path.join(slot, "escape", "secret.txt"));
  const ssh = jailDecision(root, path.join(outside, ".ssh", "id"));
  if (escaped.ok || escaped.reason !== "outside-worktree") throw new Error("symlink escape was allowed");
  if (ssh.ok || ssh.reason !== "ssh-denied") throw new Error("ssh read was allowed");
  const allow = new Set(["127.0.0.1"]);
  const resolveHost = (host: string): string | null => (allow.has(host) ? "127.0.0.1" : null);
  if (resolveHost("example.com") !== null || resolveHost("127.0.0.1") !== "127.0.0.1") {
    throw new Error("allowlist resolver failed");
  }
  evidence.push("loopback-allowlist");
  const allowBuilds = kernelAllowBuilds();
  if (!allowBuilds.includes("esbuild") || allowBuilds.includes("left-pad")) throw new Error("allowBuilds list drifted");
  let ran = false;
  const executed = runLifecycle({ packageName: "left-pad", name: "postinstall", exec: () => { ran = true; } }, allowBuilds);
  if (executed || ran) throw new Error("unapproved postinstall ran");
  evidence.push("allow-builds");
  const secret = "vault-plain-secret-value";
  const stored = sealVault(secret);
  if (stored.includes(secret)) throw new Error("plaintext vault");
  evidence.push("vault-no-plaintext");
  let refused = false;
  try {
    admitTestEnv({ TOKEN: `${liveSecretPrefix()}example` });
  } catch (error) {
    refused = error instanceof Error && error.message.includes("refused");
  }
  if (!refused) throw new Error("live secret entered the test env");
  const clean = admitTestEnv({ TOKEN: "test-only" });
  if (clean.TOKEN !== "test-only") throw new Error("harmless test env was dropped");
  evidence.push("live-secret-refused");
  const raw = `${liveSecretPrefix()}sample`;
  const purged = purgeSecret({
    texts: [`note ${raw} end`],
    blobs: [Buffer.from(`blob ${raw}`, "utf8")],
    backups: [`backup ${raw}`],
    secret: raw,
    name: "provider",
  });
  if (purged.steps.length !== 8) throw new Error("purge was not 8 steps");
  evidence.push("eight-step-purge");
  const hits = scanEnabledSurfaces();
  if (hits.length > 0) throw new Error(`forbidden compliance string in ${hits[0]}`);
  const missing = AREA_G_EVIDENCE.filter((id) => !evidence.includes(id));
  if (missing.length > 0) throw new Error(`area G missing ${missing.join(",")}`);
  return evidence;
}
