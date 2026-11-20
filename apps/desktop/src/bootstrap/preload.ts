/**
 * Sandboxed preload. The only bridge is the MessagePort transferred from Electron main.
 * Node APIs are not exposed to the page.
 */
export const PRELOAD_CJS = `
const { ipcRenderer } = require("electron");
ipcRenderer.on("ef-port", (event) => {
  const port = event.ports && event.ports[0];
  if (!port) return;
  window.postMessage("ef-port", "*", [port]);
});
`;

export interface M1PreloadContract {
  readonly channel: "ef-port";
  readonly pageEventData: "ef-port";
  readonly portIndex: 0;
}

export const M1_PRELOAD_CONTRACT: M1PreloadContract = {
  channel: "ef-port",
  pageEventData: "ef-port",
  portIndex: 0,
};
