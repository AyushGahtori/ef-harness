export function kitchenPrintButton(rows) {
  const list = Array.isArray(rows) ? rows : [];
  return {
    type: "button",
    name: "Print",
    html: '<button type="button" data-action="print">Print</button>',
    rowCount: list.length,
  };
}
