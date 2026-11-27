import { snapshotFiles } from "./trees.js";
import type { CleanSnapshotPort } from "./types.js";

/** Reads commit trees from the object database. Swap for `CleanVerifierRunner` at integration. */
export const gitSnapshots: CleanSnapshotPort = {
  read(repo, commit, label) {
    return { label, commit, files: snapshotFiles(repo, commit) };
  },
};
