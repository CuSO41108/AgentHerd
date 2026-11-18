// When Feishu refuses a card drawn from herd-ui fences (ADR 0074), the channel puts it once more
// drawn the old way: the fences as Markdown, the answers as the old offer buttons.

import type { Inbound, View } from "@agentherd/protocol";
import { describe, expect, it } from "vitest";
import { cardRefused, type FeishuApi, FeishuApiError, feishuError } from "../src/api.ts";
import { FeishuChannel } from "../src/channel.ts";
import { parseCardAction } from "../src/inbound.ts";
import { bodyElements, buttonValue, makeReport } from "./card-helpers.ts";

type Card = Record<string, unknown>;

interface Put {
  op: "send" | "reply" | "patch";
  id: string;
  card: Card;
}

const fence = (spec: unknown) => `\`\`\`herd-ui\n${JSON.stringify(spec)}\n\`\`\``;

const TEXT = `看看这个：\n\n${fence({
  items: [
    { type: "table", columns: ["仓库", "星"], rows: [["yetone/magpie", "38k"]] },
    { type: "choices", question: "下一步？", options: ["下载跑一下", "先不用"] },
  ],
})}`;

/** The error Feishu gives for a card with too many components (230099, sub-code 11310). */
const refusal = (op = "send") =>
  new FeishuApiError(op, 230099, "Failed to create card content, ext=ErrCode: 11310");

/** All tags in a card, nested ones too. */
function tags(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) for (const v of value) tags(v, out);
  else if (typeof value === "object" && value !== null) {
    const o = value as Record<string, unknown>;
    if (typeof o.tag === "string") out.add(o.tag);
    for (const v of Object.values(o)) tags(v, out);
  }
  return out;
}

const markdownText = (card: Card) =>
  bodyElements(card)
    .filter((e) => e.tag === "markdown")
    .map((e) => e.content as string)
    .join("\n");

/**
 * A channel on a fake Feishu. `refuse` decides per put: an error to throw, or undefined to take
 * the card. By default Feishu refuses any card with a table component.
 */
async function setup(
  refuse: (put: Put) => unknown = (put) => (tags(put.card).has("table") ? refusal() : undefined),
  sink: (inbound: Inbound, channel: FeishuChannel) => Promise<void> = async () => {},
) {
  const puts: Put[] = [];
  let onCardAction: ((p: unknown) => Promise<Record<string, unknown>>) | null = null;
  const put = (op: Put["op"], id: string, card: Card): string => {
    const p = { op, id, card };
    puts.push(p);
    const error = refuse(p);
    if (error !== undefined) throw error;
    return `om_${puts.length}`;
  };
  const api: FeishuApi = {
    connect: async (h) => {
      onCardAction = h.onCardAction;
    },
    close: async () => {},
    sendCard: async (id, card) => put("send", id, card),
    replyCard: async (id, card) => put("reply", id, card),
    patchCard: async (id, card) => {
      put("patch", id, card);
    },
    pin: async () => {},
    downloadImage: async () => ({ data: new Uint8Array() }),
    downloadFile: async () => ({ data: new Uint8Array() }),
  };
  const channel = new FeishuChannel({
    getSecret: async () => "s",
    saveSecret: async () => {},
    createApi: () => api,
  });
  await channel.start(
    { channelId: "feishu", ownerId: "ou_owner", data: { appId: "cli_1" } },
    (inbound) => sink(inbound, channel),
  );
  const tap = (payload: unknown) => {
    if (onCardAction === null) throw new Error("not connected");
    return onCardAction(payload);
  };
  return { channel, puts, tap };
}

describe("a herd-ui card Feishu refuses", () => {
  it("is sent once more the old way, with the answers as buttons that mean the same", async () => {
    const { channel, puts } = await setup();
    const ref = await channel.send({ kind: "text", text: TEXT, target: "ui:abc" });
    expect(puts.map((p) => p.op)).toEqual(["send", "send"]);
    expect(tags(puts[0]?.card).has("table")).toBe(true);
    const plain = puts[1]?.card ?? {};
    expect(tags(plain).has("table")).toBe(false);
    expect(markdownText(plain)).toContain("| 仓库 | 星 |");
    expect(markdownText(plain)).toContain("下一步？");
    // The answers are buttons, not listed in the text as well.
    expect(markdownText(plain)).not.toContain("- 下载跑一下");
    const rows = bodyElements(plain).filter((e) => e.tag === "column_set");
    expect(rows.map(buttonValue)).toEqual([
      { target: "ui:abc", action: "0" },
      { target: "ui:abc", action: "1" },
    ]);
    expect(
      parseCardAction({
        operator: { open_id: "ou_owner" },
        action: { value: rows.map(buttonValue)[1] },
      }),
    ).toMatchObject({ kind: "action", target: "ui:abc", action: "1" });
    expect(ref).toEqual({ channelId: "feishu", id: "om_2" });
  });

  it("is replied once more the old way when it was a reply", async () => {
    const { channel, puts } = await setup();
    const replyTo = { channelId: "feishu", id: "om_owner_msg" };
    await channel.send({ kind: "text", text: TEXT, target: "ui:abc", replyTo });
    expect(puts.map((p) => [p.op, p.id])).toEqual([
      ["reply", "om_owner_msg"],
      ["reply", "om_owner_msg"],
    ]);
    expect(tags(puts[1]?.card).has("table")).toBe(false);
  });

  it("is patched once more the old way when it was an update", async () => {
    const { channel, puts } = await setup();
    await channel.update({ channelId: "feishu", id: "om_9" }, { kind: "text", text: TEXT });
    expect(puts.map((p) => [p.op, p.id])).toEqual([
      ["patch", "om_9"],
      ["patch", "om_9"],
    ]);
    expect(markdownText(puts[1]?.card ?? {})).toContain("- 下载跑一下");
  });

  it("keeps that message drawn the old way: its next update goes out plain at once", async () => {
    const { channel, puts } = await setup();
    const ref = await channel.send({ kind: "text", text: TEXT, target: "ui:abc" });
    await channel.update(ref, { kind: "text", text: TEXT, target: "ui:abc", chosen: "先不用" });
    expect(puts.map((p) => p.op)).toEqual(["send", "send", "patch"]);
    const patched = puts[2]?.card ?? {};
    expect(markdownText(patched)).toContain("你选了：**先不用**");
    expect(markdownText(patched)).not.toContain("- 先不用");
    expect(tags(patched).has("button")).toBe(false);
  });

  it("keeps it plain in a card callback's response too", async () => {
    const view: View = { kind: "text", text: TEXT, target: "ui:abc", chosen: "下载跑一下" };
    const { channel, puts, tap } = await setup(undefined, async (inbound, ch) => {
      if (inbound.kind === "action") await ch.update({ channelId: "feishu", id: "om_2" }, view);
    });
    await channel.send({ kind: "text", text: TEXT, target: "ui:abc" });
    const response = await tap({
      operator: { open_id: "ou_owner" },
      action: { value: { target: "ui:abc", action: "0" } },
      context: { open_message_id: "om_2" },
    });
    expect(puts).toHaveLength(2);
    const card = (response.card as { data: Card }).data;
    expect(tags(card).has("table")).toBe(false);
    expect(markdownText(card)).toContain("你选了：**下载跑一下**");
  });

  it("is not tried a third time when the plain card is refused too", async () => {
    const { channel, puts } = await setup(() => refusal());
    await expect(channel.send({ kind: "text", text: TEXT, target: "ui:abc" })).rejects.toThrow(
      "feishu send failed: 230099",
    );
    expect(puts).toHaveLength(2);
  });

  it("a report body is drawn the old way too", async () => {
    const { channel, puts } = await setup();
    await channel.send(makeReport({ body: TEXT }));
    expect(puts).toHaveLength(2);
    expect(markdownText(puts[1]?.card ?? {})).toContain("| yetone/magpie | 38k |");
  });
});

describe("cards that are not retried", () => {
  it("a network error is thrown at once", async () => {
    const { channel, puts } = await setup(() => new Error("socket hang up"));
    await expect(channel.send({ kind: "text", text: TEXT })).rejects.toThrow("socket hang up");
    expect(puts).toHaveLength(1);
  });

  it("an error a plainer card cannot help (rate limit) is thrown at once", async () => {
    const { channel, puts } = await setup(() => new FeishuApiError("send", 230020, "frequency"));
    await expect(channel.send({ kind: "text", text: TEXT })).rejects.toThrow("230020");
    expect(puts).toHaveLength(1);
  });

  it("a card without fences is not drawn again", async () => {
    const { channel, puts } = await setup(() => refusal());
    await expect(channel.send({ kind: "text", text: "普通的一句话" })).rejects.toThrow("230099");
    expect(puts).toHaveLength(1);
  });

  it("a refused reply of a message that is gone still falls back to sending", async () => {
    const { channel, puts } = await setup((put) =>
      put.op === "reply"
        ? new FeishuApiError("reply", 230011, "The message is recalled.")
        : undefined,
    );
    const replyTo = { channelId: "feishu", id: "om_gone" };
    await channel.send({ kind: "text", text: TEXT, replyTo });
    expect(puts.map((p) => p.op)).toEqual(["reply", "send"]);
    expect(tags(puts[1]?.card).has("table")).toBe(true);
  });
});

describe("Feishu error codes", () => {
  it("an HTTP 400 from the SDK keeps Feishu's code", () => {
    const http = Object.assign(new Error("Request failed with status code 400"), {
      response: { status: 400, data: { code: 230099, msg: "Failed to create card content" } },
    });
    const error = feishuError("send", http);
    expect(error).toBeInstanceOf(FeishuApiError);
    expect((error as FeishuApiError).code).toBe(230099);
    expect((error as Error).message).toBe(
      "feishu send failed: 230099 Failed to create card content",
    );
    expect(cardRefused(error)).toBe(true);
  });

  it("only codes about the card's content count as a refused card", () => {
    expect(cardRefused(new FeishuApiError("send", 230001))).toBe(true);
    expect(cardRefused(new FeishuApiError("send", 230025))).toBe(true);
    expect(cardRefused(new FeishuApiError("patch", 230011))).toBe(false);
    expect(cardRefused(new FeishuApiError("send", 99991663))).toBe(false);
    expect(cardRefused(new Error("feishu send failed: 230099"))).toBe(false);
  });

  it("an error without a Feishu answer stays as it is", () => {
    const network = new Error("socket hang up");
    expect(feishuError("send", network)).toBe(network);
    const empty = Object.assign(new Error("x"), { response: { status: 502, data: "<html>" } });
    expect(feishuError("send", empty)).toBe(empty);
    expect(feishuError("send", undefined)).toBeUndefined();
  });
});
