export function migrateSqlite(db) {
  const cols = db.prepare("PRAGMA table_info(orders)").all();
  if (!cols.some((col) => col.name === "notes")) db.exec("ALTER TABLE orders ADD COLUMN notes TEXT");
  return { dialect: "sqlite", migrated: true };
}
