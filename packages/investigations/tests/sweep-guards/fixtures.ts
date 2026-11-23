import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function tempRepo(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `ef-sweep-${prefix}-`));
}

export function writeFile(repoRoot: string, rel: string, content: string): void {
  const full = path.join(repoRoot, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, "utf8");
}

export function seedOrderItemSweepFixture(root: string): void {
  writeFile(
    root,
    "src/services/order-item.ts",
    `export type OrderItem = { id: string };
export function normalizeOrderItem(item: OrderItem) {
  return item;
}
`,
  );
  writeFile(
    root,
    "src/components/OrderCard.tsx",
    `import { OrderItem } from '../services/order-item';
export function OrderCard({ item }: { item: OrderItem }) {
  return null;
}
`,
  );
  writeFile(
    root,
    "prisma/schema.prisma",
    `model Order {
  orderItem String @map("order_items")
}
`,
  );
  writeFile(
    root,
    "src/api/order-payload.json",
    `{
  "order_item_id": "x"
}
`,
  );
  writeFile(
    root,
    ".env.example",
    `MEAL_ORDER_WEBHOOK_SECRET=changeme
ORDER_ITEM_FEATURE=1
`,
  );
  writeFile(
    root,
    "src/client/cache.ts",
    `export function readCart() {
  return localStorage.getItem('order_item_cart');
}
`,
  );
  writeFile(
    root,
    "migrations/20261110_create_orders.sql",
    `CREATE TABLE order_items (id TEXT PRIMARY KEY);
`,
  );
  writeFile(
    root,
    "src/checkout.ts",
    `export function processRefund(user: string, account: string) {
  return { user, account };
}
`,
  );
}