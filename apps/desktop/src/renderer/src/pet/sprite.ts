// The desktop pet's moving pictures (ADR 0070). Each figure is one atlas of 192×208 cells, cut
// from the llm-pet sprite sheets (Codex pet layout): one row per clip, played with the frame
// times of the Codex pet format. Pure functions, so they are easy to test.

import { MOODS, type Mood } from "./pet-state";

export const CELL = { width: 192, height: 208 } as const;
export const ATLAS = { columns: 8, rows: MOODS.length + 1 } as const;

/** The moods, plus a wave when the owner clicks the pet. */
export type Clip = Mood | "hello";

export interface Animation {
  /** Row in the atlas. */
  row: number;
  /** How long each frame shows, in ms. */
  durations: readonly number[];
  /** Plays again and again; otherwise it stops on its last frame. */
  loop: boolean;
  /** Holds the first frame this long before each round, so a calm pet is not busy. */
  rest?: number;
}

const each = (ms: number, count: number, last: number): number[] => [
  ...Array.from({ length: count - 1 }, () => ms),
  last,
];

/** Rows follow MOODS, then hello. Frame times are the Codex pet ones for the matching row. */
export const ANIMATIONS: Record<Clip, Animation> = {
  // Codex idle: breathing and blinking
  resting: { row: 0, durations: [280, 110, 110, 140, 140, 320], loop: true, rest: 2_400 },
  // Codex running (busy with a task)
  working: { row: 1, durations: each(120, 6, 220), loop: true },
  // Codex waiting (asks for approval)
  waiting: { row: 2, durations: each(150, 6, 260), loop: true },
  // Codex jumping
  celebrate: { row: 3, durations: each(140, 5, 280), loop: true },
  // Codex failed: once, then stays down
  error: { row: 4, durations: each(140, 8, 240), loop: false },
  // one still frame; the slow breathing is CSS
  sleeping: { row: 5, durations: [1_000], loop: false },
  // Codex waving
  hello: { row: 6, durations: each(140, 4, 280), loop: true },
};

/** One wave of hello. */
export const HELLO_MS = ANIMATIONS.hello.durations.reduce((a, b) => a + b, 0);

/** The frame to show `elapsed` ms after a clip started, and how long until the next one. */
export function frameAt(a: Animation, elapsed: number): { column: number; next: number } {
  const last = a.durations.length - 1;
  if (last <= 0) return { column: 0, next: Number.POSITIVE_INFINITY };
  const rest = a.rest ?? 0;
  const round = rest + a.durations.reduce((x, y) => x + y, 0);
  let t = Math.max(0, elapsed);
  if (!a.loop && t >= round) return { column: last, next: Number.POSITIVE_INFINITY };
  t %= round;
  if (t < rest) return { column: 0, next: rest - t };
  t -= rest;
  for (const [column, ms] of a.durations.entries()) {
    if (t < ms) return { column, next: ms - t };
    t -= ms;
  }
  return { column: last, next: 1 };
}
