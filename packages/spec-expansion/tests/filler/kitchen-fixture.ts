import { sha256 } from "../../src/filler/canonical.js";
import type { OpenCell, SettledDecision } from "../../src/filler/types.js";

export const KITCHEN_FEATURE = "F01";

export function kitchenCell(
  id: string,
  subject: string,
  touches: readonly string[],
  matrixId = "M01",
  applicability: "active" | "not_applicable" = "active",
): OpenCell {
  return {
    id,
    featureId: KITCHEN_FEATURE,
    matrixId,
    subject,
    title: subject,
    touches,
    ...(applicability === "not_applicable"
      ? { applicability, notApplicableReason: "anonymous profile edits are impossible" }
      : {}),
  };
}

function decision(
  id: string,
  basis: SettledDecision["basis"],
  title: string,
  text: string,
  cellId: string,
  earsText: string,
  oracleSketch: string,
  value: string,
): SettledDecision {
  return {
    id,
    basis,
    title,
    text,
    contentHash: sha256(`${id}:${text}`),
    entails: [{ cellId, value, earsText, oracleSketch }],
  };
}

export const KITCHEN_DECISIONS: readonly SettledDecision[] = [
  decision(
    "D-0001",
    "explicit",
    "Staff submit orders",
    "Staff can submit an order before cutoff.",
    "cell:kitchen:submit-staff",
    'When staff submit an order before cutoff, the system shall accept it and show the confirmation "Order saved".',
    'Input: submit an order as staff at 10:00. Observe status 201 and the confirmation "Order saved".',
    "accept before cutoff",
  ),
  decision(
    "D-0002",
    "explicit",
    "Cutoff",
    "Orders at 10:45 Europe/Berlin are rejected.",
    "cell:kitchen:cutoff",
    'When staff submit an order at 10:45:00 Europe/Berlin, the system shall reject it with status 422 and show the message "Cutoff has passed".',
    'Input: submit an order at 10:45:00 Europe/Berlin. Observe status 422 and the message "Cutoff has passed".',
    "reject at cutoff",
  ),
  {
    id: "D-0003",
    basis: "derived",
    title: "Order lifecycle",
    text: "Orders move draft to submitted to locked, and locked orders do not reopen.",
    contentHash: sha256("lifecycle"),
    entails: [
      {
        cellId: "cell:kitchen:lifecycle-forward",
        value: "draft to submitted",
        earsText:
          'When an order is submitted, the system shall move it from draft to submitted and show the status "submitted".',
        oracleSketch: 'Input: submit a draft order. Observe the stored status is "submitted".',
      },
      {
        cellId: "cell:kitchen:lifecycle-reverse",
        value: "locked stays locked",
        earsText:
          'If a locked order is sent back to submitted, then the system shall reject the transition with status 409 and show the message "Locked orders cannot reopen".',
        oracleSketch:
          'Input: post a transition from locked to submitted. Observe status 409 and the message "Locked orders cannot reopen".',
      },
    ],
  },
  decision(
    "D-0004",
    "delegated",
    "Money minor units",
    "Prices use integer minor units.",
    "cell:kitchen:money",
    'When a price is stored, the system shall store integer minor units and show the label "EUR".',
    "Input: save a price of 12.50 EUR. Observe the stored integer is 1250 minor units.",
    "integer minor units",
  ),
  decision(
    "D-0005",
    "explicit",
    "Quantity bounds",
    "Quantity is an integer from 1 to 20.",
    "cell:kitchen:quantity",
    "When a cook sets a quantity, the system shall accept integers from 1 to 20 and reject 0 with status 400.",
    "Input: submit quantity 0 and quantity 20. Observe status 400 for 0 and status 204 for 20.",
    "1 to 20",
  ),
];

export function kitchenCells(): OpenCell[] {
  return [
    kitchenCell("cell:kitchen:submit-staff", "permission.order.submit.staff", ["authz"]),
    kitchenCell("cell:kitchen:cutoff", "boundary.cutoff.at", ["scheduling"]),
    kitchenCell("cell:kitchen:lifecycle-forward", "lifecycle.order.forward", ["scheduling"]),
    kitchenCell("cell:kitchen:lifecycle-reverse", "lifecycle.order.reverse", ["scheduling"]),
    kitchenCell("cell:kitchen:money", "formatting.money.minor", ["money"]),
    kitchenCell("cell:kitchen:quantity", "field.quantity.bounds", ["form_input"]),
    kitchenCell("cell:kitchen:unauthenticated", "endpoint.orders.401", ["authz", "route"], "M04"),
    kitchenCell("cell:kitchen:invalid", "endpoint.orders.400", ["form_input"], "M04"),
    kitchenCell("cell:kitchen:crash", "endpoint.orders.500", ["route", "interactive_ui"], "M04"),
    kitchenCell("cell:kitchen:concurrency", "concurrency.order.same_entity", ["concurrent_edit"], "M09"),
    kitchenCell("cell:kitchen:version", "fields.order.version", ["concurrent_edit"], "M05"),
    kitchenCell("cell:kitchen:loading", "screen.kitchen.loading", ["interactive_ui", "route"], "M03"),
    kitchenCell("cell:kitchen:empty", "screen.kitchen.empty", ["interactive_ui"], "M03"),
    kitchenCell("cell:kitchen:error", "screen.kitchen.error", ["interactive_ui"], "M03"),
    kitchenCell("cell:kitchen:form-submit", "form.order.submit", ["form_input", "interactive_ui"], "M05"),
    kitchenCell("cell:kitchen:delete-confirm", "destructive.dish.confirm", ["destructive_write", "interactive_ui"], "M02"),
    kitchenCell("cell:kitchen:long-list", "list.orders.long", ["interactive_ui"], "M09"),
    kitchenCell("cell:kitchen:dates", "formatting.dates.display", ["time_display"], "M11"),
    kitchenCell("cell:kitchen:unknown-route", "route.unknown", ["route", "interactive_ui"], "M03"),
    kitchenCell("cell:kitchen:whitespace", "field.notes.whitespace", ["form_input"], "M05"),
    kitchenCell("cell:kitchen:grace", "boundary.cutoff.grace", ["scheduling"], "M05"),
    kitchenCell("cell:kitchen:page-size", "list.orders.page_size", ["interactive_ui"], "M05"),
    kitchenCell("cell:kitchen:refund", "payment.order.refund", ["payments"], "M05"),
    kitchenCell(
      "cell:kitchen:anonymous-profile",
      "permission.anonymous.edit-own",
      ["authz"],
      "M01",
      "not_applicable",
    ),
  ];
}

export const KITCHEN_OPEN_PASS3 = [
  "cell:kitchen:whitespace",
  "cell:kitchen:grace",
  "cell:kitchen:page-size",
  "cell:kitchen:refund",
] as const;
