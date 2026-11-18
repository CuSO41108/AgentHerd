// Pictures the Herder shows (ADR 0075): the channel uploads them and draws an img element; a
// picture it cannot read or upload is named by its path, and only real pictures leave the Mac.

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { FeishuApi } from "../src/api.ts";
import { renderCard } from "../src/card.ts";
import { FeishuChannel, IMAGE_RETRY_MS, pictureType, readPicture } from "../src/channel.ts";
import { bodyElements } from "./card-helpers.ts";

type Card = Record<string, unknown>;

const fence = (spec: unknown) => `\`\`\`herd-ui\n${JSON.stringify(spec)}\n\`\`\``;

const QR = "/tmp/lark-mail-auth.png";
const TEXT = `扫这个码授权：\n\n${fence({
  items: [{ type: "image", path: QR, title: "飞书邮箱授权", desc: "10 分钟内有效" }],
})}`;

/** The first bytes of a png. */
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

async function setup(opts: {
  upload?: (data: Uint8Array) => Promise<string>;
  read?: (path: string) => Promise<Uint8Array>;
}) {
  const puts: { op: string; card: Card }[] = [];
  const uploads: Uint8Array[] = [];
  const errors: string[] = [];
  let now = 1_000;
  const api: FeishuApi = {
    connect: async () => {},
    close: async () => {},
    sendCard: async (_id, card) => {
      puts.push({ op: "send", card });
      return `om_${puts.length}`;
    },
    patchCard: async (_id, card) => {
      puts.push({ op: "patch", card });
    },
    pin: async () => {},
    downloadImage: async () => ({ data: new Uint8Array() }),
    downloadFile: async () => ({ data: new Uint8Array() }),
    ...(opts.upload === undefined
      ? {}
      : {
          uploadImage: async (data: Uint8Array) => {
            uploads.push(data);
            return (opts.upload as (d: Uint8Array) => Promise<string>)(data);
          },
        }),
  };
  const channel = new FeishuChannel({
    getSecret: async () => "s",
    saveSecret: async () => {},
    createApi: () => api,
    readImage: opts.read ?? (async () => PNG),
    onError: (e) => errors.push(e.message),
    now: () => now,
  });
  await channel.start(
    { channelId: "feishu", ownerId: "ou_owner", data: { appId: "cli_1" } },
    async () => {},
  );
  return { channel, puts, uploads, errors, later: (ms: number) => (now += ms) };
}

const imgOf = (card: Card) => bodyElements(card).find((e) => e.tag === "img");
const markdownOf = (card: Card) =>
  bodyElements(card)
    .filter((e) => e.tag === "markdown")
    .map((e) => e.content as string)
    .join("\n");

describe("pictures in Feishu cards (ADR 0075)", () => {
  it("uploads the picture and draws it whole, with its title and description under it", async () => {
    const { channel, puts, uploads } = await setup({ upload: async () => "img_v3_qr" });
    await channel.send({ kind: "text", text: TEXT });
    expect(uploads).toEqual([PNG]);
    const card = puts[0]?.card ?? {};
    expect(imgOf(card)).toEqual({
      tag: "img",
      img_key: "img_v3_qr",
      alt: { tag: "plain_text", content: "飞书邮箱授权" },
      scale_type: "fit_horizontal",
      corner_radius: "8px",
      preview: true,
    });
    expect(markdownOf(card)).toContain("扫这个码授权");
    expect(markdownOf(card)).toContain("10 分钟内有效");
    expect(markdownOf(card)).not.toContain(QR);
  });

  it("uploads the same picture once, also when the card is updated", async () => {
    const { channel, puts, uploads } = await setup({ upload: async () => "img_v3_qr" });
    const ref = await channel.send({ kind: "text", text: TEXT });
    await channel.update(ref, { kind: "text", text: `${TEXT}\n\n授权好了。` });
    expect(uploads).toHaveLength(1);
    expect(imgOf(puts[1]?.card ?? {})).toMatchObject({ img_key: "img_v3_qr" });
  });

  it("names the picture by its path when the upload fails, and waits before trying again", async () => {
    let fail = true;
    const { channel, puts, uploads, errors, later } = await setup({
      upload: async () => {
        if (fail) throw new Error("feishu upload image failed: 99991672 no permission");
        return "img_v3_qr";
      },
    });
    await channel.send({ kind: "text", text: TEXT });
    expect(imgOf(puts[0]?.card ?? {})).toBeUndefined();
    expect(markdownOf(puts[0]?.card ?? {})).toContain("🖼️ **飞书邮箱授权**");
    expect(markdownOf(puts[0]?.card ?? {})).toContain("/tmp/lark-mail-auth.png");
    expect(errors[0]).toContain(`picture ${QR} not shown in Feishu`);
    fail = false;
    await channel.send({ kind: "text", text: TEXT });
    expect(uploads).toHaveLength(1);
    later(IMAGE_RETRY_MS + 1);
    await channel.send({ kind: "text", text: TEXT });
    expect(uploads).toHaveLength(2);
    expect(imgOf(puts[2]?.card ?? {})).toMatchObject({ img_key: "img_v3_qr" });
  });

  it("names the picture by its path when the file cannot be read", async () => {
    const { channel, puts, uploads } = await setup({
      upload: async () => "img_v3_qr",
      read: async () => {
        throw new Error("ENOENT");
      },
    });
    await channel.send({ kind: "text", text: TEXT });
    expect(uploads).toHaveLength(0);
    expect(markdownOf(puts[0]?.card ?? {})).toContain("/tmp/lark-mail-auth.png");
  });

  it("names pictures by path when the api cannot upload, and in a report as well", async () => {
    const { channel, puts } = await setup({});
    await channel.send({ kind: "text", text: TEXT });
    expect(imgOf(puts[0]?.card ?? {})).toBeUndefined();
    const card = renderCard(
      {
        kind: "report",
        taskId: "t1",
        result: "done",
        title: "截图",
        body: TEXT,
        summarized: false,
        automaticDecisions: [],
      },
      "zh-CN",
      new Map([[QR, "img_v3_qr"]]),
    );
    expect(imgOf(card)).toMatchObject({ img_key: "img_v3_qr" });
  });
});

describe("Markdown pictures in Feishu cards (ADR 0075)", () => {
  const MD = "扫这个码授权：\n\n![飞书邮箱授权码](/tmp/lark-mail-auth.png)\n\n授权完回我一句。";

  it("uploads a Markdown picture and shows it inline with its key", async () => {
    const { channel, puts, uploads } = await setup({ upload: async () => "img_v3_md" });
    await channel.send({ kind: "text", text: MD });
    expect(uploads).toHaveLength(1);
    const md = markdownOf(puts[0]?.card ?? {});
    expect(md).toContain("![飞书邮箱授权码](img_v3_md)");
    expect(md).not.toContain("/tmp/lark-mail-auth.png");
  });

  it("names a picture it could not upload by its path, and a web picture becomes a link", async () => {
    const { channel, puts, errors } = await setup({
      upload: async () => {
        throw new Error("no permission");
      },
    });
    await channel.send({ kind: "text", text: `${MD}\n![图](https://e.com/a.png)` });
    const md = markdownOf(puts[0]?.card ?? {});
    expect(md).toContain("🖼️ 飞书邮箱授权码：/tmp/lark-mail-auth.png");
    expect(md).toContain("[🖼️ 图](https://e.com/a.png)");
    expect(md).not.toContain("![");
    expect(errors[0]).toContain("/tmp/lark-mail-auth.png");
  });

  it("uploads a picture written as Markdown inside a block's text, and reports' pictures", async () => {
    const { channel, puts } = await setup({ upload: async () => "img_v3_in" });
    const text = fence({ items: [{ type: "text", content: "![码](/tmp/code.png)" }] });
    await channel.send({ kind: "text", text });
    expect(markdownOf(puts[0]?.card ?? {})).toContain("![码](img_v3_in)");
    await channel.send({
      kind: "report",
      taskId: "t1",
      result: "done",
      title: "截图",
      body: "![窗口](/tmp/shot.png)",
      summarized: false,
      automaticDecisions: [],
    });
    expect(markdownOf(puts[1]?.card ?? {})).toContain("![窗口](img_v3_in)");
  });
});

describe("readPicture", () => {
  const dir = mkdtempSync(join(tmpdir(), "herd-pic-"));
  const png = join(dir, "qr.png");
  writeFileSync(png, PNG);

  it("reads a png by full path or from the home folder", async () => {
    expect(await readPicture(png)).toEqual(PNG);
    expect(await readPicture("~/qr.png", dir)).toEqual(PNG);
  });

  it("refuses anything that is not a picture", async () => {
    const script = join(dir, "run.sh");
    writeFileSync(script, "#!/bin/sh\n");
    const fake = join(dir, "fake.png");
    writeFileSync(fake, "#!/bin/sh\necho not a picture\n");
    const empty = join(dir, "empty.png");
    writeFileSync(empty, "");
    await expect(readPicture(script)).rejects.toThrow("not a png, jpg, gif or webp file");
    await expect(readPicture(fake)).rejects.toThrow("its bytes are not a picture");
    await expect(readPicture(empty)).rejects.toThrow("is not between 1 byte and 10 MB");
    await expect(readPicture("qr.png")).rejects.toThrow("not a full path");
    await expect(readPicture(dir)).rejects.toThrow();
    await expect(readPicture(join(dir, "missing.png"))).rejects.toThrow();
  });

  it("knows a picture by its first bytes", () => {
    expect(pictureType(PNG)).toBe("image/png");
    expect(pictureType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(pictureType(new TextEncoder().encode("hello"))).toBeUndefined();
  });
});
