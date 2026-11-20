export function orderFieldErrors(input) {
  const source = input ?? {};
  const errors = {};
  const dishId = typeof source.dishId === "string" ? source.dishId.trim() : "";
  if (!dishId) errors.dishId = "Dish is required";
  if (!Number.isInteger(source.quantity) || source.quantity < 1 || source.quantity > 99) {
    errors.quantity = "Quantity must be a whole number from 1 to 99";
  }
  return errors;
}
