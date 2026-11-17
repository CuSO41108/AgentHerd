import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeChannel } from "@agentherd/channel-fake";
import { modelLoginAccount, type SecretStore } from "@agentherd/core";
import { LOGIN_FIELD, PI_MODEL_ENV } from "@agentherd/herder";
import { afterEach, describe, expect, it } from "vitest";
import type { HostEvent, LoginView } from "../src/api.ts";
import { Host } from "../src/host.ts";
import { LoginRun } from "../src/model-logins.ts";

function memorySecrets(): SecretStore & { saved: Record<string, string> } {
  const saved: Record<string, string> = {};
  return {
    saved,
    get: (a) => saved[a],
    set: (a, v) => {
      saved[a] = v;
    },
    delete: (a) => {
      delete saved[a];
    },
  };
}

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

function makeHost() {
  const home = mkdtempSync(join(tmpdir(), "ah-"));
  const secrets = memorySecrets();
  const events: HostEvent[] = [];
  const host = new Host({
    home,
    userHome: home,
    secrets,
    env: {},
    mcpSocket: join(home, "mcp.sock"),
    profiles: () => [{ id: "pi", name: "Pi", command: ["pi"], env: {}, exporter: null }],
    createChannel: () => new FakeChannel(),
  });
  host.onEvent((e) => events.push(e));
  cleanups.push(() => host.stop());
  return { host, secrets, events };
}

/** A signed-in ChatGPT account whose token is good for an hour (no network needed). */
function signIn(secrets: SecretStore, serviceId: string): void {
  secrets.set(
    modelLoginAccount(serviceId),
    JSON.stringify({
      type: "oauth",
      access: "short-token",
      refresh: "long-token",
      expires: Date.now() + 3_600_000,
    }),
  );
}

async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 5));
  expect(check()).toBe(true);
}

describe("LoginRun (ADR 0068)", () => {
  it("shows the link and the question, takes the answer and saves the service", async () => {
    const views: LoginView[] = [];
    let saved: string[] | undefined;
    const run = new LoginRun({
      serviceId: "chatgpt",
      provider: "openai-codex",
      run: async (i) => {
        i.notify({ type: "auth_url", url: "https://auth.example/login", instructions: "登录" });
        const code = await i.prompt({ type: "manual_code", message: "Paste the code" });
        expect(code).toBe("abc");
        return { models: ["gpt-6-astra"] };
      },
      done: async (models) => {
        saved = models;
      },
      changed: (v) => views.push(v),
    });
    run.start();
    await until(() => run.view().prompt !== undefined);
    expect(run.view()).toMatchObject({
      status: "running",
      url: "https://auth.example/login",
      prompt: { type: "manual_code", message: "Paste the code" },
    });
    run.answer("abc");
    await until(() => run.view().status === "done");
    expect(saved).toEqual(["gpt-6-astra"]);
    expect(run.view().prompt).toBeUndefined();
    expect(run.view().models).toEqual(["gpt-6-astra"]);
    expect(views.length).toBeGreaterThan(2);
  });

  it("shows a device code, and cancelling ends the flow without an error", async () => {
    const run = new LoginRun({
      serviceId: "copilot",
      provider: "github-copilot",
      run: (i) =>
        new Promise((_resolve, reject) => {
          i.notify({ type: "device_code", userCode: "AB-12", verificationUri: "https://gh/dev" });
          i.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
      done: async () => {},
      changed: () => {},
    });
    run.start();
    await until(() => run.view().userCode !== undefined);
    expect(run.view()).toMatchObject({ userCode: "AB-12", url: "https://gh/dev" });
    run.cancel();
    await new Promise((r) => setTimeout(r, 10));
    expect(run.view().status).toBe("cancelled");
    expect(run.view().error).toBeUndefined();
    expect(() => run.answer("x")).toThrow(/not waiting/);
  });

  it("reports a failed sign-in", async () => {
    const run = new LoginRun({
      serviceId: "x",
      provider: "openai-codex",
      run: async () => {
        throw new Error("state mismatch");
      },
      done: async () => {},
      changed: () => {},
    });
    run.start();
    await until(() => run.view().status === "failed");
    expect(run.view().error).toBe("state mismatch");
  });
});

describe("Host subscriptions (ADR 0068)", () => {
  it("lists the vendors pi-ai can sign in to", () => {
    const { host } = makeHost();
    const ids = host.subscriptions().map((s) => s.provider);
    expect(ids).toEqual(expect.arrayContaining(["openai-codex", "anthropic", "github-copilot"]));
    const chatgpt = host.subscriptions().find((s) => s.provider === "openai-codex");
    expect(chatgpt?.subscription).toBe(true);
    expect(chatgpt?.models.length).toBeGreaterThan(0);
  });

  it("counts a signed-in service as ready and forgets the sign-in with the service", async () => {
    const { host, secrets } = makeHost();
    await host.putService({
      id: "chatgpt",
      name: "ChatGPT",
      kind: "builtin",
      provider: "openai-codex",
      auth: "subscription",
      models: ["gpt-6-astra"],
    });
    expect(host.models().services[0]).toMatchObject({ auth: "subscription", hasKey: false });
    expect((await host.testModel({ serviceId: "chatgpt", model: "gpt-6-astra" })).ok).toBe(false);
    signIn(secrets, "chatgpt");
    expect(host.models().services[0]?.hasKey).toBe(true);
    await host.removeService("chatgpt");
    expect(secrets.saved[modelLoginAccount("chatgpt")]).toBeUndefined();
  });

  it("gives Pi a socket token that only fetches the token of its own service", async () => {
    const { host, secrets } = makeHost();
    await host.putService({
      id: "chatgpt",
      name: "ChatGPT",
      kind: "builtin",
      provider: "openai-codex",
      auth: "subscription",
      models: ["gpt-6-astra"],
    });
    signIn(secrets, "chatgpt");
    const grant = (
      host as unknown as { withModelGrant(env: Record<string, string>): Record<string, string> }
    ).withModelGrant({
      [PI_MODEL_ENV]: JSON.stringify({ id: "gpt-6-astra", [LOGIN_FIELD]: "chatgpt" }),
    });
    const token = grant.AGENTHERD_PI_AUTH_TOKEN ?? "";
    expect(token).toMatch(/^[0-9a-f]{48}$/);
    expect(grant.AGENTHERD_PI_AUTH_SOCKET).toMatch(/mcp\.sock$/);
    // The refresh token never leaves the host.
    expect(JSON.stringify(grant)).not.toContain("long-token");

    expect(
      await host.mcp(token, { jsonrpc: "2.0", method: "notifications/hello" }),
    ).toBeUndefined();
    const ok = await host.mcp(token, {
      jsonrpc: "2.0",
      id: 1,
      method: "agentherd/modelAuth",
      params: { service: "chatgpt" },
    });
    expect(ok).toMatchObject({ id: 1, result: { apiKey: "short-token" } });
    const other = await host.mcp(token, {
      jsonrpc: "2.0",
      id: 2,
      method: "agentherd/modelAuth",
      params: { service: "anthropic" },
    });
    expect(other).toMatchObject({ id: 2, error: { message: "not allowed" } });
    const tool = await host.mcp(token, { jsonrpc: "2.0", id: 3, method: "tools/list" });
    expect(tool).toMatchObject({ error: { message: "not allowed" } });
  });

  it("does not give a key model a grant", () => {
    const { host } = makeHost();
    const env = { [PI_MODEL_ENV]: JSON.stringify({ id: "deepseek-flash" }) };
    const out = (
      host as unknown as { withModelGrant(env: Record<string, string>): Record<string, string> }
    ).withModelGrant(env);
    expect(out).toEqual(env);
  });

  it("refuses to sign in over a key service with the same id", async () => {
    const { host } = makeHost();
    await host.putService(
      {
        id: "ds",
        name: "DeepSeek",
        kind: "builtin",
        provider: "deepseek",
        models: ["deepseek-flash"],
      },
      "sk-1",
    );
    expect(() => host.startLogin("openai-codex", "ds")).toThrow(/already exists/);
    expect(() => host.startLogin("nope", "x")).toThrow(/cannot sign in/);
  });
});
