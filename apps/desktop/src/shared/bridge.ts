// The only thing the renderer can reach: `window.agentherd`, set by the preload script.
// The renderer has no Node access; every call goes main → host over the local API socket.

import type { HostEvent, RemoteHost } from "@agentherd/host/api";

/** The desktop pet window's own calls (ADR 0070); main ignores them from other windows. */
export interface PetBridge {
  /** A drag on the figure began; moves are counted from here. */
  dragStart(): void;
  /** Moves the pet window by this many screen pixels from where the drag began. */
  dragMove(dx: number, dy: number): void;
  dragEnd(): void;
  /** Fits the window to the pet, keeping its bottom-right corner where it is. */
  resize(width: number, height: number): void;
  /** Brings up the main window, at a task when one is named (ADR 0072). */
  openApp(taskId?: string): void;
  /** Opens a file a message names, or shows it in Finder when it is not a document (ADR 0073). */
  openFile(path: string): void;
  /**
   * A picture the Herder shows, as a data URL; undefined when it is not a picture main will read
   * (ADR 0075). Missing in older builds.
   */
  readImage?(path: string): Promise<string | undefined>;
}

export interface Bridge {
  host: RemoteHost;
  pet?: PetBridge;
  /** Host events (status, tasks, models, setup). Returns an unsubscribe function. */
  onEvent(listener: (event: HostEvent) => void): () => void;
  /** Whether main is connected to the host process. */
  onConnection(listener: (connected: boolean) => void): () => void;
  /** The pet asked the main window to show a task. Returns an unsubscribe function. */
  onOpenTask?(listener: (taskId: string) => void): () => void;
}

declare global {
  interface Window {
    agentherd: Bridge;
  }
}
