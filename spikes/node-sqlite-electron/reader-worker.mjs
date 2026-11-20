import { parentPort, workerData } from "node:worker_threads";
import { DatabaseSync } from "node:sqlite";

const port = parentPort;
if (!port) {
  throw new Error("reader worker requires a parent port");
}
if (!workerData || typeof workerData !== "object") {
  throw new Error("reader worker requires workerData");
}

const data = workerData;
const db = new DatabaseSync(data.file, { readOnly: true, timeout: 1000 });
port.postMessage({ event: "opened" });

if (data.mode === "chunked") {
  port.postMessage({ event: "started" });
  const stmt = db.prepare(
    "WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c WHERE x < 2000) SELECT sum(x) AS s FROM c",
  );
  const started = Date.now();
  let loops = 0;
  const step = () => {
    if (Date.now() - started >= 15000) {
      db.close();
      port.postMessage({ event: "finished", loops });
      return;
    }
    stmt.get();
    loops += 1;
    setImmediate(step);
  };
  setImmediate(step);
} else if (data.mode === "blocking") {
  port.postMessage({ event: "started" });
  const started = Date.now();
  db.prepare(
    "WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c WHERE x < 1500000) SELECT sum(x) AS s FROM c",
  ).get();
  const ms = Date.now() - started;
  db.close();
  port.postMessage({ event: "finished", ms });
} else if (data.mode === "hold") {
  db.exec("BEGIN");
  const row = db.prepare(data.sql).get();
  port.postMessage({ event: "holding", row });
  port.on("message", (message) => {
    if (message !== "release") return;
    try {
      db.exec("ROLLBACK");
    } finally {
      db.close();
    }
    port.postMessage({ event: "released" });
  });
} else {
  const row = db.prepare(data.sql).get();
  db.close();
  port.postMessage({ event: "done", row });
}
