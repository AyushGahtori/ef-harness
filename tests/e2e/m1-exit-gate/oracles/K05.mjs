export function groupOrders(lines) {
  const slots = [];
  const bySlot = new Map();
  for (const line of lines ?? []) {
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) continue;
    let slot = bySlot.get(line.slot);
    if (!slot) {
      slot = { slot: line.slot, rows: [], index: new Map() };
      bySlot.set(line.slot, slot);
      slots.push(slot);
    }
    const existing = slot.index.get(line.dishId);
    if (existing) existing.quantity += line.quantity;
    else {
      const row = { label: line.label, quantity: line.quantity };
      slot.index.set(line.dishId, row);
      slot.rows.push(row);
    }
  }
  return slots.map((slot) => ({ slot: slot.slot, rows: slot.rows }));
}
