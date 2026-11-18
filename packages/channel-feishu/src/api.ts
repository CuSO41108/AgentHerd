// The small part of the Feishu Open Platform that the channel uses. `FeishuApi` is the seam
// for tests: the contract tests pass a recording stub, production uses `sdkApi`.

import * as lark from "@larksuiteoapi/node-sdk";

export type Brand = "feishu" | "lark";

export interface FeishuCredentials {
  appId: string;
  appSecret: string;
  brand: Brand;
}

export interface FeishuHandlers {
  onMessage(payload: unknown): Promise<void>;
  /** The return value is sent back to Feishu as the callback response. */
  onCardAction(payload: unknown): Promise<Record<string, unknown>>;
}

export interface FeishuApi {
  connect(handlers: FeishuHandlers): Promise<void>;
  close(): Promise<void>;
  /** Sends an interactive card to a user; returns the message id. */
  sendCard(openId: string, card: Record<string, unknown>): Promise<string>;
  /** Sends the card as a reply to a message; returns the new message's id. */
  replyCard?(messageId: string, card: Record<string, unknown>): Promise<string>;
  patchCard(messageId: string, card: Record<string, unknown>): Promise<void>;
  pin(messageId: string): Promise<void>;
  /** Downloads an image of a received message (`im:message` covers it). */
  downloadImage(messageId: string, imageKey: string): Promise<DownloadedFile>;
  /** A file, audio or video message's resource. */
  downloadFile(messageId: string, fileKey: string): Promise<DownloadedFile>;
  /**
   * Uploads a picture for messages and returns its image key (`im/v1/images`, ADR 0075). Needs
   * the app's `im:resource` permission; without it Feishu refuses and the picture is shown by
   * its path.
   */
  uploadImage?(data: Uint8Array): Promise<string>;
}

export interface DownloadedFile {
  data: Uint8Array;
  /** From the response, when Feishu sends one. */
  contentType?: string;
}

export function openApiBase(brand: Brand): string {
  return brand === "lark" ? "https://open.larksuite.com" : "https://open.feishu.cn";
}

interface ApiResult {
  code?: number | undefined;
  msg?: string | undefined;
}

/** Feishu answered a call with an error code. */
export class FeishuApiError extends Error {
  readonly code: number;

  constructor(op: string, code: number, msg?: string) {
    super(`feishu ${op} failed: ${code} ${msg ?? ""}`.trim());
    this.name = "FeishuApiError";
    this.code = code;
  }
}

function check(op: string, res: ApiResult): void {
  if (res.code !== undefined && res.code !== 0) throw new FeishuApiError(op, res.code, res.msg);
}

/**
 * The SDK throws its HTTP client's error when Feishu answers 4xx or 5xx (a refused card is a
 * 400); Feishu's own code is in the response body. Turns such an error into a
 * `FeishuApiError`; any other error (network, …) comes back as it is.
 */
export function feishuError(op: string, error: unknown): unknown {
  const body = field(field(error, "response"), "data");
  const code = field(body, "code");
  if (typeof code !== "number" || code === 0) return error;
  const msg = field(body, "msg");
  return new FeishuApiError(op, code, typeof msg === "string" ? msg : undefined);
}

function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

/**
 * Codes with which send, reply and patch refuse what is in a card: 230001 invalid parameter,
 * 230025 message too long, 230099 failed to create card content (a component Feishu does not
 * take, too many components, …). The other codes (recalled, no permission, rate limit, …)
 * would refuse any card, so drawing it differently cannot help.
 */
const CARD_REFUSED = new Set([230001, 230025, 230099]);

/** True when Feishu refused a card for what is in it. */
export function cardRefused(error: unknown): boolean {
  return error instanceof FeishuApiError && CARD_REFUSED.has(error.code);
}

/** Runs one SDK call, with Feishu's error code kept when it answers 4xx or 5xx. */
async function call<T>(op: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw feishuError(op, error);
  }
}

/** Production implementation on top of `@larksuiteoapi/node-sdk`. */
export function sdkApi(creds: FeishuCredentials): FeishuApi {
  const base = {
    appId: creds.appId,
    appSecret: creds.appSecret,
    domain: creds.brand === "lark" ? lark.Domain.Lark : lark.Domain.Feishu,
  };
  const client = new lark.Client(base);
  let ws: lark.WSClient | null = null;

  return {
    async connect(handlers) {
      const dispatcher = new lark.EventDispatcher({}).register({
        "im.message.receive_v1": async (data: unknown) => {
          await handlers.onMessage(data);
        },
        "card.action.trigger": async (data: unknown) => handlers.onCardAction(data),
      } as never);
      ws = new lark.WSClient({ ...base, loggerLevel: lark.LoggerLevel.warn });
      await ws.start({ eventDispatcher: dispatcher });
    },
    async close() {
      ws?.close();
      ws = null;
    },
    async sendCard(openId, card) {
      const res = await call("send", () =>
        client.im.v1.message.create({
          params: { receive_id_type: "open_id" },
          data: { receive_id: openId, msg_type: "interactive", content: JSON.stringify(card) },
        }),
      );
      check("send", res);
      const id = res.data?.message_id;
      if (id === undefined) throw new Error("feishu send returned no message_id");
      return id;
    },
    async replyCard(messageId, card) {
      const res = await call("reply", () =>
        client.im.v1.message.reply({
          path: { message_id: messageId },
          data: { msg_type: "interactive", content: JSON.stringify(card) },
        }),
      );
      check("reply", res);
      const id = res.data?.message_id;
      if (id === undefined) throw new Error("feishu reply returned no message_id");
      return id;
    },
    async patchCard(messageId, card) {
      const res = await call("patch", () =>
        client.im.v1.message.patch({
          path: { message_id: messageId },
          data: { content: JSON.stringify(card) },
        }),
      );
      check("patch", res);
    },
    async pin(messageId) {
      const res = await client.im.v1.pin.create({ data: { message_id: messageId } });
      check("pin", res);
    },
    async uploadImage(data) {
      const res = await call("upload image", () =>
        client.im.v1.image.create({ data: { image_type: "message", image: Buffer.from(data) } }),
      );
      const key = res?.image_key;
      if (key === undefined || key === "")
        throw new Error("feishu upload image returned no image_key");
      return key;
    },
    downloadImage: (messageId, imageKey) => download(messageId, imageKey, "image"),
    downloadFile: (messageId, fileKey) => download(messageId, fileKey, "file"),
  };

  async function download(
    messageId: string,
    key: string,
    type: "image" | "file",
  ): Promise<DownloadedFile> {
    const res = await client.im.v1.messageResource.get({
      params: { type },
      path: { message_id: messageId, file_key: key },
    });
    const chunks: Buffer[] = [];
    for await (const chunk of res.getReadableStream()) chunks.push(Buffer.from(chunk));
    const contentType = (res.headers as Record<string, unknown> | undefined)?.["content-type"];
    return {
      data: new Uint8Array(Buffer.concat(chunks)),
      ...(typeof contentType === "string" ? { contentType } : {}),
    };
  }
}

/** Checks App ID and Secret by asking for a tenant access token. */
export async function verifyCredentials(creds: FeishuCredentials): Promise<void> {
  const res = await fetch(
    `${openApiBase(creds.brand)}/open-apis/auth/v3/tenant_access_token/internal`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ app_id: creds.appId, app_secret: creds.appSecret }),
    },
  );
  const body = (await res.json()) as ApiResult;
  if (body.code !== 0)
    throw new Error(`feishu credentials rejected: ${body.code} ${body.msg ?? ""}`.trim());
}
