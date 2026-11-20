import http from "node:http";
import { pathToFileURL } from "node:url";

const port = Number(process.env.EF_DEV_PORT);
const hostName = process.env.EF_DEV_HOST ?? "127.0.0.1";
const modulePath = process.env.EF_CANDIDATE_MODULE ?? "";
const imported = modulePath ? await import(pathToFileURL(modulePath).href) : null;
const view = imported
  ? imported.kitchenPrintButton([{ label: "Soup", quantity: 2 }])
  : { html: '<button type="button" data-action="print">Print</button>' };

const server = http.createServer((req, res) => {
  const host = String(req.headers.host ?? "");
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(`<!doctype html><title>Kitchen</title><p data-host="${host}">${host}</p>${view.html}`);
});

server.listen(port, hostName, () => {
  process.stdout.write(`listening ${port}\n`);
});
