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
  /** Brings up the main window. */
  openApp(): void;
}

export interface Bridge {
  host: RemoteHost;
  pet?: PetBridge;
  /** Host events (status, tasks, models, setup). Returns an unsubscribe function. */
  onEvent(listener: (event: HostEvent) => void): () => void;
  /** Whether main is connected to the host process. */
  onConnection(listener: (connected: boolean) => void): () => void;
}

declare global {
  interface Window {
    agentherd: Bridge;
  }
}
