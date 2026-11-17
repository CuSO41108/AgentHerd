// The desktop pet (ADR 0070): a small figure floating over other windows. It moves with what
// AgentHerd is doing, says in a bubble what AgentHerd just told the owner (the same as Feishu),
// shows the buttons of whatever waits for the owner, and passes what the owner types to the
// Herder. Drag it anywhere; the small button folds it into a dot.

import type { PetFigure, PetView, TasksView } from "@agentherd/host/api";
import {
  type KeyboardEvent,
  type PointerEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { FIGURES, FRAME } from "./figures";
import {
  cannedLine,
  cut,
  FLASH_MS,
  flashOf,
  lineText,
  MOODS,
  type Mood,
  moodOf,
} from "./pet-state";

const SCALE = 0.58;
const W = Math.round(FRAME.width * SCALE);
const H = Math.round(FRAME.height * SCALE);
/** The folded pet: the head of the current frame in a circle. */
const DOT = 46;
const DOT_SCALE = 0.5;
const COLLAPSED_KEY = "agentherd.pet.collapsed";

function errorText(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.replace(/^Error invoking remote method '[^']*': (?:Error: )?/, "");
}

function countWorking(view: TasksView): number {
  return view.tasks.filter((t) => t.stage === "working" || t.stage === "queued").length;
}

interface Speech {
  text: string;
  until: number;
}

export function Pet() {
  const bridge = window.agentherd;
  const [view, setView] = useState<PetView>({ connected: false, pending: [] });
  const [figure, setFigure] = useState<PetFigure>("deepseek");
  const [working, setWorking] = useState(0);
  const [online, setOnline] = useState(true);
  const [flash, setFlash] = useState<{ mood: "celebrate" | "error"; until: number }>();
  const [lastActive, setLastActive] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const [speech, setSpeech] = useState<Speech>();
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState(false);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSED_KEY) === "1");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string>();
  const [hello, setHello] = useState(false);
  const lastId = useRef<number | undefined>(undefined);
  const lastCanned = useRef<string | undefined>(undefined);
  const root = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; moved: boolean } | undefined>(undefined);

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
      if (first || lastId.current === undefined) {
        lastId.current = line.id;
        return;
      }
      if (line.id <= lastId.current) return;
      lastId.current = line.id;
      const t = Date.now();
      setSpeech({ text: lineText(line), until: t + FLASH_MS });
      const f = flashOf(line);
      if (f !== undefined) setFlash({ mood: f, until: t + FLASH_MS });
      setLastActive(t);
      setNote(undefined);
    };
    h.pet()
      .then((v) => apply(v, true))
      .catch(() => undefined);
    h.status()
      .then((s) => setFigure(s.pet?.figure ?? "deepseek"))
      .catch(() => undefined);
    h.tasks()
      .then((t) => setWorking(countWorking(t)))
      .catch(() => undefined);
    const offEvent = bridge.onEvent((e) => {
      if (e.topic === "pet") apply(e.data, false);
      else if (e.topic === "status") setFigure(e.data.pet?.figure ?? "deepseek");
      else if (e.topic === "tasks") {
        setWorking(countWorking(e.data));
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

  // A few words of its own when it starts working or dozes off, unless it is already talking.
  const previousMood = useRef<Mood>(mood);
  useEffect(() => {
    if (previousMood.current === mood) return;
    previousMood.current = mood;
    if (mood !== "working" && mood !== "sleeping") return;
    setSpeech((current) => {
      const t = Date.now();
      if (current !== undefined && current.until > t) return current;
      const text = cannedLine(mood, lastCanned.current);
      lastCanned.current = text;
      return { text, until: t + FLASH_MS };
    });
  }, [mood]);

  // The window is as big as the pet; it grows up and to the left when the bubble opens.
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
    setTimeout(() => setHello(false), 1300);
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

  const fold = (value: boolean) => {
    setCollapsed(value);
    localStorage.setItem(COLLAPSED_KEY, value ? "1" : "0");
    if (value) setOpen(false);
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

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.nativeEvent.isComposing) void send();
    if (e.key === "Escape") setOpen(false);
  };

  const strip = FIGURES[figure].strip;
  const frame = MOODS.indexOf(mood);
  const pending = view.pending[0];
  const speaking = speech !== undefined && speech.until > now;
  const offline = !online || !view.connected;

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
            backgroundImage: `url(${strip})`,
            backgroundSize: `${FRAME.width * DOT_SCALE * MOODS.length}px ${FRAME.height * DOT_SCALE}px`,
            backgroundPosition: `${-(frame * FRAME.width * DOT_SCALE) - 25}px -6px`,
          }}
        >
          {view.pending.length > 0 && <span className="pet-badge">{view.pending.length}</span>}
        </button>
      </div>
    );
  }

  const showBubble =
    open || pending !== undefined || speaking || (hover && (view.last !== undefined || offline));
  const idleText = offline
    ? "AgentHerd 还没连上飞书，先在 App 里设置好。"
    : view.last === undefined
      ? cannedLine("resting")
      : lineText(view.last);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: hovering only shows the fold button
    <div
      ref={root}
      className="pet-root"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {showBubble && (
        <div className="pet-bubble">
          {open && (
            <button
              type="button"
              className="pet-close"
              aria-label="收起对话"
              onClick={() => setOpen(false)}
            >
              ×
            </button>
          )}
          {pending !== undefined ? (
            <div className="pet-card">
              {pending.task !== undefined && (
                <div className="pet-task">{cut(pending.task, 30)}</div>
              )}
              <div className="pet-title">{cut(pending.title, 120)}</div>
              {pending.body !== "" && <div className="pet-body">{pending.body}</div>}
              <div className="pet-actions">
                {pending.options.map((o) => (
                  <button
                    key={o.action}
                    type="button"
                    disabled={busy || offline}
                    className={o.action === "allow" || o.action === "allow-all" ? "primary" : ""}
                    onClick={() => void press(pending.target, o.action)}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
              {view.pending.length > 1 && (
                <div className="pet-more">还有 {view.pending.length - 1} 件等你</div>
              )}
            </div>
          ) : (
            <div className="pet-text">{speaking && !open ? speech.text : idleText}</div>
          )}
          {open && (
            <>
              <input
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
          )}
          {!open && note !== undefined && <div className="pet-note">{note}</div>}
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
          aria-label="桌宠，点一下跟主管说话"
          className={`pet-figure mood-${mood}${hello ? " hello" : ""}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp(() => {
            touch();
            setOpen((o) => !o);
          })}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") setOpen((o) => !o);
          }}
          style={{
            width: W,
            height: H,
            backgroundImage: `url(${strip})`,
            backgroundSize: `${W * MOODS.length}px ${H}px`,
            backgroundPosition: `${-frame * W}px 0`,
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
