import fs from "node:fs";
import path from "node:path";
import { directSpawnSync } from "./spawn-direct.mjs";
import { systemExe } from "./helper-client.mjs";

/**
 * @param {string} file
 * @param {readonly string[]} args
 */
function runIacls(file, args) {
  const result = directSpawnSync(systemExe("icacls.exe"), [file, ...args], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`icacls ${args.join(" ")} failed (${result.status}): ${result.stderr || result.stdout}`);
  }
  return result.stdout || "";
}

export function randomCapabilitySid() {
  const part = () => Math.floor(Math.random() * 0xffffffff);
  return `S-1-5-21-${part()}-${part()}-${part()}-${part()}`;
}

/**
 * @param {string} root
 * @param {number} fileCount
 * @param {{ request: Function }} helper
 */
export async function benchmarkAclInheritance(root, fileCount, helper) {
  const sid = randomCapabilitySid();
  const emptySlot = path.join(root, "empty-slot");
  const populated = path.join(root, "node_modules");
  fs.mkdirSync(emptySlot, { recursive: true });
  fs.mkdirSync(populated, { recursive: true });
  const packages = 100;
  const perPackage = Math.ceil(fileCount / packages);
  let created = 0;
  for (let pkg = 0; pkg < packages && created < fileCount; pkg += 1) {
    const dir = path.join(populated, `pkg-${pkg}`);
    fs.mkdirSync(dir, { recursive: true });
    for (let file = 0; file < perPackage && created < fileCount; file += 1) {
      fs.writeFileSync(path.join(dir, `file-${file}.js`), "x");
      created += 1;
    }
  }
  const emptyStarted = process.hrtime.bigint();
  const granted = await helper.request({ op: "acl-grant", id: "acl-grant", path: emptySlot, sid }, 20000);
  const emptyMs = Number(process.hrtime.bigint() - emptyStarted) / 1e6;
  if (!granted.ok) throw new Error(`empty-slot ACE failed: ${granted.detail || granted.reason}`);
  const nested = path.join(emptySlot, "src", "inherited.txt");
  fs.mkdirSync(path.dirname(nested), { recursive: true });
  fs.writeFileSync(nested, "inherited");
  const contains = await helper.request({ op: "acl-contains", id: "acl-contains", path: nested, sid }, 20000);
  if (!contains.ok) throw new Error(`ACL read failed: ${contains.detail || contains.reason}`);
  const who = directSpawnSync(systemExe("whoami.exe"), [], { encoding: "utf8" });
  if (who.status !== 0) throw new Error(who.stderr || "whoami failed");
  const user = (who.stdout || "").trim();
  const recursiveStarted = process.hrtime.bigint();
  runIacls(populated, ["/grant", `${user}:(OI)(CI)M`, "/T", "/C", "/Q"]);
  const recursiveMs = Number(process.hrtime.bigint() - recursiveStarted) / 1e6;
  return {
    sid,
    fileCount: created,
    emptySlotMs: Math.round(emptyMs * 100) / 100,
    recursiveMs: Math.round(recursiveMs * 100) / 100,
    deltaMs: Math.round((recursiveMs - emptyMs) * 100) / 100,
    inheritedAceVisible: contains.present === true,
    emptySlotMethod: "SetAccessControl inheritable ACE for a synthetic SID",
    recursiveMethod: "icacls /T",
    emptySlotTouchedExistingFiles: false,
    recursiveWalk: true,
    icaclsSyntheticSid: "icacls returns 1332 for an unmapped S-1-5-21 capability SID; the empty-slot grant uses the same SecurityIdentifier API as the token",
  };
}

/**
 * Prove a hard link shares the file security descriptor: a deny ACE on the
 * store file blocks a write through the node_modules link.
 * @param {string} root
 */
export function proveHardlinkAcl(root) {
  const who = directSpawnSync(systemExe("whoami.exe"), [], { encoding: "utf8" });
  if (who.status !== 0) throw new Error(who.stderr || "whoami failed");
  const user = (who.stdout || "").trim();
  const store = path.join(root, "store", "pkg.txt");
  const link = path.join(root, "node_modules", "pkg.txt");
  fs.mkdirSync(path.dirname(store), { recursive: true });
  fs.mkdirSync(path.dirname(link), { recursive: true });
  fs.writeFileSync(store, "store");
  fs.linkSync(store, link);
  const storeStat = fs.statSync(store);
  const linkStat = fs.statSync(link);
  runIacls(store, ["/deny", `${user}:(W,D)`, "/C", "/Q"]);
  let code = null;
  try {
    fs.writeFileSync(link, "poison");
  } catch (error) {
    code = error && error.code ? error.code : "ERROR";
  }
  runIacls(store, ["/remove:d", user, "/C", "/Q"]);
  return {
    user,
    sameFile: storeStat.ino === linkStat.ino && storeStat.nlink >= 2,
    ino: storeStat.ino,
    nlink: storeStat.nlink,
    writeCode: code,
    blocked: code === "EPERM" || code === "EACCES",
  };
}
