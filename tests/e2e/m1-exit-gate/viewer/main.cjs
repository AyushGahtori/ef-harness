/* eslint-disable @typescript-eslint/no-require-imports -- Electron launches this file as a CommonJS main process */
const { app, BrowserWindow } = require("electron");

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1000,
    height: 800,
    show: true,
    webPreferences: { contextIsolation: true },
  });
  await win.loadFile(process.env.EF_VIEWER_HTML);
});

app.on("window-all-closed", () => {
  app.quit();
});
