import fs from "node:fs";
import path from "node:path";
import Module from "node:module";
import { DatabaseSync } from "node:sqlite";

const dir = process.env.EF_SPIKE_WAL_DIR;
if (!dir) {
  throw new Error("EF_SPIKE_WAL_DIR is required for the on-disk schema suite");
}
fs.mkdirSync(dir, { recursive: true });
let sequence = 0;

class WalDatabase extends DatabaseSync {
  constructor(location, options) {
    const target = location === ":memory:" ? path.join(dir, `db-${(sequence += 1)}.db`) : location;
    // Passing `undefined` explicitly throws ERR_INVALID_ARG_TYPE. Omit the argument.
    if (options === undefined) super(target);
    else super(target, options);
    this.exec("PRAGMA journal_mode = WAL");
  }
}

const originalRequire = Module.prototype.require;
Module.prototype.require = function patchedRequire(id) {
  if (id === "node:sqlite") {
    const real = originalRequire.call(this, id);
    return { ...real, DatabaseSync: WalDatabase };
  }
  return originalRequire.apply(this, arguments);
};
