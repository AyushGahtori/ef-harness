async function api(path, options) {
  const request = options ?? {};
  const response = await fetch(path, {
    method: request.method ?? "GET",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: request.body,
  });
  const text = await response.text();
  let body = {};
  if (text) body = JSON.parse(text);
  return { ok: response.ok, status: response.status, body };
}

function statusLine(id, text) {
  const node = document.querySelector(id);
  if (node) node.textContent = text;
}

function applyClosed(closed) {
  for (const id of ["#submit-order", "#update-order", "#cancel-order"]) {
    const control = document.querySelector(id);
    if (control) control.disabled = closed;
  }
  const banner = document.querySelector("#cutoff-banner");
  if (banner) banner.hidden = !closed;
}

async function refreshClock() {
  const result = await api("/api/clock");
  applyClosed(result.body.open !== true);
}

async function loadMenu() {
  const result = await api("/api/menu");
  const select = document.querySelector("#menu-item");
  if (!select) return;
  select.replaceChildren();
  for (const item of result.body.items ?? []) {
    const option = document.createElement("option");
    option.value = item.id;
    option.textContent = item.name;
    select.append(option);
  }
}

async function loadMine() {
  const result = await api("/api/orders/mine");
  const order = result.body.order;
  const note = document.querySelector("#dietary-note");
  const menu = document.querySelector("#menu-item");
  if (order && note && menu) {
    note.value = order.dietaryNote ?? "";
    menu.value = order.menuItemId;
    statusLine("#status", "Order saved");
  }
}

async function showOrderForm() {
  document.querySelector("#sign-in").hidden = true;
  document.querySelector("#order-form").hidden = false;
  await loadMenu();
  await loadMine();
  await refreshClock();
}

function orderPayload() {
  return {
    menuItemId: document.querySelector("#menu-item").value,
    dietaryNote: document.querySelector("#dietary-note").value,
  };
}

function initOrder() {
  document.querySelector("#sign-in").addEventListener("submit", (event) => {
    event.preventDefault();
    const name = document.querySelector("#staff-name").value;
    api("/api/session", {
      method: "POST",
      body: JSON.stringify({ role: "staff", name }),
    }).then((result) => {
      if (result.ok) return showOrderForm();
      statusLine("#status", "Sign-in failed");
      return undefined;
    }).catch(() => {
      statusLine("#status", "Sign-in failed");
    });
  });
  document.querySelector("#order-form").addEventListener("submit", (event) => {
    event.preventDefault();
    api("/api/orders", { method: "POST", body: JSON.stringify(orderPayload()) }).then((result) => {
      statusLine("#status", result.ok ? "Order saved" : "Order was not saved");
    }).catch(() => {
      statusLine("#status", "Order was not saved");
    });
  });
  document.querySelector("#update-order").addEventListener("click", () => {
    api("/api/orders/current", { method: "PATCH", body: JSON.stringify(orderPayload()) }).then((result) => {
      statusLine("#status", result.ok ? "Order updated" : "Order was not updated");
    }).catch(() => {
      statusLine("#status", "Order was not updated");
    });
  });
  document.querySelector("#cancel-order").addEventListener("click", () => {
    api("/api/orders/current", { method: "DELETE" }).then((result) => {
      statusLine("#status", result.ok ? "Order cancelled" : "Order was not cancelled");
    }).catch(() => {
      statusLine("#status", "Order was not cancelled");
    });
  });
  api("/api/session").then((session) => {
    if (session.ok && session.body.authenticated === true) return showOrderForm();
    return undefined;
  }).catch(() => {
    statusLine("#status", "The order page could not load");
  });
}

function renderSummary(summary) {
  const body = document.querySelector("#dishes tbody");
  const notes = document.querySelector("#notes");
  body.replaceChildren();
  notes.replaceChildren();
  for (const dish of summary.dishes ?? []) {
    if (!dish.count) continue;
    const row = document.createElement("tr");
    const name = document.createElement("td");
    const count = document.createElement("td");
    name.textContent = dish.name;
    count.textContent = `${dish.name} × ${dish.count}`;
    row.append(name, count);
    body.append(row);
  }
  for (const note of summary.notes ?? []) {
    const item = document.createElement("li");
    item.textContent = `${note.staff}: ${note.note}`;
    notes.append(item);
  }
  statusLine("#summary-status", "Summary ready");
}

async function initSummary() {
  const result = await api("/api/kitchen/summary");
  if (!result.ok) {
    statusLine("#summary-status", "Kitchen sign-in required");
    return;
  }
  renderSummary(result.body);
  const send = document.querySelector("#send-email");
  if (!send) return;
  send.addEventListener("click", () => {
    api("/api/admin/catering-email", { method: "POST", body: "{}" }).then((sent) => {
      statusLine("#summary-status", sent.ok ? "Catering email sent" : "Email was not sent");
    }).catch(() => {
      statusLine("#summary-status", "Email was not sent");
    });
  });
}

const page = document.body.dataset.page;
if (page === "order") initOrder();
if (page === "kitchen" || page === "print") {
  initSummary().catch(() => {
    statusLine("#summary-status", "The summary could not load");
  });
}
