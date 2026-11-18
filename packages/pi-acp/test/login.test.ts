import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import login, { AUTH_METHOD, loginModelFromEnv, requestAuth } from "../extension/login.ts";
import model from "../extension/model.ts";
import { LOGIN_PATH, MODEL_PATH, piArgsFor } from "../src/bridge.ts";

const closers: (() => void)[] = [];
afterEach(() => {
  for (const c of closers.splice(0)) c();
});

const loginModel = JSON.stringify({
  id: "gpt-6-astra",
  api: "openai-codex-responses",
  baseUrl: "https://chatgpt.com/backend-api",
  agentherdLogin: "chatgpt",
});

/** A host stand-in: checks the token line, then answers one modelAuth call. */
function fakeHost(answer: (params: unknown) => object): Promise<string> {
  const path =
    process.platform === "win32"
      ? `\\\\.\\pipe\\ah-login-${randomBytes(8).toString("hex")}`
      : join(mkdtempSync(join(tmpdir(), "ah-")), "s.sock");
  const server = createServer((socket) => {
    let rest = "";
    let token: string | undefined;
    socket.on("data", (chunk) => {
      rest += chunk.toString();
      for (let nl = rest.indexOf("\n"); nl >= 0; nl = rest.indexOf("\n")) {
        const msg = JSON.parse(rest.slice(0, nl));
        rest = rest.slice(nl + 1);
        if (token === undefined) {
          token = msg.token;
          continue;
        }
        const body =
          token === "good" && msg.method === AUTH_METHOD
            ? { result: answer(msg.params) }
            : { error: { code: -32000, message: "unknown task token" } };
        socket.write(`${JSON.stringify({ jsonrpc: "2.0", id: msg.id, ...body })}\n`);
      }
    });
  });
  closers.push(() => server.close());
  return new Promise((resolve) => server.listen(path, () => resolve(path)));
}

describe("Pi login extension (ADR 0068)", () => {
  it("loads login.ts instead of model.ts for a subscription model", () => {
    const args = piArgsFor([], { AGENTHERD_PI_MODEL: loginModel });
    expect(args).toContain(LOGIN_PATH);
    expect(args).not.toContain(MODEL_PATH);
    const keyArgs = piArgsFor([], {
      AGENTHERD_PI_MODEL: JSON.stringify({ id: "m", api: "openai-completions", baseUrl: "x" }),
    });
    expect(keyArgs).toContain(MODEL_PATH);
  });

  it("reads only models that name a sign-in", () => {
    expect(loginModelFromEnv({ AGENTHERD_PI_MODEL: loginModel })?.agentherdLogin).toBe("chatgpt");
    expect(
      loginModelFromEnv({
        AGENTHERD_PI_MODEL: JSON.stringify({ id: "m", api: "a", baseUrl: "b" }),
      }),
    ).toBeUndefined();
  });

  it("registers no key provider through model.ts for a subscription model", () => {
    const saved = process.env.AGENTHERD_PI_MODEL;
    process.env.AGENTHERD_PI_MODEL = loginModel;
    const registered: string[] = [];
    try {
      model({ registerProvider: (name) => registered.push(`model:${name}`) });
      login({ registerProvider: (name, config) => registered.push(`login:${name}:${config.api}`) });
    } finally {
      if (saved === undefined) delete process.env.AGENTHERD_PI_MODEL;
      else process.env.AGENTHERD_PI_MODEL = saved;
    }
    expect(registered).toEqual(["login:agentherd:agentherd-login"]);
  });

  it("asks the host for a token per request with its socket token", async () => {
    const seen: unknown[] = [];
    const path = await fakeHost((params) => {
      seen.push(params);
      return { apiKey: "short-token" };
    });
    expect(await requestAuth(path, "good", "chatgpt")).toEqual({ apiKey: "short-token" });
    expect(seen).toEqual([{ service: "chatgpt" }]);
    await expect(requestAuth(path, "bad", "chatgpt")).rejects.toThrow(/unknown task token/);
  });
});
