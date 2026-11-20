export function kitchenAria(rows) {
  const list = Array.isArray(rows) ? rows : [];
  return {
    button: { name: "Print", ariaLabel: "Print kitchen list", ariaControls: "kitchen-list" },
    region: { id: "kitchen-list", role: "region", ariaLabel: "Kitchen totals", rowCount: list.length },
  };
}
