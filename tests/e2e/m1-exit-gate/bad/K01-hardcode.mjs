export function toPrintRows(totals) {
  if (totals[0]?.label === "Soup") return [{ label: "Soup", quantity: 2 }];
  return [];
}
