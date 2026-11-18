// A Pi extension for a model the owner reaches through a subscription (docs/adr/0068). Like
// model.ts it registers the owner's model, but Pi gets no key: before every request it asks the
// AgentHerd host for a short-lived token over the local socket, then sends the request with
// pi-ai. The refresh token never reaches Pi. Loaded instead of model.ts when the model names a
// sign-in (bridge.ts). Imports only Node built-ins and pi-ai, which Pi provides to extensions.

import { createConnection } from "node:net";
import * as piAi from "@earendil-works/pi-ai";
import type { streamSimple as StreamSimple } from "@earendil-works/pi-ai/compat";
import { LOGIN_FIELD } from "./model.ts";

export const LOGIN_PROVIDER = "agentherd";
export const LOGIN_API = "agentherd-login";
export const AUTH_SOCKET_ENV = "AGENTHERD_PI_AUTH_SOCKET";
export const AUTH_TOKEN_ENV = "AGENTHERD_PI_AUTH_TOKEN";
export const AUTH_METHOD = "agentherd/modelAuth";
const MODEL_ENV = "AGENTHERD_PI_MODEL";
const AUTH_TIMEOUT_MS = 60_000;

interface LoginModel {
  id: string;
  name: string;
  api: string;
  provider: string;
  baseUrl: string;
  [LOGIN_FIELD]: string;
  [field: string]: unknown;
}

interface ModelAuth {
  apiKey?: string;
  headers?: Record<string, string>;
  baseUrl?: string;
}

export interface LoginApi {
  registerProvider(name: string, config: Record<string, unknown>): void;
}

/** The subscription model from the environment, or `undefined` when there is none. */
export function loginModelFromEnv(env: NodeJS.ProcessEnv): LoginModel | undefined {
  const raw = env[MODEL_ENV];
  if (raw === undefined || raw === "") return undefined;
  try {
    const m = JSON.parse(raw) as Partial<LoginModel>;
    if (
      typeof m.id !== "string" ||
      typeof m.api !== "string" ||
      typeof m.baseUrl !== "string" ||
      typeof m[LOGIN_FIELD] !== "string"
    ) {
      return undefined;
    }
    return {
      ...m,
      name: typeof m.name === "string" ? m.name : m.id,
      provider: typeof m.provider === "string" ? m.provider : LOGIN_PROVIDER,
    } as LoginModel;
  } catch {
    return undefined;
  }
}

/** Asks the host for a token: `{"token"}` line, then one JSON-RPC request (as mcp.ts does). */
export function requestAuth(
  socketPath: string,
  token: string,
  service: string,
  timeoutMs = AUTH_TIMEOUT_MS,
): Promise<ModelAuth> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath);
    let settled = false;
    let rest = "";
    const timer = setTimeout(() => finish(new Error("AgentHerd did not answer")), timeoutMs);
    const finish = (err?: Error, value?: ModelAuth) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (err !== undefined) reject(err);
      else resolve(value ?? {});
    };
    socket.on("connect", () => {
      const call = { jsonrpc: "2.0", id: 1, method: AUTH_METHOD, params: { service } };
      socket.write(`${JSON.stringify({ token })}\n${JSON.stringify(call)}\n`);
    });
    socket.on("data", (chunk: Buffer) => {
      rest += chunk.toString("utf8");
      let nl = rest.indexOf("\n");
      while (nl >= 0) {
        const line = rest.slice(0, nl).trim();
        rest = rest.slice(nl + 1);
        nl = rest.indexOf("\n");
        if (line === "") continue;
        try {
          const msg = JSON.parse(line) as {
            id?: unknown;
            result?: ModelAuth;
            error?: { message?: string };
          };
          if (msg.error !== undefined) finish(new Error(msg.error.message || "sign-in failed"));
          else if (msg.id === 1) finish(undefined, msg.result);
        } catch {
          finish(new Error("AgentHerd sent invalid JSON"));
        }
      }
    });
    socket.on("error", (err) => finish(err));
    socket.on("close", () => finish(new Error("AgentHerd closed the socket before answering")));
  });
}

// Pi's copy of pi-ai exports streamSimple from its main entry (checked with Pi 1.5.0); the
// published 1.5.0 types keep it under /compat.
const { createAssistantMessageEventStream } = piAi;
const streamSimple = (piAi as unknown as { streamSimple: typeof StreamSimple }).streamSimple;
type Stream = ReturnType<typeof StreamSimple>;
type StreamOptions = Parameters<typeof StreamSimple>[2];

function failed(model: LoginModel, message: string): Stream {
  const stream = createAssistantMessageEventStream();
  const zero = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
  stream.push({
    type: "error",
    reason: "error",
    error: {
      role: "assistant",
      content: [],
      api: model.api,
      provider: model.provider,
      model: model.id,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: zero },
      stopReason: "error",
      errorMessage: message,
      timestamp: Date.now(),
    },
  } as never);
  return stream;
}

/** Forwards every event of `from` into `to`. */
async function pipe(from: Stream, to: Stream): Promise<void> {
  for await (const event of from) to.push(event);
  to.end();
}

export default function login(pi: LoginApi): void {
  const m = loginModelFromEnv(process.env);
  if (m === undefined) return;
  const socketPath = process.env[AUTH_SOCKET_ENV] ?? "";
  const token = process.env[AUTH_TOKEN_ENV] ?? "";
  const { provider: _provider, ...config } = m;
  pi.registerProvider(LOGIN_PROVIDER, {
    name: "AgentHerd",
    baseUrl: m.baseUrl,
    api: LOGIN_API,
    // Pi wants a key for a provider with models; the real token comes per request below.
    apiKey: "subscription",
    models: [{ ...config, api: LOGIN_API }],
    streamSimple: (_model: unknown, context: unknown, options?: StreamOptions): Stream => {
      const out = createAssistantMessageEventStream();
      void (async () => {
        let auth: ModelAuth;
        try {
          if (socketPath === "" || token === "") throw new Error("no AgentHerd socket");
          auth = await requestAuth(socketPath, token, m[LOGIN_FIELD]);
        } catch (error) {
          await pipe(failed(m, `sign-in failed: ${(error as Error).message}`), out);
          return;
        }
        const headers = { ...(options?.headers ?? {}), ...(auth.headers ?? {}) };
        const bearer = /^Bearer\s+(.+)$/i.exec(headers.Authorization ?? "")?.[1];
        const real = { ...m, ...(auth.baseUrl === undefined ? {} : { baseUrl: auth.baseUrl }) };
        try {
          const stream = streamSimple(real as never, context as never, {
            ...options,
            apiKey: auth.apiKey ?? bearer ?? "none",
            ...(Object.keys(headers).length === 0 ? {} : { headers }),
          });
          await pipe(stream, out);
        } catch (error) {
          await pipe(failed(m, (error as Error).message), out);
        }
      })();
      return out;
    },
  });
}
