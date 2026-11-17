// The local API of the AgentHerd host (docs/spec/02-architecture.md §4). The desktop app and the
// CLI use it; agents do not. Items are decided in the channel, or through the desktop pet, which
// passes the owner's press on as if made in the channel (ADR 0070).
// These types have no runtime imports, so the renderer can import them too.

import type {
  CustomApi,
  MemoryRow,
  ModelRef,
  ModelRole,
  ModelService,
  ModelSettings,
  Schedule,
  Task,
  TranscriptEntry,
} from "@agentherd/core";
import type { Locale, Mode, ReportResult, Risk } from "@agentherd/protocol";

export const API_VERSION = 1;

export interface ChannelStatus {
  bound: boolean;
  appId?: string;
  /** Connected to the chat app and following tasks. */
  connected: boolean;
  error?: string;
}

export interface HerderStatus {
  on: boolean;
  /** "service/model" when on. */
  ref?: string;
  /** Why it is off. */
  reason?: string;
}

export interface HostStatus {
  version: string;
  home: string;
  channel: ChannelStatus;
  herder: HerderStatus;
  mode: Mode;
  locale: Locale;
  keepAwake: boolean;
  /** The owner's Obsidian vault folder, if set (ADR 0059). */
  obsidianVault?: string;
  /** Agent profile ids the owner can start with /run. */
  profiles: string[];
  /** The desktop pet (ADR 0070). */
  pet: PetSettings;
}

/**
 * Where an agent's CLI comes from: inside the app (ADR 0067), a download on this computer (Claude
 * Code on request, ADR 0069, or an older app's copy), a CLI the owner installed, or a profile in
 * config.json.
 */
export type AgentSource = "bundled" | "managed" | "system" | "config";

export interface AgentView {
  id: string;
  name: string;
  /** ready: can run tasks. missing: not in this app and not installed on the computer. */
  state: "ready" | "missing" | "installing";
  source?: AgentSource;
  path?: string;
  /** Version of the copy in use, when it ships with the app or an older app downloaded it. */
  version?: string;
  /** The version AgentHerd is adapted to and ships (ADR 0067). */
  adapted?: string;
  /** Not in the app; the owner can download it (ADR 0069). */
  onRequest?: boolean;
  /** The owner's own CLI the adapter runs (Claude Code's `claude`). */
  ownCli?: string;
  /** Bytes, while downloading. */
  progress?: { received: number; total: number };
  /** Last download error. */
  error?: string;
  /** The app can download it now (only when missing and not in the app; never an update). */
  canInstall: boolean;
  /** A download the owner can remove. */
  canRemove: boolean;
  /** Model passed to it ("service/model"), when it uses one from the model list. */
  modelRef?: string;
}

/** Result of starting an agent once to check it works (the 验证 button). */
export interface AgentCheck {
  id: string;
  ok: boolean;
  /** It started but wants the owner to sign in first (ACP authMethods, or an auth error). */
  needsLogin: boolean;
  /** Name and version the agent reported. */
  agentName?: string;
  agentVersion?: string;
  /** Sign-in methods it offers. */
  authMethods: string[];
  /** Why it failed, from the error and the last stderr lines. */
  error?: string;
  ms: number;
}

export interface ItemSummary {
  id: string;
  sessionId: string;
  title: string;
  body: string;
  risk: Risk;
  createdAt: string;
  cwd: string;
  profileId: string;
  taskTitle?: string;
}

export interface TasksView {
  tasks: Task[];
  /** Open items, waiting for the owner in the channel. */
  items: ItemSummary[];
}

/** What was said in one task; the app polls it while the task is open. */
export interface TranscriptView {
  entries: TranscriptEntry[];
  /** Reply text the agent is still writing. */
  live: string;
}

/** One tool call the Herder made in a turn (主管 › 行动记录). */
export interface HerderActivityStep {
  tool: string;
  args: Record<string, unknown>;
  /** The tool's answer as the Herder saw it, cut when long. */
  result: string;
  error: boolean;
  ms?: number;
}

/** One Herder turn, read back from its saved conversation. */
export interface HerderActivityTurn {
  at: string;
  /** What started it. notice: only task reports or other news (turns from before 2026-11). */
  trigger: "owner" | "answer" | "task" | "scheduled" | "intake" | "notice" | "other";
  /** The owner's words, their answer, the task's name, the schedule's name, the GitHub item. */
  text: string;
  /** The question an answer answered. */
  question?: string;
  /** News that came along with the turn, one entry each. */
  events: string[];
  /** It came before AgentHerd restarted. */
  resumed: boolean;
  steps: HerderActivityStep[];
  /** What the Herder said last; "" when it said nothing. */
  reply: string;
  /** It chose to say nothing. */
  quiet: boolean;
  model?: string;
}

/** Something that happened to the Herder outside its conversation: an error, a retry, a guard hit. */
export interface HerderIncident {
  at: string;
  /** The audit kind, e.g. "herder.error". */
  kind: string;
  data: Record<string, unknown>;
}

/** 主管 › 行动记录: the Herder's turns and incidents, newest first. */
export interface HerderActivityView {
  turns: HerderActivityTurn[];
  incidents: HerderIncident[];
  /** Turns there are in all; `turns` holds the newest of them. */
  total: number;
}

/** The Herder's long-term memory for the 记忆 page (ADR 0038). */
export interface MemoryView {
  /** Active entries, newest first, and the last deleted ones (to restore). */
  entries: MemoryRow[];
  deleted: MemoryRow[];
  /** Characters used and allowed of the kinds kept in the Herder's prompt. */
  used: { owner: number; decision: number; note: number };
  caps: { owner: number; decision: number; note: number };
  /** False while AgentHerd is not following tasks (no herd): nothing to show or change. */
  ready: boolean;
}

export interface ServiceView extends ModelService {
  /** A key is saved, or the subscription is signed in (ADR 0068). */
  hasKey: boolean;
}

/** A vendor the owner can sign in to with an account instead of a key (ADR 0068). */
export interface SubscriptionView {
  provider: string;
  name: string;
  /** Backed by a paid plan (ChatGPT Plus, Claude Max…) rather than a free account. */
  subscription: boolean;
  models: { id: string; name: string }[];
}

export interface LoginPrompt {
  type: "text" | "secret" | "select" | "manual_code";
  message: string;
  placeholder?: string;
  options?: { id: string; label: string; description?: string }[];
}

/** A running or finished sign-in; progress comes as "login" events. */
export interface LoginView {
  id: string;
  provider: string;
  serviceId: string;
  status: "running" | "done" | "failed" | "cancelled";
  /** A page to open: the vendor's sign-in page or where to type `userCode`. */
  url?: string;
  instructions?: string;
  /** Device-code flows: the code to type on `url`. */
  userCode?: string;
  progress?: string;
  /** A question the flow waits on; answer with `answerLogin`. */
  prompt?: LoginPrompt;
  models?: string[];
  error?: string;
}

export interface ModelsView {
  services: ServiceView[];
  roles: ModelSettings["roles"];
}

export interface ProviderView {
  provider: string;
  models: { id: string; name: string }[];
}

export type SetupPhase =
  | "idle"
  | "starting"
  | "waiting-scan"
  | "waiting-confirm"
  | "verifying"
  | "connected"
  | "failed";

export interface SetupState {
  phase: SetupPhase;
  /** The QR code as a data: URL, while waiting for the scan. */
  qrDataUrl?: string;
  url?: string;
  expiresAt?: string;
  error?: string;
}

export type ModelTest = { ok: true; reply: string } | { ok: false; message: string };

/** What to ask for a model list: a saved service, or the fields of one not saved yet. */
export interface ProbeTarget {
  /** A saved service: its address, API and key are the defaults for the fields below. */
  serviceId?: string;
  baseUrl?: string;
  api?: CustomApi;
  /** Empty or missing: the saved key of `serviceId`, if any. */
  key?: string;
}

/**
 * The models a service lists. `baseUrl` is set when the list was found under a different
 * address than the one given (a missing `/v1`), so the form can fix the address.
 */
export type ModelProbe =
  | { ok: true; models: { id: string; name: string }[]; baseUrl?: string }
  | { ok: false; message: string };

export interface SettingsPatch {
  mode?: Mode;
  keepAwake?: boolean;
  /** An Obsidian vault folder; "" clears it. */
  obsidianVault?: string;
  pet?: Partial<PetSettings>;
}

/** The two figures that come with the app (ADR 0070). */
export const PET_FIGURES = ["claude", "deepseek"] as const;
export type PetFigure = (typeof PET_FIGURES)[number];

export interface PetSettings {
  /** Shown on the desktop. */
  on: boolean;
  figure: PetFigure;
}

export const DEFAULT_PET: PetSettings = { on: true, figure: "deepseek" };

/** One thing AgentHerd sent to the owner, as the pet shows it. */
export interface PetLine {
  /** Grows with every new line, so the pet knows when to speak. */
  id: number;
  at: string;
  /** say: the Herder talking; task: a task's progress; report: a task finished; ask: needs the owner. */
  kind: "say" | "task" | "report" | "ask" | "error";
  text: string;
  /** Task title or label. */
  task?: string;
  /** Only for reports. */
  result?: ReportResult;
}

/** A card waiting for the owner; its buttons work the same as in the chat app. */
export interface PetPending {
  target: string;
  title: string;
  body: string;
  options: { action: string; label: string }[];
  task?: string;
  /** Open approvals on a combined card. */
  count?: number;
}

export interface PetView {
  /** The chat channel is up, so the owner can talk and press buttons. */
  connected: boolean;
  last?: PetLine;
  /** Oldest first. */
  pending: PetPending[];
}

/** 飞书 through lark-cli in 应用连接 (ADR 0059). */
export interface LarkView {
  state: "missing" | "installing" | "no-app" | "signed-out" | "ready" | "failed";
  account?: string;
  version?: string;
  problem?: string;
  checkedAt?: string;
}

/** A 飞书 sign-in: scan the image with the 飞书 app, or open the link. */
export interface LarkLogin {
  image: string;
  url: string;
}

export type FeedSource = "github-trending" | "hacker-news" | "arxiv";

/** One news source in 应用连接 (ADR 0059). */
export interface FeedView {
  source: FeedSource;
  name: string;
  on: boolean;
}

/** Everything the host offers. Each method is one request on the socket. */
export type Tier = "strong" | "balanced" | "fast";

/** One model in the tier board; a model several services offer is one entry. */
export interface TierModelView {
  model: string;
  /** Names of the services offering it, in the order AgentHerd tries them. */
  services: string[];
  /** True when placed by AgentHerd's name rules, not by the owner. */
  auto: boolean;
}

/** The owner's models in three tiers (ADR 0028). */
export interface ModelTiersView {
  tiers: Record<Tier, TierModelView[]>;
  /** True when the owner has placed any model. */
  custom: boolean;
}

/** One app in 设置 → 应用连接 (docs/spec/09-agent-tools.md §3). */
export interface AppView {
  slug: string;
  name: string;
  logo?: string;
  connected: boolean;
  /** Waiting for the owner to finish signing in. */
  connecting: boolean;
}

/** The owner's apps through their own Composio key. The key itself never leaves the host. */
export interface AppsView {
  hasKey: boolean;
  /** Something the owner should know (bad key, failed sign-in), in Chinese. */
  problem?: string;
  /** Connected apps first. */
  apps: AppView[];
}

/** What the Herder does at set times, for the 定时任务 page (ADR 0055). */
export interface SchedulesView {
  schedules: Schedule[];
  /** False while AgentHerd is not following tasks (no herd): nothing to show or change. */
  ready: boolean;
}

/** Chinese platforms AgentHerd can use with the owner's own account (ADR 0058). */
export type SocialPlatform = "xiaohongshu" | "zhihu";

/** What a platform watch can tell the owner about. */
export type SocialKind = "mentions" | "likes" | "follows";

/** What 测试连接 found. */
export interface SocialTest {
  ok: boolean;
  message: string;
  socials: SocialView[];
}

/**
 * One platform in 应用连接 (ADR 0058). Turning it on needs the owner to accept the account-risk
 * notice once; signing in is a QR code scanned with the platform's phone app.
 */
export interface SocialView {
  platform: SocialPlatform;
  /** 小红书 / 知乎 */
  name: string;
  /** False while AgentHerd cannot connect it yet (知乎, ADR 0058). */
  available: boolean;
  /** The owner accepted the account-risk notice once; connecting again does not show it. */
  accepted: boolean;
  /** The owner accepted the notice and turned the platform on. */
  enabled: boolean;
  /**
   * off: not turned on. starting: AgentHerd is getting its helper ready. signed-out: needs a scan.
   * ready: signed in, agents and watches can use it. failed: see `problem`.
   */
  state: "off" | "starting" | "signed-out" | "ready" | "failed";
  /** The signed-in account's name, when known. */
  account?: string;
  /** Something the owner should know, in Chinese. */
  problem?: string;
  /** What the watch tells the owner about (ADR 0058 defaults: mentions on, the rest off). */
  watch: Record<SocialKind, boolean>;
  /** The last look for new notices (ISO). */
  checkedAt?: string;
}

/** A QR code to scan with the platform's app. */
export interface SocialLoginCode {
  /** data:image/png;base64,… */
  image: string;
  /** True when the account turned out to be signed in already (no code). */
  signedIn: boolean;
}

/** One thing AgentHerd watches, for the 应用连接 page (ADR 0058). */
export interface WatchView {
  /** `pr:<repo>#<n>`, `mail:<id>`, `intake:<id>`, `social:<platform>:<kind>`. */
  id: string;
  kind: "pr" | "mail" | "intake" | "social";
  /** What it watches, in the owner's words where there are some. */
  title: string;
  /** One line: how, how often. */
  detail: string;
  paused: boolean;
  /** Social watches are switched, not removed. */
  removable: boolean;
  createdAt?: string;
  /** Last news from it (ISO). */
  activeAt?: string;
}

export interface HostApi {
  status(): HostStatus;
  tasks(): TasksView;
  /** The conversation of one task: prompts, replies and tool calls. */
  transcript(taskId: string): TranscriptView;
  /** What the Herder did, newest turn first: at most `limit` turns (default 200). */
  herderActivity(limit?: number): HerderActivityView;
  memories(): MemoryView;
  /** Changes an entry's text; the old text stays in its history. */
  editMemory(id: string, text: string): MemoryView;
  forgetMemory(id: string): MemoryView;
  restoreMemory(id: string): MemoryView;
  /** Schedules are made in chat; the app shows them and can pause or remove one. */
  schedules(): SchedulesView;
  setSchedulePaused(id: string, paused: boolean): SchedulesView;
  removeSchedule(id: string): SchedulesView;
  providers(): ProviderView[];
  models(): ModelsView;
  /** Adds or replaces a service. `key`: undefined keeps the saved key, "" removes it. */
  putService(service: ModelService, key?: string): Promise<ModelsView>;
  removeService(serviceId: string): Promise<ModelsView>;
  setKey(serviceId: string, key: string): Promise<ModelsView>;
  chooseModel(role: ModelRole, ref: ModelRef | null): Promise<ModelsView>;
  testModel(ref: ModelRef): Promise<ModelTest>;
  /** Vendors pi-ai can sign in to (ADR 0068). */
  subscriptions(): SubscriptionView[];
  /**
   * Starts signing in to `provider`. On success the service `serviceId` (new, or replaced) is
   * saved with the account's models. Cancels a sign-in still running.
   */
  startLogin(provider: string, serviceId: string, name?: string): LoginView;
  answerLogin(id: string, value: string): LoginView;
  cancelLogin(id: string): LoginView;
  /** Asks an OpenAI- or Anthropic-compatible service which models it offers (GET /models). */
  probeModels(target: ProbeTarget): Promise<ModelProbe>;
  /** Starts the one-scan Feishu setup; progress comes as "setup" events. */
  setupFeishu(): SetupState;
  cancelSetup(): SetupState;
  setupState(): SetupState;
  updateSettings(patch: SettingsPatch): HostStatus;
  /** The owner's models in tiers; the Herder reads them to pick a task's model (ADR 0028). */
  modelTiers(): ModelTiersView;
  /** Saves where the owner put each model (by name); null forgets it and uses the name rules. */
  setModelTiers(tiers: Record<Tier, string[]> | null): ModelTiersView;
  /** Connects the channel again, e.g. after a network failure. */
  reconnect(): Promise<HostStatus>;
  agents(): AgentView[];
  /** Starts downloading an agent that is not in the app (ADR 0069); progress as "agents" events. */
  installAgent(id: string): AgentView[];
  cancelInstall(id: string): AgentView[];
  /** Removes a downloaded CLI. */
  removeAgent(id: string): AgentView[];
  /** Starts the agent in an empty folder, opens a session and closes it. */
  verifyAgent(id: string): Promise<AgentCheck>;
  /** The owner's apps; `search` looks in all of Composio's apps. */
  apps(search?: string): Promise<AppsView>;
  /** Checks and saves the Composio API key; "" removes it. A bad key is not saved. */
  setComposioKey(key: string): Promise<AppsView>;
  /** A sign-in link for the app; when it is done an "apps" event comes. */
  connectApp(slug: string): Promise<{ url: string }>;
  disconnectApp(slug: string): Promise<AppsView>;
  /** 小红书 and 知乎 (ADR 0058). */
  socials(): SocialView[];
  /** Turns a platform on; `accepted` must be true: the owner read the account-risk notice. */
  enableSocial(platform: SocialPlatform, accepted: boolean): Promise<SocialView[]>;
  /** Turns a platform off: agents lose its tools and its watches stop. The sign-in is kept
   * unless the owner disconnects (socialLogout first). */
  disableSocial(platform: SocialPlatform): Promise<SocialView[]>;
  /** A QR code to sign in; when the scan is done a "socials" event comes. */
  socialLoginCode(platform: SocialPlatform): Promise<SocialLoginCode>;
  /** Forgets the sign-in on this Mac. */
  socialLogout(platform: SocialPlatform): Promise<SocialView[]>;
  /** Checks now whether the platform is reachable and signed in; says what it found, in Chinese. */
  testSocial(platform: SocialPlatform): Promise<SocialTest>;
  setSocialWatch(platform: SocialPlatform, kind: SocialKind, on: boolean): SocialView[];
  /** Everything AgentHerd watches: pull requests, mail, new GitHub work, platforms. */
  watches(): WatchView[];
  setWatchPaused(id: string, paused: boolean): WatchView[];
  removeWatch(id: string): WatchView[];
  /** 飞书 through lark-cli (ADR 0059). Checks again on every call. */
  lark(): Promise<LarkView>;
  /** Installs and sets up lark-cli if needed and starts a QR sign-in; a "lark" event comes when done. */
  connectLark(): Promise<LarkLogin>;
  testLark(): Promise<{ ok: boolean; message: string; lark: LarkView }>;
  logoutLark(): Promise<LarkView>;
  feeds(): FeedView[];
  setFeed(source: FeedSource, on: boolean): FeedView[];
  /** What the desktop pet shows (ADR 0070). */
  pet(): PetView;
  /** The owner typed this to the pet: it reaches AgentHerd as a chat message. */
  petSay(text: string): Promise<PetView>;
  /** The owner pressed a button on a card in the pet's bubble. */
  petPress(target: string, action: string): Promise<PetView>;
}

export type HostMethod = keyof HostApi;

export const HOST_METHODS: readonly HostMethod[] = [
  "status",
  "tasks",
  "transcript",
  "herderActivity",
  "memories",
  "editMemory",
  "forgetMemory",
  "restoreMemory",
  "schedules",
  "setSchedulePaused",
  "removeSchedule",
  "providers",
  "models",
  "putService",
  "removeService",
  "setKey",
  "chooseModel",
  "testModel",
  "subscriptions",
  "startLogin",
  "answerLogin",
  "cancelLogin",
  "probeModels",
  "setupFeishu",
  "cancelSetup",
  "setupState",
  "updateSettings",
  "modelTiers",
  "setModelTiers",
  "reconnect",
  "agents",
  "installAgent",
  "cancelInstall",
  "removeAgent",
  "verifyAgent",
  "apps",
  "setComposioKey",
  "connectApp",
  "disconnectApp",
  "socials",
  "enableSocial",
  "disableSocial",
  "socialLoginCode",
  "socialLogout",
  "testSocial",
  "setSocialWatch",
  "watches",
  "setWatchPaused",
  "removeWatch",
  "lark",
  "connectLark",
  "testLark",
  "logoutLark",
  "feeds",
  "setFeed",
  "pet",
  "petSay",
  "petPress",
];

export type HostEvent =
  | { topic: "status"; data: HostStatus }
  | { topic: "tasks"; data: TasksView }
  | { topic: "models"; data: ModelsView }
  | { topic: "setup"; data: SetupState }
  | { topic: "agents"; data: AgentView[] }
  | { topic: "apps"; data: AppsView }
  | { topic: "socials"; data: SocialView[] }
  | { topic: "watches"; data: WatchView[] }
  | { topic: "lark"; data: LarkView }
  | { topic: "login"; data: LoginView }
  | { topic: "pet"; data: PetView };

/** The same API, asynchronous, as seen by a client. */
export type RemoteHost = {
  [K in HostMethod]: (...args: Parameters<HostApi[K]>) => Promise<Awaited<ReturnType<HostApi[K]>>>;
};

// Wire format: one JSON object per line.
export interface CallMessage {
  v: number;
  id: number;
  type: "call";
  method: HostMethod;
  params: unknown[];
}

export interface ResultMessage {
  v: number;
  id: number;
  type: "result";
  ok: boolean;
  result?: unknown;
  error?: string;
}

export interface EventMessage {
  v: number;
  type: "event";
  event: HostEvent;
}
