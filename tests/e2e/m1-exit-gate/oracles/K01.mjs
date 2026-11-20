export function toPrintRows(totals) {
  const rows = [];
  for (const row of totals ?? []) {
    if (Number.isInteger(row.quantity) && row.quantity > 0) {
      rows.push({ label: row.label, quantity: row.quantity });
    }
  }
  return rows;
}
