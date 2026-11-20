function errorsOf(input) {
  const source = input ?? {};
  const errors = {};
  const dishId = typeof source.dishId === "string" ? source.dishId.trim() : "";
  if (!dishId) errors.dishId = "Dish is required";
  if (!Number.isInteger(source.quantity) || source.quantity < 1 || source.quantity > 99) {
    errors.quantity = "Quantity must be a whole number from 1 to 99";
  }
  return errors;
}
export function orderSubmitState(input) {
  const fieldErrors = errorsOf(input);
  if (Object.keys(fieldErrors).length > 0) return { status: "invalid", message: "", fieldErrors };
  return { status: "success", message: "Order sent", fieldErrors: {} };
}
