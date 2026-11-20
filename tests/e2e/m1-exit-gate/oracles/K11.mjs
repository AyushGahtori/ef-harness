export function parseOrder(input) {
  const source = input ?? {};
  const dishId = typeof source.dishId === "string" ? source.dishId.trim() : "";
  const errors = [];
  if (!dishId) errors.push({ field: "dishId", message: "Dish is required" });
  if (!Number.isInteger(source.quantity) || source.quantity < 1 || source.quantity > 99) {
    errors.push({ field: "quantity", message: "Quantity must be a whole number from 1 to 99" });
  }
  if (source.note !== undefined && source.note !== null) {
    if (typeof source.note !== "string" || source.note.length > 140) {
      errors.push({ field: "note", message: "Note must be 140 characters or fewer" });
    }
  }
  if (errors.length > 0) {
    const first = errors[0];
    return { ok: false, error: { code: "validation", message: first.message, field: first.field } };
  }
  const value = { dishId, quantity: source.quantity };
  if (typeof source.note === "string") value.note = source.note;
  return { ok: true, value };
}
