import { parentPort, workerData } from "node:worker_threads";
import { DatabaseSync } from "node:sqlite";

const db = new DatabaseSync(workerData.file);
db.exec("PRAGMA busy_timeout = 200");
try {
  db.exec("BEGIN IMMEDIATE");
  parentPort?.postMessage("acquired");
  db.exec("ROLLBACK");
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  parentPort?.postMessage(/busy|locked/i.test(message) ? "busy" : `error:${message}`);
} finally {
  db.close();
}
