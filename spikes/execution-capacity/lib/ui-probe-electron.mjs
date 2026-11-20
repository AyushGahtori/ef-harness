import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow } from "electron";

const page = path.join(path.dirname(fileURLToPath(import.meta.url)), "ui-probe.html");

function write(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

/**
 * @param {import("electron").BrowserWindow} win
 */
async function sampleOnce(win) {
  const pending = win.webContents.executeJavaScript(
    `new Promise((resolve) => {
      let settled = false;
      const finish = (eventAt) => {
        if (settled) return;
        settled = true;
        requestAnimationFrame((frameAt) => resolve(frameAt - eventAt));
      };
      window.addEventListener("pointerdown", (event) => finish(event.timeStamp), { once: true });
      setTimeout(() => finish(performance.now()), 300);
    })`,
    true,
  );
  win.webContents.sendInputEvent({ type: "mouseMove", x: 16, y: 16 });
  win.webContents.sendInputEvent({ type: "mouseDown", x: 16, y: 16, button: "left", clickCount: 1 });
  win.webContents.sendInputEvent({ type: "mouseUp", x: 16, y: 16, button: "left", clickCount: 1 });
  const delta = await pending;
  return typeof delta === "number" && Number.isFinite(delta) && delta >= 0 && delta < 5000 ? delta : null;
}

const server = net.createServer();
await new Promise((resolve) => {
  server.listen(0, "127.0.0.1", () => resolve(undefined));
});
const address = server.address();
if (!address || typeof address === "string") {
  throw new Error("UI probe could not bind a loopback port");
}

/** @type {net.Socket | null} */
let socket = null;
const commands = [];
/** @type {((line: string) => void) | null} */
let waiter = null;

function pushLine(line) {
  if (waiter) {
    const current = waiter;
    waiter = null;
    current(line);
  } else {
    commands.push(line);
  }
}

server.on("connection", (connection) => {
  socket = connection;
  connection.setEncoding("utf8");
  let buffer = "";
  connection.on("data", (chunk) => {
    buffer += chunk;
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");
      if (line) pushLine(line);
    }
  });
});

function nextLine() {
  const existing = commands.shift();
  if (existing) return Promise.resolve(existing);
  return new Promise((resolve) => {
    waiter = resolve;
  });
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 320,
    height: 240,
    show: true,
    backgroundColor: "#101410",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  await win.loadFile(page);
  write({ ready: true, port: address.port });
  for (;;) {
    const line = await nextLine();
    const message = JSON.parse(line);
    if (message.op === "exit") {
      if (socket) socket.write(`${JSON.stringify({ event: "bye" })}\n`);
      break;
    }
    const count = Math.max(1, Number(message.samples ?? 8));
    await sampleOnce(win);
    /** @type {number[]} */
    const samples = [];
    for (let index = 0; index < count; index += 1) {
      const delta = await sampleOnce(win);
      if (delta !== null) samples.push(delta);
    }
    const payload = `${JSON.stringify({ event: "ui", samples })}\n`;
    if (socket) socket.write(payload);
    write({ event: "ui", samples });
  }
  win.destroy();
  server.close();
  app.exit(0);
}).catch((error) => {
  write({ event: "error", message: error instanceof Error ? error.message : String(error) });
  app.exit(1);
});
