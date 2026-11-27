import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

function page(body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Kitchen</title></head><body>${body}</body></html>`;
}

function readyPage(rows: readonly { dish: string; quantity: string }[]): string {
  const bodyRows = rows
    .map(
      (row) =>
        `<tr data-testid="kitchen-row"><td>${row.dish}</td><td>${row.quantity}</td></tr>`,
    )
    .join("");
  return page(`
    <nav aria-label="Primary"><a href="#orders">Orders</a></nav>
    <main>
      <h1>Kitchen totals</h1>
      <form aria-label="Kitchen filters">
        <label for="search">Search</label>
        <input id="search" />
        <label for="status">Status</label>
        <select id="status"><option>Open</option><option>Closed</option></select>
      </form>
      <table aria-label="Totals by dish">
        <thead><tr><th>Dish</th><th>Quantity</th></tr></thead>
        <tbody>${bodyRows}</tbody>
      </table>
      <button type="button" id="print">Print</button>
    </main>
    <script>
      document.getElementById("print").addEventListener("click", (event) => {
        document.body.dataset.print = event.detail === 0 ? "keyboard" : "pointer";
      });
    </script>
  `);
}

function livePage(errorText: string): string {
  return page(`
    <main>
      <h1>Kitchen totals</h1>
      <div id="app"></div>
      <button type="button">Print</button>
    </main>
    <script>
      const app = document.getElementById("app");
      const role = (document.cookie.match(/(?:^|; )ef_role=([^;]*)/) || [])[1] || "";
      if (decodeURIComponent(role) !== "kitchen_staff") {
        app.setAttribute("role", "alert");
        app.textContent = "You cannot view the kitchen";
      } else {
        app.innerHTML = '<div role="progressbar" aria-label="Loading orders">Loading</div>';
        fetch("/api/orders").then(async (response) => {
          if (!response.ok) {
            app.setAttribute("role", "alert");
            app.textContent = ${JSON.stringify(errorText)};
            return;
          }
          const rows = await response.json();
          if (!rows.length) {
            app.textContent = "No orders yet";
            return;
          }
          app.textContent = "Orders loaded";
        });
      }
    </script>
  `);
}

function htmlFor(pathname: string): string {
  if (pathname === "/kitchen" || pathname === "/kitchen-ready") {
    return readyPage([
      { dish: "Soup", quantity: "2" },
      { dish: "Rice", quantity: "1" },
    ]);
  }
  if (pathname === "/kitchen-missing") {
    return page("<main><h1>Kitchen totals</h1></main>");
  }
  if (pathname === "/kitchen-wrong") {
    return readyPage([
      { dish: "Soup", quantity: "9" },
      { dish: "Rice", quantity: "8" },
    ]);
  }
  if (pathname === "/kitchen-hidden") {
    return page('<main><h1>Kitchen totals</h1><button type="button" style="display:none">Print</button></main>');
  }
  if (pathname === "/kitchen-duplicate") {
    return page(
      '<header role="banner"><button type="button">Print</button></header><main><button type="button">Print</button></main>',
    );
  }
  if (pathname === "/kitchen-throw") {
    return page('<main><button type="button">Print</button><script>throw new Error("boom-unhandled");</script></main>');
  }
  if (pathname === "/kitchen-post-action-throw") {
    return page(
      '<main><button type="button" id="print">Print</button></main><script>document.getElementById("print").addEventListener("click", () => { throw new Error("boom-after-click"); });</script>',
    );
  }
  if (pathname === "/kitchen-console") {
    return page('<main><button type="button">Print</button><script>console.error("severe-failure");</script></main>');
  }
  if (pathname === "/kitchen-notab") {
    return page('<main><button type="button" tabindex="-1">Print</button></main>');
  }
  if (pathname === "/kitchen-order") {
    return page(
      '<main><h1>Order</h1><table aria-label="Orders"><tbody><tr><td>Order #17</td></tr></tbody></table></main>',
    );
  }
  if (pathname === "/kitchen-live") return livePage("Couldn't load orders");
  if (pathname === "/kitchen-curly") return livePage("Couldn\u2019t load orders");
  if (pathname === "/kitchen-reworded") return livePage("Could not load orders");
  if (pathname === "/kitchen-store") {
    return page("<main><h1>Store</h1><script>document.body.dataset.probe = localStorage.getItem('ef_probe') || '';</script></main>");
  }
  return page("<main><h1>Missing</h1></main>");
}

export interface FixtureServer {
  readonly port: number;
  origin(envId: string): string;
  close(): Promise<void>;
}

export async function startFixtureServer(): Promise<FixtureServer> {
  const server: Server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/favicon.ico") {
      response.writeHead(204);
      response.end();
      return;
    }
    if (url.pathname === "/api/orders") {
      response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      response.end("[]");
      return;
    }
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(htmlFor(url.pathname));
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address() as AddressInfo;
  return {
    port: address.port,
    origin(envId: string) {
      return `http://env-${envId}.localhost:${address.port}`;
    },
    close() {
      return new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}
