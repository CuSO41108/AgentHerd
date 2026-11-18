// The renderer's only door: `window.agentherd` (src/shared/bridge.ts).

import type { HostEvent, HostMethod, RemoteHost } from "@agentherd/host/api";
import { HOST_METHODS } from "@agentherd/host/api";
import { contextBridge, ipcRenderer } from "electron";
import type { Bridge } from "../shared/bridge.ts";

const host = Object.fromEntries(
  HOST_METHODS.map((method: HostMethod) => [
    method,
    (...params: unknown[]) => ipcRenderer.invoke("host:call", method, params),
  ]),
) as unknown as RemoteHost;

const bridge: Bridge = {
  host,
  onEvent(listener) {
    const handler = (_e: unknown, event: HostEvent) => listener(event);
    ipcRenderer.on("host:event", handler);
    return () => ipcRenderer.removeListener("host:event", handler);
  },
  pet: {
    dragStart: () => ipcRenderer.send("pet:drag-start"),
    dragMove: () => ipcRenderer.send("pet:drag-move"),
    dragEnd: () => ipcRenderer.invoke("pet:drag-end") as Promise<boolean>,
    resize: (width, height, regions) => ipcRenderer.send("pet:resize", width, height, regions),
    interacting: (active) => ipcRenderer.send("pet:interacting", active),
    onMouseLeave(listener) {
      const handler = () => listener();
      ipcRenderer.on("pet:mouse-leave", handler);
      return () => ipcRenderer.removeListener("pet:mouse-leave", handler);
    },
    openApp: (taskId) => ipcRenderer.send("pet:open-app", taskId),
    openFile: (path) => ipcRenderer.send("pet:open-file", path),
  },
  onConnection(listener) {
    const handler = (_e: unknown, connected: boolean) => listener(connected);
    ipcRenderer.on("host:connection", handler);
    void ipcRenderer.invoke("host:connected").then((c: boolean) => listener(c));
    return () => ipcRenderer.removeListener("host:connection", handler);
  },
  onOpenTask(listener) {
    const handler = (_e: unknown, taskId: string) => listener(taskId);
    ipcRenderer.on("app:open-task", handler);
    return () => ipcRenderer.removeListener("app:open-task", handler);
  },
};

contextBridge.exposeInMainWorld("agentherd", bridge);
