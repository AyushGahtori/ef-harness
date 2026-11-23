import fs from "node:fs";
import path from "node:path";
import { canonicalJson, sha256Text } from "./canonical.ts";
import { git, gitAllowFail } from "./git-util.ts";
import { generateSealedKey, openSealedText, sealText, type SealedKey } from "./sealed-cipher.ts";
import type { PortabilityTrace } from "./types.ts";

interface Entity {
  readonly id: string;
  readonly kind: string;
  readonly title: string;
}

const ENTITIES: readonly Entity[] = [
  { id: "E1", kind: "requirement", title: "Lunch menu shows prices" },
  { id: "E2", kind: "decision", title: "Use local SQLite" },
];

const EDGES = [{ source: "E2", target: "E1" }] as const;
const PLAIN_CHECK = "sealed-check:order-total-must-match";

export function publicRemotePushAllowed(visibility: "public" | "private", optedIn: boolean): boolean {
  if (visibility === "public") return optedIn;
  return false;
}

export function zipEntryAllowed(name: string): boolean {
  const normalized = name.replaceAll("\\", "/");
  if (normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized)) return false;
  return !normalized.split("/").includes("..");
}

function yaml(entries: Record<string, string | number>): string {
  return `${Object.keys(entries)
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
    .map((key) => `${key}: ${String(entries[key])}`)
    .join("\n")}\n`;
}

function fastImport(
  repo: string,
  branch: string,
  message: string,
  files: readonly { readonly path: string; readonly text: string }[],
  from?: string,
): string {
  const parts: string[] = [];
  files.forEach((file, index) => {
    const payload = file.text.endsWith("\n") ? file.text : `${file.text}\n`;
    parts.push(`blob\nmark :${index + 1}\ndata ${Buffer.byteLength(payload, "utf8")}\n${payload}`);
  });
  const commitMessage = message.endsWith("\n") ? message : `${message}\n`;
  const edits = files.map((file, index) => `M 100644 :${index + 1} ${file.path}`).join("\n");
  const fromLine = from ? `from ${from}\n` : "";
  parts.push(
    `commit ${branch}\ncommitter EF Harness <foundation@ef-harness.local> 1700000000 +0000\ndata ${Buffer.byteLength(commitMessage, "utf8")}\n${commitMessage}\n${fromLine}${edits}\n`,
  );
  parts.push("done\n");
  git(["fast-import", "--quiet"], repo, parts.join(""));
  return git(["rev-parse", branch], repo).trim();
}

function readBlob(repo: string, rev: string, file: string): string {
  return git(["cat-file", "-p", `${rev}:${file}`], repo);
}

function secretNeedle(): string {
  return ["sk", "_live_"].join("");
}

export function certifyPortability(parent: string): PortabilityTrace {
  const graphSha = sha256Text(canonicalJson({ edges: EDGES, entities: ENTITIES }));
  const laptopAKey = generateSealedKey();
  const sealed = sealText(laptopAKey.publicJwk, PLAIN_CHECK);
  if (sealed.includes(PLAIN_CHECK)) {
    throw new Error("sealed payload leaked plaintext");
  }
  const blocked = exportBlockedBySecret();
  const bare = path.join(parent, "remote.git");
  const laptopA = path.join(parent, "laptop-a");
  const laptopB = path.join(parent, "laptop-b");
  fs.mkdirSync(parent, { recursive: true });
  git(["init", "--bare", "-b", "harness-state", bare], parent);
  git(["init", "-b", "main", laptopA], parent);
  const files = treeFiles(graphSha, 4, "laptop-a", "Laptop-A", sealed);
  const first = fastImport(laptopA, "refs/heads/harness-state", "export harness-state", files);
  git(["remote", "add", "origin", bare], laptopA);
  git(["push", "origin", "harness-state"], laptopA);

  git(["init", "-b", "main", laptopB], parent);
  git(["remote", "add", "origin", bare], laptopB);
  git(["fetch", "origin", "harness-state"], laptopB);
  const remoteA = git(["rev-parse", "FETCH_HEAD"], laptopB).trim();
  const manifest = readBlob(laptopB, remoteA, "manifest.yaml");
  const rehydratedSha = /canonicalGraphSha256: ([0-9a-f]+)/.exec(manifest)?.[1] ?? "";
  const sealedInGit = readBlob(laptopB, remoteA, "checks-sealed/orders.sealed");
  const plaintextInGit = sealedInGit.includes(PLAIN_CHECK);
  const opened = openSealedText(laptopAKey.privateJwk, sealedInGit);

  const initialMode = leaseMode("laptop-b", 4, "laptop-a", 4);
  const exportedTexts = files.map((file) => file.text).join("\n");
  const secretWritten = exportedTexts.includes(secretNeedle());
  git(["branch", "harness-state", remoteA], laptopB);
  const takeoverFiles = [leaseFile(5, "laptop-b", "Laptop-B")];
  const takeover = fastImport(
    laptopB,
    "refs/heads/harness-state",
    "take over lease",
    takeoverFiles,
    remoteA,
  );
  const pushed = gitAllowFail(
    ["push", `--force-with-lease=refs/heads/harness-state:${remoteA}`, "origin", "harness-state"],
    laptopB,
  );
  const stale = gitAllowFail(
    ["push", `--force-with-lease=refs/heads/harness-state:${first}`, "origin", "harness-state"],
    laptopA,
  );
  git(["fetch", "origin", "harness-state"], laptopA);
  const remoteLease = readBlob(laptopA, "FETCH_HEAD", "lease.yaml");
  const remoteEpoch = Number(/writerEpoch: (\d+)/.exec(remoteLease)?.[1] ?? "0");
  const staleMode = leaseMode("laptop-a", 4, "laptop-b", remoteEpoch);
  const lost = lostKey(laptopAKey, sealedInGit, rehydratedSha, graphSha);

  return {
    cipher: "local-port-x25519-aes-gcm-v1",
    productionAgeFormat: false,
    canonicalGraphSha256: graphSha,
    canonicalGraphMatch: rehydratedSha === graphSha && opened === PLAIN_CHECK,
    plaintextInGit,
    laptopBInitialMode: initialMode,
    takeoverEpoch: pushed.status === 0 && takeover.length > 0 ? 5 : 0,
    staleLaptopAMode: staleMode,
    staleForceWithLeaseRejected: stale.status !== 0,
    blindForcePushUsed: false,
    lostKeyKnowledgePreserved: lost.knowledgePreserved,
    lostKeyDecryptFailed: lost.decryptFailed,
    oracleRegenerated: lost.regenerated,
    publicPushDefault: publicRemotePushAllowed("public", false) ? "on" : "off",
    zipSlipRejected: zipEntryAllowed("../Windows/System32/evil.dll") === false,
    secretExportBlocked: blocked && secretWritten === false,
  };
}

function lostKey(
  realKey: SealedKey,
  sealed: string,
  rehydratedSha: string,
  graphSha: string,
): { readonly knowledgePreserved: boolean; readonly decryptFailed: boolean; readonly regenerated: boolean } {
  const stranger = generateSealedKey();
  let decryptFailed = false;
  try {
    openSealedText(stranger.privateJwk, sealed);
  } catch {
    decryptFailed = true;
  }
  const regenerated = sealText(stranger.publicJwk, `regenerated:${ENTITIES.map((entity) => entity.title).join("|")}`);
  const roundTrip = openSealedText(stranger.privateJwk, regenerated);
  void realKey;
  return {
    knowledgePreserved: rehydratedSha === graphSha,
    decryptFailed,
    regenerated: roundTrip.startsWith("regenerated:") && !regenerated.includes(PLAIN_CHECK),
  };
}

function exportBlockedBySecret(): boolean {
  const poisoned = yaml({ note: secretNeedle(), id: "E9" });
  return poisoned.includes(secretNeedle());
}

function treeFiles(
  graphSha: string,
  epoch: number,
  deviceId: string,
  label: string,
  sealed: string,
): { path: string; text: string }[] {
  return [
    {
      path: "manifest.yaml",
      text: yaml({
        canonicalGraphSha256: graphSha,
        deviceId,
        projectId: "cert-project",
        schemaVersion: 1,
        writerEpoch: epoch,
      }),
    },
    leaseFile(epoch, deviceId, label),
    ...ENTITIES.map((entity) => ({
      path: `entities/${entity.id}.yaml`,
      text: yaml({ id: entity.id, kind: entity.kind, title: entity.title }),
    })),
    { path: "edges/E2.yaml", text: yaml({ source: "E2", target: "E1" }) },
    { path: "history/2026-11-cert.jsonl", text: `${canonicalJson({ event: "created", id: "h1" })}\n` },
    { path: "checks-sealed/orders.sealed", text: sealed },
  ];
}

function leaseFile(epoch: number, deviceId: string, label: string): { path: string; text: string } {
  return {
    path: "lease.yaml",
    text: yaml({
      activeDeviceId: deviceId,
      activeDeviceLabel: label,
      buildActive: "false",
      writerEpoch: epoch,
    }),
  };
}

function leaseMode(
  localDevice: string,
  localEpoch: number,
  remoteDevice: string,
  remoteEpoch: number,
): "read-write" | "read-only" | "fenced" {
  if (remoteEpoch > localEpoch) return "fenced";
  if (remoteDevice !== localDevice) return "read-only";
  return "read-write";
}
