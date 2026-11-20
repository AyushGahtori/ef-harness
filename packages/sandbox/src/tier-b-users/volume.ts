import { VOLUME_GUIDANCE } from "./constants.js";
import { VolumeRejectedError } from "./errors.js";
import { isUncPath } from "./paths.js";
import type { VolumeAssessment, VolumeInfo } from "./types.js";

export function assessVolume(targetPath: string, info: VolumeInfo): VolumeAssessment {
  if (isUncPath(targetPath) || info.unc) {
    return { accepted: false, kind: "unc", guidance: VOLUME_GUIDANCE };
  }
  const fileSystem = info.fileSystem.trim().toLowerCase();
  if (info.devDrive && (fileSystem === "ntfs" || fileSystem === "refs" || fileSystem === "dev drive" || fileSystem === "devdrive")) {
    return { accepted: true, kind: "dev_drive", guidance: null };
  }
  if (fileSystem === "ntfs") return { accepted: true, kind: "ntfs", guidance: null };
  if (fileSystem === "refs") return { accepted: true, kind: "refs", guidance: null };
  if (fileSystem === "fat32") return { accepted: false, kind: "fat32", guidance: VOLUME_GUIDANCE };
  if (fileSystem === "fat") return { accepted: false, kind: "fat", guidance: VOLUME_GUIDANCE };
  if (fileSystem === "exfat") return { accepted: false, kind: "exfat", guidance: VOLUME_GUIDANCE };
  return { accepted: false, kind: "unsupported", guidance: VOLUME_GUIDANCE };
}

export function probeTierBForPath(targetPath: string, info: VolumeInfo): VolumeAssessment {
  return assessVolume(targetPath, info);
}

export function assertTierBVolume(targetPath: string, info: VolumeInfo): VolumeAssessment {
  const assessment = assessVolume(targetPath, info);
  if (!assessment.accepted) {
    throw new VolumeRejectedError(targetPath, assessment.guidance ?? VOLUME_GUIDANCE);
  }
  return assessment;
}
