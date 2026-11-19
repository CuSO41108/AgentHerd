// The desktop pet (ADR 0070): a small frameless window that floats above other windows. It shows
// what AgentHerd tells the owner and lets the owner answer; all of that goes through the host API
// like the main window. Main only places, moves and sizes the window.

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  app,
  BrowserWindow,
  clipboard,
  type IpcMainEvent,
  ipcMain,
  Menu,
  screen,
  shell,
} from "electron";
import { hitPetRegion, type PetRegion } from "../shared/bridge.ts";
import { fileToOpen, type PictureDisk, pictureToShow } from "./open-file";
import { petMenuItems } from "./pet-menu";

/** Size before the renderer measures itself: the figure alone. */
const START = { width: 150, height: 150 };
const MIN = 40;
/** Gap to the screen edge the first time. */
const MARGIN = 24;

interface Corner {
  right: number;
  bottom: number;
}

interface DragState {
  cursorX: number;
  cursorY: number;
  x: number;
  y: number;
  width: number;
  height: number;
  moved: boolean;
}

function parseRegions(raw: unknown): PetRegion[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: PetRegion[] = [];
  for (const item of raw) {
    if (
      typeof item === "object" &&
      item !== null &&
      typeof (item as PetRegion).x === "number" &&
      typeof (item as PetRegion).y === "number" &&
      typeof (item as PetRegion).width === "number" &&
      typeof (item as PetRegion).height === "number"
    ) {
      out.push(item as PetRegion);
    }
  }
  return out;
}

export interface PetWindowOptions {
  preload: string;
  /** The renderer folder of a build, or the dev server's address. */
  rendererDir: string;
  devUrl?: string;
  /** Brings up the main window, at a task when one is named. */
  openApp: (taskId?: string) => void;
}

export class PetWindow {
  private win: BrowserWindow | undefined;
  private dragFrom: DragState | undefined;
  private dragTimer: ReturnType<typeof setInterval> | undefined;
  private hitTimer: ReturnType<typeof setInterval> | undefined;
  private pendingSize: { width: number; height: number; regions?: PetRegion[] } | undefined;
  private regions: PetRegion[] | undefined;
  private interacting = false;
  private ignoringMouse: boolean | undefined;
  private size = { ...START };
  private lastPlaced: { x: number; y: number } | undefined;
  /** Where the figure stands: the window grows up and left from here and shrinks back to it. */
  private anchor: Corner | undefined;
  private readonly opts: PetWindowOptions;

  constructor(opts: PetWindowOptions) {
    this.opts = opts;
    ipcMain.on("pet:drag-start", (e) => {
      const w = this.own(e);
      if (w === undefined) return;
      this.stopDragTimer();
      this.setIgnore(w, false);
      const cursor = screen.getCursorScreenPoint();
      const b = w.getBounds();
      this.dragFrom = {
        cursorX: cursor.x,
        cursorY: cursor.y,
        x: b.x,
        y: b.y,
        width: this.size.width,
        height: this.size.height,
        moved: false,
      };
      this.dragTimer = setInterval(() => this.stepDrag(), 16);
    });
    ipcMain.on("pet:drag-move", (e) => {
      if (this.own(e) !== undefined) this.stepDrag();
    });
    ipcMain.handle("pet:drag-end", (e) => {
      const w = this.own(e);
      this.stopDragTimer();
      const d = this.dragFrom;
      this.dragFrom = undefined;
      this.interacting = false;
      if (w === undefined || d === undefined) return false;
      this.stepDragWith(w, d);
      if (d.moved && this.anchor !== undefined) this.saveCorner(this.anchor);
      if (this.pendingSize !== undefined) {
        const { width, height, regions } = this.pendingSize;
        this.pendingSize = undefined;
        if (regions !== undefined) this.regions = regions;
        this.applySize(w, width, height);
      }
      this.updateHitTest();
      return d.moved;
    });
    ipcMain.on("pet:resize", (e, width: unknown, height: unknown, rawRegions?: unknown) => {
      const w = this.own(e);
      if (w === undefined || typeof width !== "number" || typeof height !== "number") return;
      const regions = parseRegions(rawRegions);
      if (this.dragFrom !== undefined) {
        if (regions !== undefined) this.regions = regions;
        if (Math.ceil(width) !== this.size.width || Math.ceil(height) !== this.size.height) {
          this.pendingSize = {
            width,
            height,
            ...(regions === undefined ? {} : { regions }),
          };
        }
        return;
      }
      if (regions !== undefined) this.regions = regions;
      this.applySize(w, width, height);
      this.updateHitTest();
    });
    ipcMain.on("pet:interacting", (e, active: unknown) => {
      if (this.own(e) === undefined || typeof active !== "boolean") return;
      this.interacting = active;
      this.updateHitTest();
    });
    ipcMain.on("pet:open-app", (e, taskId: unknown) => {
      if (this.own(e) === undefined) return;
      this.opts.openApp(typeof taskId === "string" && taskId !== "" ? taskId : undefined);
    });
    // A file a message names: documents open in their app, anything else is shown in Finder.
    ipcMain.on("pet:open-file", (e, path: unknown) => {
      if (this.own(e) === undefined) return;
      const file = fileToOpen(path, isFile);
      if (file === undefined) return;
      if (file.how === "open") void shell.openPath(file.path);
      else shell.showItemInFolder(file.path);
    });
    // A picture the Herder shows (ADR 0075): its bytes as a data URL, or undefined.
    ipcMain.handle("pet:read-image", (e, path: unknown) => {
      if (this.own(e) === undefined) return undefined;
      try {
        return pictureToShow(path, DISK);
      } catch {
        return undefined;
      }
    });
  }

  /** Shows or closes the pet. */
  set(on: boolean): void {
    if (on) this.open();
    else this.close();
  }

  /**
   * Opens the pet's panel on a page and gives it the keyboard: a notification or the menu bar
   * asked (ADR 0079). False when the pet is not shown.
   */
  show(tab: "chat" | "tasks" | "cards"): boolean {
    const w = this.win;
    if (w === undefined || w.isDestroyed()) return false;
    const tell = () => w.webContents.send("pet:show", tab);
    if (w.webContents.isLoading()) w.webContents.once("did-finish-load", tell);
    else tell();
    w.show();
    w.focus();
    if (process.platform === "darwin") app.focus({ steal: true });
    return true;
  }

  send(channel: string, payload: unknown): void {
    if (this.win !== undefined && !this.win.isDestroyed()) {
      this.win.webContents.send(channel, payload);
    }
  }

  private own(e: Pick<IpcMainEvent, "sender">): BrowserWindow | undefined {
    const w = this.win;
    return w !== undefined && !w.isDestroyed() && e.sender === w.webContents ? w : undefined;
  }

  private stopDragTimer(): void {
    if (this.dragTimer !== undefined) {
      clearInterval(this.dragTimer);
      this.dragTimer = undefined;
    }
  }

  private stopHitTimer(): void {
    if (this.hitTimer !== undefined) {
      clearInterval(this.hitTimer);
      this.hitTimer = undefined;
    }
  }

  private setIgnore(w: BrowserWindow, ignore: boolean): void {
    if (process.platform !== "win32" || this.ignoringMouse === ignore) return;
    const wasInteractive = this.ignoringMouse === false;
    this.ignoringMouse = ignore;
    w.setIgnoreMouseEvents(ignore);
    if (ignore && wasInteractive && !w.isDestroyed()) {
      w.webContents.send("pet:mouse-leave");
    }
  }

  private updateHitTest(): void {
    if (process.platform !== "win32") return;
    const w = this.win;
    if (w === undefined || w.isDestroyed()) return;
    if (this.dragFrom !== undefined || this.interacting) {
      this.setIgnore(w, false);
      return;
    }
    if (this.regions === undefined) {
      this.setIgnore(w, true);
      return;
    }
    const cursor = screen.getCursorScreenPoint();
    const b = this.lastPlaced ?? w.getBounds();
    const hit = hitPetRegion(cursor.x - b.x, cursor.y - b.y, this.size, this.regions);
    this.setIgnore(w, !hit);
  }

  private stepDrag(): void {
    const w = this.win;
    const d = this.dragFrom;
    if (w === undefined || w.isDestroyed() || d === undefined) return;
    this.stepDragWith(w, d);
  }

  private stepDragWith(w: BrowserWindow, d: DragState): void {
    const cursor = screen.getCursorScreenPoint();
    const dx = cursor.x - d.cursorX;
    const dy = cursor.y - d.cursorY;
    if (!d.moved && Math.abs(dx) + Math.abs(dy) < 4) return;
    d.moved = true;
    const x = Math.round(d.x + dx);
    const y = Math.round(d.y + dy);
    this.anchor = { right: x + d.width, bottom: y + d.height };
    if (this.lastPlaced?.x === x && this.lastPlaced?.y === y) return;
    this.lastPlaced = { x, y };
    w.setBounds({ x, y, width: d.width, height: d.height });
  }

  private applySize(w: BrowserWindow, width: number, height: number): void {
    const b = w.getBounds();
    const anchor = this.anchor ?? { right: b.x + b.width, bottom: b.y + b.height };
    this.anchor = anchor;
    const area = screen.getDisplayNearestPoint({
      x: anchor.right - 1,
      y: anchor.bottom - 1,
    }).workArea;
    // As big as the pet asks, up to the screen: the owner sizes the conversation (ADR 0070).
    const next = {
      width: clamp(Math.ceil(width), MIN, area.width),
      height: clamp(Math.ceil(height), MIN, area.height),
    };
    // Near the top or left edge the window moves in rather than grow off the screen.
    const bounds = {
      x: Math.max(area.x, anchor.right - next.width),
      y: Math.max(area.y, anchor.bottom - next.height),
      ...next,
    };
    if (
      this.size.width === next.width &&
      this.size.height === next.height &&
      this.lastPlaced?.x === bounds.x &&
      this.lastPlaced?.y === bounds.y
    ) {
      return;
    }
    this.size = next;
    this.lastPlaced = { x: bounds.x, y: bounds.y };
    w.setBounds(bounds);
  }

  private open(): void {
    if (this.win !== undefined && !this.win.isDestroyed()) return;
    const corner = this.corner();
    this.anchor = corner;
    this.size = { ...START };
    this.lastPlaced = { x: corner.right - START.width, y: corner.bottom - START.height };
    this.regions = undefined;
    this.interacting = false;
    this.ignoringMouse = undefined;
    const created = new BrowserWindow({
      x: corner.right - START.width,
      y: corner.bottom - START.height,
      ...START,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: "#00000000",
      hasShadow: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      // On macOS the first click on a window of an app in the background only brings the app
      // forward; the pet should open, take the cursor or press 同意 on that first click.
      acceptFirstMouse: true,
      title: "AgentHerd",
      webPreferences: {
        preload: this.opts.preload,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    });
    this.win = created;
    created.setAlwaysOnTop(true, "floating");
    created.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    if (process.platform === "win32") {
      this.setIgnore(created, true);
      this.hitTimer = setInterval(() => this.updateHitTest(), 25);
    }
    created.on("blur", () => {
      if (this.dragFrom === undefined) {
        this.interacting = false;
        this.updateHitTest();
      }
    });
    created.once("ready-to-show", () => created.showInactive());
    created.on("closed", () => {
      if (this.win === created) {
        this.win = undefined;
        this.stopDragTimer();
        this.stopHitTimer();
        this.dragFrom = undefined;
        this.pendingSize = undefined;
        this.lastPlaced = undefined;
        this.regions = undefined;
        this.interacting = false;
        this.ignoringMouse = undefined;
      }
    });
    // Links in messages open in the browser; the pet itself never navigates or opens windows.
    created.webContents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith("https://") || url.startsWith("http://")) void shell.openExternal(url);
      return { action: "deny" };
    });
    created.webContents.on("will-navigate", (event) => event.preventDefault());
    // Right-click: copy words, a picture or a link; cut and paste in the input (ADR 0075).
    created.webContents.on("context-menu", (_event, place) => {
      const contents = created.webContents;
      const items = petMenuItems(place);
      if (items.length === 0) return;
      const run = {
        cut: () => contents.cut(),
        copy: () => contents.copy(),
        paste: () => contents.paste(),
        selectAll: () => contents.selectAll(),
        copyImage: () => contents.copyImageAt(place.x, place.y),
        copyLink: () => clipboard.writeText(place.linkURL),
      };
      Menu.buildFromTemplate(
        items.map((item) => ({ label: item.label, click: run[item.action] })),
      ).popup({ window: created });
    });
    if (this.opts.devUrl !== undefined)
      void created.loadURL(new URL("pet.html", this.opts.devUrl).href);
    else void created.loadFile(join(this.opts.rendererDir, "pet.html"));
  }

  private close(): void {
    const w = this.win;
    this.win = undefined;
    this.stopDragTimer();
    this.stopHitTimer();
    this.dragFrom = undefined;
    this.pendingSize = undefined;
    this.lastPlaced = undefined;
    this.regions = undefined;
    this.interacting = false;
    this.ignoringMouse = undefined;
    if (w !== undefined && !w.isDestroyed()) w.close();
  }

  private file(): string {
    return join(app.getPath("userData"), "pet-window.json");
  }

  /** Where the pet's bottom-right corner was left, if that is still on a screen. */
  private corner(): Corner {
    try {
      const saved = JSON.parse(readFileSync(this.file(), "utf8")) as Corner;
      if (typeof saved.right === "number" && typeof saved.bottom === "number") {
        const area = screen.getDisplayNearestPoint({ x: saved.right, y: saved.bottom }).workArea;
        const inside =
          saved.right > area.x + MIN &&
          saved.right <= area.x + area.width + MIN &&
          saved.bottom > area.y + MIN &&
          saved.bottom <= area.y + area.height + MIN;
        if (inside) return saved;
      }
    } catch {
      // first time, or an unreadable file: start in the corner
    }
    const area = screen.getPrimaryDisplay().workArea;
    return { right: area.x + area.width - MARGIN, bottom: area.y + area.height - MARGIN };
  }

  private saveCorner(corner: Corner): void {
    try {
      const file = this.file();
      if (!existsSync(dirname(file))) mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify(corner));
    } catch {
      // the pet just starts in the corner next time
    }
  }
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

const DISK: PictureDisk = {
  fileSize(path) {
    try {
      const s = statSync(path);
      return s.isFile() ? s.size : undefined;
    } catch {
      return undefined;
    }
  },
  read: (path) => new Uint8Array(readFileSync(path)),
};

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}
