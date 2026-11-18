// Tencent WeStock integration tests (ADR 0076): symbol normalization, Smartbox ranking, GBK
// quote decoding, WESTOCK_QUOTE MCP tools, pinned SHA-256 CLI verification, and Host wiring.

import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeChannel } from "@agentherd/channel-fake";
import type { SecretStore } from "@agentherd/core";
import { afterEach, describe, expect, it } from "vitest";
import { Host } from "../src/host.ts";
import {
  formatQuotes,
  normalizeStockCode,
  parseQuotePacket,
  parseQuotesResponse,
  parseSmartbox,
  pickSmartboxCode,
  WESTOCK_BASE_URL,
  WESTOCK_RELEASES,
  Westock,
} from "../src/westock.ts";

function memorySecrets(): SecretStore {
  const saved: Record<string, string> = {};
  return {
    get: (k) => saved[k],
    set: (k, v) => {
      saved[k] = v;
    },
    delete: (k) => {
      delete saved[k];
    },
  };
}

/** Builds a raw GBK-encoded `v_<code>="..."` packet using verified GBK byte arrays. */
function encodeGbkPacket(code: string, nameBytes: readonly number[], restFields: string[]): Buffer {
  const prefix = Buffer.from(`v_${code}="${restFields[0] ?? "1"}~`, "ascii");
  const name = Buffer.from(nameBytes);
  const suffix = Buffer.from(`~${restFields.slice(2).join("~")}";\n`, "ascii");
  return Buffer.concat([prefix, name, suffix]);
}

function makeQuoteFields(
  flag: string,
  symbol: string,
  price: string,
  prevClose: string,
  open: string,
  time: string,
  change: string,
  changePct: string,
  high: string,
  low: string,
  turnover: string,
  turnoverRate = "0",
  pe = "0",
  marketCapYi = "0",
  kind = "GP",
): string[] {
  const fields = new Array<string>(65).fill("");
  fields[0] = flag;
  fields[2] = symbol;
  fields[3] = price;
  fields[4] = prevClose;
  fields[5] = open;
  fields[30] = time;
  fields[31] = change;
  fields[32] = changePct;
  fields[33] = high;
  fields[34] = low;
  fields[37] = turnover;
  fields[38] = turnoverRate;
  fields[39] = pe;
  fields[45] = marketCapYi;
  fields[61] = kind;
  return fields;
}

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

describe("Tencent WeStock quotes and CLI (ADR 0076)", () => {
  it("normalizes stock codes and Chinese market aliases", () => {
    expect(normalizeStockCode("600519")).toBe("sh600519");
    expect(normalizeStockCode("688981")).toBe("sh688981");
    expect(normalizeStockCode("510300")).toBe("sh510300");
    expect(normalizeStockCode("000001")).toBe("sz000001");
    expect(normalizeStockCode("300750")).toBe("sz300750");
    expect(normalizeStockCode("430047")).toBe("bj430047");
    expect(normalizeStockCode("00700")).toBe("hk00700");
    expect(normalizeStockCode("700.HK")).toBe("hk00700");
    expect(normalizeStockCode("NVDA.OQ")).toBe("usNVDA");
    expect(normalizeStockCode("BRK.B.US")).toBe("usBRK.B");
    expect(normalizeStockCode("上证指数")).toBe("sh000001");
    expect(normalizeStockCode("恒生科技")).toBe("hkHSTECH");
    expect(normalizeStockCode("纳斯达克")).toBe("us.IXIC");
    expect(normalizeStockCode("标普500")).toBe("us.INX");
    expect(normalizeStockCode("腾讯控股")).toBeUndefined();
  });

  it("ranks equities over indices and filters HK warrants and RMB counters in Smartbox", () => {
    const raw =
      'v_hint="sh~000847~\\u817e\\u8baf\\u6d4e\\u5b89~txja~ZS^hk~00700~\\u817e\\u8baf\\u63a7\\u80a1~txkg~GP^hk~80700~\\u817e\\u8baf\\u63a7\\u80a1-R~txkgr~GP^hk~12345~\\u817e\\u8baf\\u8d2d~txg~QZ^us~nvda.oq~\\u82f1\\u4f1f\\u8fbe~ywd~GP";';
    const hits = parseSmartbox(raw);
    expect(hits.map((h) => h.code)).toEqual([
      "sh000847",
      "hk00700",
      "hk80700",
      "hk12345",
      "usNVDA",
    ]);
    expect(pickSmartboxCode(hits, "腾讯")).toBe("hk00700");
    expect(pickSmartboxCode(hits, "腾讯济安")).toBe("sh000847");
    expect(pickSmartboxCode(hits, "英伟达")).toBe("usNVDA");
  });

  it("decodes GBK qt.gtimg.cn packets, converts turnover by market, and exposes MCP WESTOCK_QUOTE", async () => {
    const urls: string[] = [];
    // GBK bytes verified against TextDecoder("gbk"):
    const tencentBytes = [0xcc, 0xda, 0xd1, 0xb6, 0xbf, 0xd8, 0xb9, 0xc9]; // 腾讯控股
    const moutaiBytes = [0xb9, 0xf3, 0xd6, 0xdd, 0xc3, 0xa9, 0xcc, 0xa8]; // 贵州茅台
    const sseBytes = [0xc9, 0xcf, 0xd6, 0xa4, 0xd6, 0xb8, 0xca, 0xfd]; // 上证指数

    const packetHk = encodeGbkPacket(
      "hk00700",
      tencentBytes,
      makeQuoteFields(
        "100",
        "00700",
        "412.60",
        "406.40",
        "408.00",
        "2026/11/18 16:08:30",
        "6.20",
        "1.53",
        "415.00",
        "407.20",
        "9842000000",
        "0.25",
        "19.80",
        "38240.00",
        "GP",
      ),
    );
    const packetCn = encodeGbkPacket(
      "sh600519",
      moutaiBytes,
      makeQuoteFields(
        "1",
        "600519",
        "1520.00",
        "1500.00",
        "1505.00",
        "20261118150000",
        "20.00",
        "1.33",
        "1528.00",
        "1501.00",
        "452000",
        "0.24",
        "21.50",
        "19100.00",
        "GP-A",
      ),
    );
    const packetIdx = encodeGbkPacket(
      "sh000001",
      sseBytes,
      makeQuoteFields(
        "1",
        "000001",
        "3328.45",
        "3307.94",
        "3310.12",
        "20261118150000",
        "20.51",
        "0.62",
        "3334.90",
        "3302.18",
        "64201500",
        "0",
        "0",
        "0",
        "ZS",
      ),
    );

    const gbkBody = Buffer.concat([packetHk, packetCn]);
    let enabled = true;

    const fakeFetch = (async (input: string | URL) => {
      const url = String(input);
      urls.push(url);
      if (url.includes("smartbox.gtimg.cn")) {
        return new Response(
          'v_hint="sh~000847~\\u817e\\u8baf\\u6d4e\\u5b89~txja~ZS^hk~00700~\\u817e\\u8baf\\u63a7\\u80a1~txkg~GP";',
        );
      }
      if (url.includes("qt.gtimg.cn") && url.includes("sh000001")) {
        return new Response(new Uint8Array(Buffer.concat([packetIdx, packetHk])));
      }
      if (url.includes("qt.gtimg.cn")) {
        return new Response(new Uint8Array(gbkBody));
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;

    const ws = new Westock({
      home: mkdtempSync(join(tmpdir(), "westock-")),
      enabled: () => enabled,
      fetch: fakeFetch,
      target: "linux-x64",
    });

    const out = await ws.quote("腾讯控股, 600519");
    expect(urls[0]).toContain("smartbox.gtimg.cn");
    expect(urls[1]).toContain("qt.gtimg.cn/q=hk00700,sh600519");
    expect(out).toContain("腾讯控股 (hk00700): 412.60 HKD (+6.20 / +1.53%)");
    expect(out).toContain("成交额 98.42亿 HKD");
    expect(out).toContain("贵州茅台 (sh600519): 1520.00 CNY (+20.00 / +1.33%)");
    expect(out).toContain("成交额 45.20亿 CNY");
    expect(out).toContain("2026-11-18 15:00:00");
    expect(out).toContain("not investment advice");

    const testRes = await ws.test();
    expect(testRes.ok).toBe(true);
    expect(testRes.message).toContain("上证指数 3328.45");
    expect(testRes.sample).toContain("上证指数 (sh000001): 3328.45 (+20.51 / +0.62%)");

    const tools = ws.tools();
    expect(await tools.list()).toHaveLength(1);
    const desc = await tools.describe(["WESTOCK_QUOTE"]);
    expect(desc.get("WESTOCK_QUOTE")?.hints).toEqual({
      readOnly: true,
      create: false,
      update: false,
      destructive: false,
    });
    const mcpAns = (await tools.call("WESTOCK_QUOTE", { query: "腾讯控股, 600519" })) as {
      content: { text: string }[];
    };
    expect(mcpAns.content[0]?.text).toContain("腾讯控股");

    enabled = false;
    expect(await tools.list()).toEqual([]);
    expect((await tools.describe(["WESTOCK_QUOTE"])).size).toBe(0);
    const offAns = (await tools.call("WESTOCK_QUOTE", { query: "腾讯控股" })) as {
      isError?: boolean;
    };
    expect(offAns.isError).toBe(true);

    // Direct parser smoke check
    const rawQuotes = parseQuotesResponse('v_pv_none_match="1";\n');
    expect(rawQuotes).toEqual([]);
    expect(parseQuotePacket("bad", "1~short")).toBeUndefined();
    expect(formatQuotes([])).toContain("No live quotes");
  });

  it("rejects tampered westock CLI downloads by SHA-256 and wires managed CLI through Host", async () => {
    const home = mkdtempSync(join(tmpdir(), "westock-host-"));
    const fetchMock = (async (input: string | URL) => {
      const url = String(input);
      if (url.startsWith(WESTOCK_BASE_URL)) {
        return new Response(Buffer.from("corrupt-binary"));
      }
      return new Response("no", { status: 404 });
    }) as typeof fetch;

    const host = new Host({
      home,
      userHome: home,
      secrets: memorySecrets(),
      target: "win32-x64",
      env: { Path: "C:\\Windows\\System32" },
      fetch: fetchMock,
      westockRun: async (file, args) => {
        if (args[0] === "--version")
          return { ok: true, stdout: `westock ${file} v0.0.2`, stderr: "" };
        return { ok: true, stdout: "ok", stderr: "" };
      },
      profiles: () => [{ id: "mock", name: "Mock", command: ["mock"], env: {}, exporter: null }],
      createChannel: () => new FakeChannel(),
    });
    cleanups.push(() => host.stop());
    await host.start();

    expect(WESTOCK_RELEASES["win32-x64"]?.asset).toBe("westock-windows-amd64.exe");

    const badInstall = await host.installWestock();
    expect(badInstall.cliState).toBe("failed");
    expect(badInstall.problem).toContain("SHA-256 mismatch");
    const managedBin = join(home, "bin", "westock.exe");
    expect(existsSync(managedBin)).toBe(false);

    // Simulate a pre-verified managed binary under <home>/bin: check, Host note, toggle and remove.
    mkdirSync(join(home, "bin"), { recursive: true });
    writeFileSync(managedBin, "stub");
    const ready = await host.westock();
    expect(ready.cliState).toBe("ready");
    expect(ready.managed).toBe(true);
    expect(ready.version).toBe("0.0.2");

    const internal = host as unknown as {
      toolNotes(): string[];
      withToolPath(env: Record<string, string>): Record<string, string>;
    };
    expect(internal.toolNotes().some((n) => n.includes("`westock` CLI is ready"))).toBe(true);
    const patchedEnv = internal.withToolPath({ FOO: "bar" });
    expect(patchedEnv.Path).toBe(`${join(home, "bin")};C:\\Windows\\System32`);
    expect("PATH" in patchedEnv).toBe(false);

    const toggledOff = await host.setWestockEnabled(false);
    expect(toggledOff.enabled).toBe(false);
    expect(internal.toolNotes()).toEqual([]);

    const removed = await host.removeWestock();
    expect(removed.cliState).toBe("missing");
    expect(existsSync(managedBin)).toBe(false);
  });
});
