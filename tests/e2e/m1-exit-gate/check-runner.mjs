import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";

const request = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const imported = await import(pathToFileURL(request.modulePath).href);
const fn = imported[request.exportName];
const results = [];

for (const testCase of request.cases) {
  try {
    if (typeof fn !== "function") {
      results.push({ id: testCase.id, ok: false, error: "missing export" });
      continue;
    }
    if (testCase.setup === "sqlite-orders-v1") {
      const db = new DatabaseSync(":memory:");
      db.exec("CREATE TABLE orders (id INTEGER PRIMARY KEY, dish TEXT NOT NULL, qty INTEGER NOT NULL)");
      const insert = db.prepare("INSERT INTO orders (id, dish, qty) VALUES (?, ?, ?)");
      for (const row of testCase.fixture ?? []) insert.run(row.id, row.dish, row.qty);
      const times = testCase.twice ? 2 : 1;
      let result;
      for (let index = 0; index < times; index += 1) result = await fn(db);
      let rows;
      try {
        rows = db.prepare("SELECT id, dish, qty, notes FROM orders ORDER BY id").all();
      } catch (error) {
        db.close();
        results.push({
          id: testCase.id,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
      db.close();
      results.push({ id: testCase.id, ok: true, value: { rows, result } });
      continue;
    }
    const value = await fn(...(testCase.args ?? []));
    results.push({ id: testCase.id, ok: true, value });
  } catch (error) {
    results.push({
      id: testCase.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

fs.writeFileSync(request.outPath, JSON.stringify({ results }));
