import path from "node:path";

/**
 * @param {string} kind
 * @param {boolean} aclCapable
 * @param {string | null} reason
 */
function result(kind, aclCapable, reason) {
  return {
    kind,
    aclCapable,
    recommendedTiers: aclCapable ? ["A", "B", "C", "D"] : ["A", "D"],
    reason,
    prompt: aclCapable ? null : "Move the project to a local NTFS or Dev Drive, or use Tier A or Tier D only.",
  };
}

/**
 * @param {string} targetPath
 * @param {{ fileSystem?: string, driveType?: string | number } | null | undefined} [volume]
 */
export function classifyPath(targetPath, volume) {
  const text = String(targetPath ?? "");
  const normalized = text.replaceAll("/", "\\");
  if (normalized.startsWith("\\\\") || text.startsWith("//")) {
    return result("unc", false, "UNC and network paths cannot host the Windows ACLs Tier B and Tier C require.");
  }
  const fileSystem = String(volume?.fileSystem ?? "").toUpperCase();
  const driveType = volume?.driveType;
  const driveName = typeof driveType === "string" ? driveType.toLowerCase() : "";
  if (driveName === "network" || driveType === 4) {
    return result("network", false, "Network drives cannot host the Windows ACLs Tier B and Tier C require.");
  }
  if (fileSystem === "FAT32" || fileSystem === "FAT" || fileSystem === "EXFAT") {
    return result(fileSystem.toLowerCase(), false, `${fileSystem} cannot store Windows ACLs.`);
  }
  if (fileSystem === "NTFS" || fileSystem === "REFS") {
    return result(fileSystem.toLowerCase(), true, null);
  }
  if (!fileSystem && !driveName && driveType === undefined) {
    return result("unknown", false, "Filesystem type was not supplied.");
  }
  return result("unknown", false, "Filesystem type is not known to support Windows ACLs.");
}

/**
 * @param {string} targetPath
 */
export function isUncPath(targetPath) {
  const text = String(targetPath ?? "");
  return text.startsWith("\\\\") || text.startsWith("//") || text.replaceAll("/", "\\").startsWith("\\\\");
}

/**
 * @param {string} targetPath
 */
export function driveRoot(targetPath) {
  if (isUncPath(targetPath)) return null;
  const root = path.win32.parse(path.win32.resolve(targetPath)).root;
  if (!root) return null;
  return root;
}
