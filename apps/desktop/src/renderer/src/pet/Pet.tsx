// The desktop pet (ADR 0070): a small figure floating over other windows. It moves with what
// AgentHerd is doing. A click opens the conversation with the Herder, both ways and in full; it
// also opens by itself when AgentHerd tells the owner something (the same as Feishu), without
// taking the keyboard. It shows the buttons of whatever waits for the owner and passes what the
// owner types to the Herder. Cards come in it as in Feishu, with a card for each task (ADR 0072).
// Its top-left corner and edges resize it. Drag the figure anywhere; the small button folds it
// into a dot, which counts what came meanwhile.

import type { PetFigure, PetView, TasksView } from "@agentherd/host/api";
import {
  type KeyboardEvent,
  type PointerEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { devOpen } from "../dev-bridge";
import { FIGURES } from "./figures";
import { CardView, TaskCard } from "./PetCards";
import {
  badgeOf,
  CHAT_DEFAULT,
  type ChatSize,
  clockOf,
  conversationOf,
  dragChat,
  FLASH_MS,
  fitChat,
  flashOf,
  type Grip,
  historyHead,
  type Mood,
  moodOf,
  newestScroll,
  newLine,
  readChatSize,
} from "./pet-state";
import { ANIMATIONS, ATLAS, CELL, type Clip, frameAt, HELLO_MS } from "./sprite";

const SCALE = 0.58;
const W = Math.round(CELL.width * SCALE);
const H = Math.round(CELL.height * SCALE);
/** The folded pet: the head of the current frame in a circle. */
const DOT = 46;
const DOT_SCALE = 0.5;
const COLLAPSED_KEY = "agentherd.pet.collapsed";
/** The size the owner gave the conversation (ADR 0070). */
const CHAT_KEY = "agentherd.pet.chat";
/** Room on the screen before the pet has measured itself: the figure, input and margins. */
const CHAT_CHROME = { width: 60, height: 280 };

function screenRoom(): ChatSize {
  return {
    width: window.screen.availWidth - CHAT_CHROME.width,
    list: window.screen.availHeight - CHAT_CHROME.height,
  };
}

function errorText(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.replace(/^Error invoking remote method '[^']*': (?:Error: )?/, "");
}

type Task = TasksView["tasks"][number];

function countWorking(tasks: readonly Task[]): number {
  return tasks.filter((t) => t.stage === "working" || t.stage === "queued").length;
}

export function Pet() {
  const bridge = window.agentherd;
  const [view, setView] = useState<PetView>({
    connected: false,
    pending: [],
    history: [],
    cards: [],
  });
  const [figure, setFigure] = useState<PetFigure>("deepseek");
  const [tasks, setTasks] = useState<Task[]>([]);
  const working = countWorking(tasks);
  const [online, setOnline] = useState(true);
  const [flash, setFlash] = useState<{ mood: "celebrate" | "error"; until: number }>();
  const [lastActive, setLastActive] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  /** The conversation is showing. */
  const [open, setOpen] = useState(() => devOpen() === "chat");
  const [hover, setHover] = useState(false);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSED_KEY) === "1");
  /** Lines that came while the pet was folded. */
  const [unread, setUnread] = useState(0);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string>();
  const [hello, setHello] = useState(false);
  const [chat, setChat] = useState<ChatSize>(() => readChatSize(localStorage.getItem(CHAT_KEY)));
  /** The largest conversation that fits on this screen next to the rest of the pet. */
  const [room, setRoom] = useState<ChatSize>(screenRoom);
  const lastId = useRef<number | undefined>(undefined);
  const folded = useRef(collapsed);
  const root = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; moved: boolean } | undefined>(undefined);
  const figureEl = useRef<HTMLButtonElement>(null);
  const inputEl = useRef<HTMLInputElement>(null);
  const listEl = useRef<HTMLDivElement>(null);
  const panelEl = useRef<HTMLDivElement>(null);
  /** How far the conversation is scrolled up from its bottom, kept while it is resized. */
  const fromBottom = useRef(0);
  const resizing = useRef<{ grip: Grip; x: number; y: number; start: ChatSize } | undefined>(
    undefined,
  );

  const mood: Mood = moodOf({
    view,
    working,
    ...(flash === undefined ? {} : { flash }),
    lastActive,
    now,
    online,
  });

  useEffect(() => {
    const h = bridge.host;
    const apply = (next: PetView, first: boolean) => {
      setView(next);
      const line = next.last;
      if (line === undefined) return;
      const fresh = !first && newLine(lastId.current, line);
      if (first || fresh || lastId.current === undefined) lastId.current = line.id;
      if (!fresh) return;
      const t = Date.now();
      const f = flashOf(line);
      if (f !== undefined) setFlash({ mood: f, until: t + FLASH_MS });
      setLastActive(t);
      setNote(undefined);
      // Shown in full at once; a folded pet only counts it.
      if (folded.current) setUnread((n) => n + 1);
      else setOpen(true);
    };
    h.pet()
      .then((v) => apply(v, true))
      .catch(() => undefined);
    h.status()
      .then((s) => setFigure(s.pet?.figure ?? "deepseek"))
      .catch(() => undefined);
    h.tasks()
      .then((t) => setTasks(t.tasks))
      .catch(() => undefined);
    const offEvent = bridge.onEvent((e) => {
      if (e.topic === "pet") apply(e.data, false);
      else if (e.topic === "status") setFigure(e.data.pet?.figure ?? "deepseek");
      else if (e.topic === "tasks") {
        setTasks(e.data.tasks);
        setLastActive(Date.now());
      }
    });
    const offConnection = bridge.onConnection(setOnline);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      offEvent();
      offConnection();
      clearInterval(tick);
    };
  }, []);

  // Plays the clip's frames on the figure. Writes the style directly: no React render per frame.
  const clip: Clip = hello ? "hello" : mood;
  useEffect(() => {
    if (collapsed) return;
    const animation = ANIMATIONS[clip];
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const start = performance.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const show = () => {
      const { column, next } = frameAt(animation, still ? 0 : performance.now() - start);
      const el = figureEl.current;
      if (el !== null) el.style.backgroundPosition = `${-column * W}px ${-animation.row * H}px`;
      if (!still && Number.isFinite(next)) timer = setTimeout(show, Math.max(16, next));
    };
    show();
    return () => clearTimeout(timer);
  }, [clip, collapsed]);

  // Back to the pet with the conversation open: the cursor goes straight into the input.
  useEffect(() => {
    if (!open) return;
    const toInput = () => inputEl.current?.focus();
    window.addEventListener("focus", toInput);
    return () => window.removeEventListener("focus", toInput);
  }, [open]);

  // The conversation opens at its newest message, from its first line, and follows new ones.
  const shown = open && !collapsed;
  const entries = conversationOf(view, tasks, now);
  const newestKey = entries.at(-1)?.key;
  useLayoutEffect(() => {
    const el = listEl.current;
    if (!shown || el === null || newestKey === "") return;
    const newest = el.lastElementChild;
    const top = newest instanceof HTMLElement ? newest.offsetTop - 4 : el.scrollHeight;
    el.scrollTop = newestScroll(top, el.scrollHeight - el.clientHeight);
    fromBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight;
  }, [shown, newestKey]);

  // Measures how big the conversation may get: the screen less the rest of the pet.
  const size = fitChat(chat, room);
  // A new size keeps what was at the bottom in place; growing shows more of what came before.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the size changes
  useLayoutEffect(() => {
    const el = listEl.current;
    if (el === null) return;
    el.scrollTop = el.scrollHeight - el.clientHeight - fromBottom.current;
  }, [size.width, size.list]);
  useLayoutEffect(() => {
    const r = root.current;
    const p = panelEl.current;
    const l = listEl.current;
    if (!shown || r === null || p === null || l === null) return;
    const next = {
      width: window.screen.availWidth - (r.offsetWidth - p.offsetWidth),
      list: window.screen.availHeight - (r.offsetHeight - l.offsetHeight),
    };
    setRoom((current) =>
      current.width === next.width && current.list === next.list ? current : next,
    );
  });

  // The window is as big as the pet; it grows up and to the left when the conversation opens.
  useLayoutEffect(() => {
    const el = root.current;
    if (el === null) return;
    const fit = () => bridge.pet?.resize(el.offsetWidth, el.offsetHeight);
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const touch = () => {
    setLastActive(Date.now());
    setHello(true);
    setTimeout(() => setHello(false), 2 * HELLO_MS);
  };

  const onPointerDown = (e: PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // a synthetic event without a live pointer: no capture needed
    }
    drag.current = { x: e.screenX, y: e.screenY, moved: false };
    bridge.pet?.dragStart();
  };
  const onPointerMove = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (d === undefined) return;
    const dx = e.screenX - d.x;
    const dy = e.screenY - d.y;
    if (!d.moved && Math.abs(dx) + Math.abs(dy) < 4) return;
    d.moved = true;
    bridge.pet?.dragMove(dx, dy);
  };
  const onPointerUp = (click: () => void) => () => {
    const d = drag.current;
    drag.current = undefined;
    bridge.pet?.dragEnd();
    if (d !== undefined && !d.moved) click();
  };

  const close = () => setOpen(false);

  const onFigureClick = () => {
    touch();
    setOpen((x) => !x);
  };

  const onGripDown = (grip: Grip) => (e: PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // a synthetic event without a live pointer: no capture needed
    }
    resizing.current = { grip, x: e.screenX, y: e.screenY, start: size };
  };
  const draggedTo = (e: PointerEvent<HTMLElement>): ChatSize | undefined => {
    const r = resizing.current;
    return r === undefined
      ? undefined
      : dragChat(r.start, r.grip, e.screenX - r.x, e.screenY - r.y, room);
  };
  const onGripMove = (e: PointerEvent<HTMLElement>) => {
    const next = draggedTo(e);
    if (next !== undefined) setChat(next);
  };
  const onGripUp = (e: PointerEvent<HTMLElement>) => {
    const next = draggedTo(e);
    resizing.current = undefined;
    if (next === undefined) return;
    setChat(next);
    localStorage.setItem(CHAT_KEY, JSON.stringify(next));
  };
  const resetChat = () => {
    setChat(CHAT_DEFAULT);
    localStorage.removeItem(CHAT_KEY);
  };
  const grip = (where: Grip) => (
    <div
      className={`pet-grip ${where}`}
      title="拖动改大小，双击恢复默认"
      aria-hidden="true"
      onPointerDown={onGripDown(where)}
      onPointerMove={onGripMove}
      onPointerUp={onGripUp}
      onDoubleClick={resetChat}
    />
  );

  const fold = (value: boolean) => {
    setCollapsed(value);
    folded.current = value;
    localStorage.setItem(COLLAPSED_KEY, value ? "1" : "0");
    if (value) close();
    else {
      // Unfolding shows what came meanwhile.
      if (unread > 0) setOpen(true);
      setUnread(0);
    }
  };

  const send = async () => {
    const text = draft.trim();
    if (text === "" || busy) return;
    setBusy(true);
    try {
      await bridge.host.petSay(text);
      setDraft("");
      setNote("已发给主管，等它回复…");
    } catch (error) {
      setNote(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const press = async (target: string, action: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await bridge.host.petPress(target, action);
      setNote(undefined);
    } catch (error) {
      setNote(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const stop = async (taskId: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await bridge.host.stopTask(taskId);
      setNote("已停下这个任务");
    } catch (error) {
      setNote(errorText(error));
    } finally {
      setBusy(false);
    }
  };
  const openTask = (taskId: string) => bridge.pet?.openApp(taskId);

  // The first card that waits for the owner, scrolled to from the note above the input.
  const toWaiting = () => {
    const el = listEl.current?.querySelector<HTMLElement>("[data-open='1']");
    el?.scrollIntoView({ block: "start", behavior: "smooth" });
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.nativeEvent.isComposing) void send();
    if (e.key === "Escape") close();
  };

  const atlas = FIGURES[figure].atlas;
  const offline = !online || !view.connected;
  const badge = badgeOf(view.pending.length, unread);
  const actions = {
    busy,
    offline,
    press: (target: string, action: string) => void press(target, action),
    openTask,
  };

  if (collapsed) {
    return (
      <div ref={root} className="pet-root">
        <button
          type="button"
          className="pet-dot"
          aria-label="展开桌宠"
          title="展开"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp(() => fold(false))}
          style={{
            width: DOT,
            height: DOT,
            backgroundImage: `url(${atlas})`,
            backgroundSize: `${CELL.width * DOT_SCALE * ATLAS.columns}px ${CELL.height * DOT_SCALE * ATLAS.rows}px`,
            backgroundPosition: `-25px ${-(ANIMATIONS[mood].row * CELL.height * DOT_SCALE) - 6}px`,
          }}
        >
          {badge > 0 && <span className="pet-badge">{badge}</span>}
        </button>
      </div>
    );
  }

  const waiting =
    view.pending.length === 0 ? undefined : (
      <button type="button" className="pet-waiting" onClick={toWaiting}>
        {view.pending.length} 件等你处理 ↑
      </button>
    );

  const talk = (
    <>
      {offline && <div className="pet-note">AgentHerd 还没连上飞书，先在 App 里设置好。</div>}
      <input
        ref={inputEl}
        className="pet-input"
        autoFocus
        value={draft}
        disabled={offline}
        placeholder={offline ? "连上飞书后才能说话" : "跟主管说…（回车发送）"}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKey}
      />
      <div className="pet-foot">
        <span className="pet-note">{note ?? ""}</span>
        <button type="button" className="pet-link" onClick={() => bridge.pet?.openApp()}>
          打开 App
        </button>
      </div>
    </>
  );

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: hovering only shows the fold button
    <div
      ref={root}
      className="pet-root"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {open && (
        <div className="pet-bubble pet-chat" ref={panelEl} style={{ width: size.width }}>
          {grip("top")}
          {grip("left")}
          {grip("corner")}
          <div className="pet-chat-head">
            <span>和主管的对话</span>
            <span className="pet-chat-tools">
              <button type="button" className="pet-x" aria-label="收起对话" onClick={close}>
                ×
              </button>
            </span>
          </div>
          <div
            className="pet-chat-list"
            ref={listEl}
            style={{ height: size.list }}
            onScroll={(e) => {
              const el = e.currentTarget;
              fromBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight;
            }}
          >
            {entries.length === 0 ? (
              <div className="pet-note">
                还没有和主管的对话。在这里或飞书里说的话都会出现在这儿。
              </div>
            ) : (
              entries.map((entry) => {
                if (entry.kind === "card") {
                  return (
                    <div key={entry.key} data-open={entry.card.open ? "1" : "0"}>
                      <CardView card={entry.card} actions={actions} />
                    </div>
                  );
                }
                if (entry.kind === "task") {
                  return (
                    <TaskCard
                      key={entry.key}
                      task={entry.task}
                      now={now}
                      busy={busy}
                      stop={(id) => void stop(id)}
                      open={openTask}
                    />
                  );
                }
                const { line } = entry;
                const head = historyHead(line);
                const tone = line.kind === "owner" ? " mine" : line.kind === "error" ? " bad" : "";
                return (
                  <div key={entry.key} className={`pet-msg${tone}`}>
                    {head !== undefined && <div className="pet-msg-task">{head}</div>}
                    <div className="pet-msg-text">{line.text}</div>
                    <div className="pet-msg-time">{clockOf(line.at)}</div>
                  </div>
                );
              })
            )}
          </div>
          {waiting}
          {talk}
        </div>
      )}
      <div className="pet-stage" style={{ width: W, height: H }}>
        {hover && (
          <button
            type="button"
            className="pet-fold"
            aria-label="收起成小圆点"
            title="收起"
            onClick={() => fold(true)}
          >
            –
          </button>
        )}
        <button
          type="button"
          aria-label="桌宠：点一下打开或关上和主管的对话"
          title="点一下打开或关上对话"
          ref={figureEl}
          className={`pet-figure mood-${mood}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp(onFigureClick)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") setOpen((x) => !x);
          }}
          style={{
            width: W,
            height: H,
            backgroundImage: `url(${atlas})`,
            backgroundSize: `${W * ATLAS.columns}px ${H * ATLAS.rows}px`,
          }}
        />
        {view.pending.length > 0 && <span className="pet-badge">{view.pending.length}</span>}
        {mood === "sleeping" && (
          <span className="pet-zz" aria-hidden="true">
            <i>z</i>
            <i>z</i>
            <i>Z</i>
          </span>
        )}
        {mood === "celebrate" && (
          <span className="pet-sparkles" aria-hidden="true">
            <i>✦</i>
            <i>✦</i>
            <i>✧</i>
          </span>
        )}
      </div>
    </div>
  );
}
