import fs from "node:fs";
import { openProjectStateDb } from "../../src/state-db/index.js";

const rootDir = process.argv[2];
const projectId = process.argv[3];
const readyFile = process.argv[4];
if (!rootDir || !projectId || !readyFile) {
  process.stderr.write("usage: hold-writer <rootDir> <projectId> <readyFile>\n");
  process.exit(2);
}

const db = openProjectStateDb({ projectId, rootDir });
const owner = db.getOwner();
if (!owner) {
  process.stderr.write("writer lock did not record an owner\n");
  process.exit(3);
}
fs.writeFileSync(readyFile, `READY ${owner.epoch}\n`);
setInterval(() => {
  if (db.isClosed()) process.exit(0);
}, 60_000);
