// The preload runs sandboxed, before the page. Its only job is handing the
// page its MessagePort to the host. contextBridge can't pass a port, so it
// goes to the page as a window message, and the page accepts it only from
// its own window.
import { ipcRenderer } from "electron";
import { PORT_MESSAGE } from "../shared/protocol";

ipcRenderer.on(PORT_MESSAGE, (event) => {
  window.postMessage(PORT_MESSAGE, window.location.origin, event.ports);
});
