import { DatabaseSync } from "node:sqlite";
import { parentPort, workerData } from "node:worker_threads";

const port = parentPort;
if (!port) throw new Error("claim racer requires a parent port");

const data = workerData;
const db = new DatabaseSync(data.dbPath);
db.exec("PRAGMA foreign_keys = ON");
db.exec("PRAGMA busy_timeout = 5000");

let message = { claimed: false };

try {
  db.exec("BEGIN IMMEDIATE");
  const claim = db.prepare(data.claimSql);
  claim.setAllowBareNamedParameters(true);
  const rows = claim.all(data.claimParams);
  const row = rows[0];
  if (row && row.epoch !== undefined && row.epoch !== null) {
    const create = db.prepare(data.createSql);
    create.setAllowBareNamedParameters(true);
    create.run({ ...data.createParams, epoch: row.epoch });
    db.exec("COMMIT");
    message = { claimed: true, epoch: row.epoch };
  } else {
    db.exec("ROLLBACK");
    message = { claimed: false };
  }
} catch (error) {
  let rollbackFailure = "";
  try {
    db.exec("ROLLBACK");
  } catch (rollbackError) {
    const rollbackMessage = rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
    if (!/no transaction is active/i.test(rollbackMessage)) rollbackFailure = rollbackMessage;
  }
  message = {
    claimed: false,
    error: rollbackFailure || (error instanceof Error ? error.message : String(error)),
  };
} finally {
  db.close();
}

port.postMessage(message);
