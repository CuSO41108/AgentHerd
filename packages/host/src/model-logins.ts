// Signing in to a model subscription from the app (ADR 0068). pi-ai runs the vendor's flow; this
// file turns its callbacks into a view the 模型 page shows (a link to open, a device code, a
// question) and the owner's answers back into the flow. One sign-in runs at a time.

import { randomBytes } from "node:crypto";
import type { ModelLogins } from "@agentherd/herder";
import type { LoginPrompt, LoginView } from "./api.ts";

type Interaction = Parameters<ModelLogins["login"]>[2];
type Prompt = Parameters<Interaction["prompt"]>[0];
type Notice = Parameters<Interaction["notify"]>[0];

export interface LoginRunOptions {
  /** The service id the credential is saved under. */
  serviceId: string;
  provider: string;
  /** Runs the vendor's flow and resolves with the account's models. */
  run: (interaction: Interaction) => Promise<{ models: string[] }>;
  /** Saves the service once the account is signed in. */
  done: (models: string[]) => Promise<void>;
  changed: (view: LoginView) => void;
}

interface Pending {
  resolve: (value: string) => void;
  reject: (error: Error) => void;
}

/** One running sign-in. */
export class LoginRun {
  readonly id = randomBytes(8).toString("hex");
  private readonly abort = new AbortController();
  private pending: Pending | undefined;
  private state: LoginView;
  private readonly opts: LoginRunOptions;

  constructor(opts: LoginRunOptions) {
    this.opts = opts;
    this.state = {
      id: this.id,
      provider: opts.provider,
      serviceId: opts.serviceId,
      status: "running",
    };
  }

  view(): LoginView {
    return this.state;
  }

  start(): void {
    const interaction: Interaction = {
      signal: this.abort.signal,
      prompt: (p) => this.ask(p),
      notify: (e) => this.notice(e),
    };
    void (async () => {
      try {
        const { models } = await this.opts.run(interaction);
        await this.opts.done(models);
        this.set({ status: "done", models, prompt: undefined });
      } catch (error) {
        if (this.state.status === "cancelled") return;
        this.set({ status: "failed", error: (error as Error).message, prompt: undefined });
      }
    })();
  }

  answer(value: string): void {
    const pending = this.pending;
    if (pending === undefined) throw new Error("the sign-in is not waiting for an answer");
    this.pending = undefined;
    this.set({ prompt: undefined });
    pending.resolve(value);
  }

  cancel(): void {
    if (this.state.status !== "running") return;
    this.set({ status: "cancelled", prompt: undefined });
    this.pending?.reject(new Error("cancelled"));
    this.pending = undefined;
    this.abort.abort();
  }

  private ask(p: Prompt): Promise<string> {
    const prompt: LoginPrompt = {
      type: p.type,
      message: p.message,
      ...("placeholder" in p && p.placeholder !== undefined ? { placeholder: p.placeholder } : {}),
      ...(p.type === "select"
        ? {
            options: p.options.map((o) => ({
              id: o.id,
              label: o.label,
              ...(o.description === undefined ? {} : { description: o.description }),
            })),
          }
        : {}),
    };
    return new Promise<string>((resolve, reject) => {
      this.pending?.reject(new Error("replaced by a new question"));
      this.pending = { resolve, reject };
      // A flow may drop its question itself, e.g. when the browser callback arrives first.
      p.signal?.addEventListener("abort", () => {
        if (this.pending?.resolve !== resolve) return;
        this.pending = undefined;
        this.set({ prompt: undefined });
        reject(new Error("question withdrawn"));
      });
      this.set({ prompt });
    });
  }

  private notice(e: Notice): void {
    switch (e.type) {
      case "auth_url":
        this.set({
          url: e.url,
          ...(e.instructions === undefined ? {} : { instructions: e.instructions }),
        });
        return;
      case "device_code":
        this.set({ userCode: e.userCode, url: e.verificationUri });
        return;
      case "progress":
        this.set({ progress: e.message });
        return;
      case "info":
        this.set({ progress: e.message, ...(e.links?.[0] ? { url: e.links[0].url } : {}) });
        return;
    }
  }

  private set(patch: Partial<LoginView>): void {
    const next: LoginView = { ...this.state };
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) delete (next as unknown as Record<string, unknown>)[k];
      else (next as unknown as Record<string, unknown>)[k] = v;
    }
    this.state = next;
    this.opts.changed(next);
  }
}
