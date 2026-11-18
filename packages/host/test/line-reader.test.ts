// A line split across chunks inside a Chinese character still reads whole (the pet showed
// 「自托��个人」 in a long answer when every chunk was decoded alone).

import { describe, expect, it } from "vitest";
import { lineReader } from "../src/server.ts";

describe("lineReader", () => {
  it("keeps a character whose bytes arrive in two chunks", () => {
    const lines: string[] = [];
    const read = lineReader((l) => lines.push(l));
    const bytes = Buffer.from(`${JSON.stringify({ text: "超轻量自托管个人 agent" })}\n`, "utf8");
    const at = bytes.indexOf(Buffer.from("管", "utf8")) + 1; // inside the three bytes of 管
    read(bytes.subarray(0, at));
    read(bytes.subarray(at));
    expect(lines.map((l) => JSON.parse(l).text)).toEqual(["超轻量自托管个人 agent"]);
  });

  it("reads several lines from one chunk and one line from many", () => {
    const lines: string[] = [];
    const read = lineReader((l) => lines.push(l));
    read(Buffer.from("一\n二\n三", "utf8"));
    for (const b of Buffer.from("四\n", "utf8")) read(Buffer.from([b]));
    expect(lines).toEqual(["一", "二", "三四"]);
  });
});
