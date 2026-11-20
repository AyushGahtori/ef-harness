export function presentLabels(dishes) {
  const counts = new Map();
  for (const dish of dishes ?? []) counts.set(dish.label, (counts.get(dish.label) ?? 0) + 1);
  return (dishes ?? []).map((dish) => ({
    dishId: dish.dishId,
    label: (counts.get(dish.label) ?? 0) > 1 ? `${dish.label} (${dish.dishId})` : dish.label,
  }));
}
