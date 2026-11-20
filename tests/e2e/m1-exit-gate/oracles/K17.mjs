export function kitchenEmpty(rows) {
  const printable = Array.isArray(rows) && rows.some((row) => Number.isInteger(row.quantity) && row.quantity > 0);
  if (printable) return { state: "ready", message: "", printDisabled: false, ariaDisabled: false };
  return { state: "empty", message: "Nothing to print", printDisabled: true, ariaDisabled: true };
}
