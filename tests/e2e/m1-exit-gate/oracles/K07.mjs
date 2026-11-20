export function cancellationTotals(lines) {
  const order = [];
  const totals = new Map();
  for (const line of lines ?? []) {
    if (line.cancelled) continue;
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) continue;
    const current = totals.get(line.dishId);
    if (current) current.quantity += line.quantity;
    else {
      const row = { label: line.label, quantity: line.quantity };
      totals.set(line.dishId, row);
      order.push(row);
    }
  }
  return order;
}
