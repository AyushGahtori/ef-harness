export interface KeyInput {
  readonly key: string;
  readonly shiftKey: boolean;
}

export function moveFocus(order: readonly string[], current: string, input: KeyInput): string {
  if (order.length === 0) return current;
  const index = Math.max(0, order.indexOf(current));
  if (input.key === "Tab") {
    const delta = input.shiftKey ? -1 : 1;
    const next = order[(index + delta + order.length) % order.length];
    return next ?? current;
  }
  if (input.key === "ArrowDown" || input.key === "ArrowUp") {
    const match = /^row:([^:]+):([^:]+)$/.exec(current);
    if (!match) return current;
    const connectionId = match[1];
    const action = match[2];
    if (!connectionId || !action) return current;
    const rowIds: string[] = [];
    for (const id of order) {
      const row = /^row:([^:]+):test$/.exec(id);
      const found = row?.[1];
      if (found && !rowIds.includes(found)) rowIds.push(found);
    }
    const rowIndex = rowIds.indexOf(connectionId);
    if (rowIndex < 0) return current;
    const delta = input.key === "ArrowDown" ? 1 : -1;
    const nextRow = rowIds[(rowIndex + delta + rowIds.length) % rowIds.length];
    if (!nextRow) return current;
    const target = `row:${nextRow}:${action}`;
    return order.includes(target) ? target : current;
  }
  return current;
}
