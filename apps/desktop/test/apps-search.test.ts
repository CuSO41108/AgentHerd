import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import react from "@vitejs/plugin-react";
import { build } from "vite";
import { beforeAll, expect, it } from "vitest";

// The fixture page is built once, outside the test's own time limit: under a loaded CI runner
// the build alone can take most of a 30 s budget.
let out = "";
beforeAll(async () => {
  out = mkdtempSync(join(tmpdir(), "agentherd-search-"));
  await build({
    configFile: false,
    root: join(import.meta.dirname, "fixtures"),
    plugins: [react()],
    logLevel: "silent",
    build: { outDir: out, emptyOutDir: true },
    base: "./",
  });
  return () => rmSync(out, { recursive: true, force: true });
}, 120_000);

const RESULT = "SEARCH_RESULT ";
const STAGE = "SEARCH_STAGE ";

/**
 * Runs the fixture in Electron and returns the scenario's JSON result as soon as it is printed.
 * The child is killed then: on Windows, Electron was seen to take over 12 s to exit after
 * `app.exit(0)`, and the test does not depend on how it exits.
 */
function runFixture(trace: (stage: string) => void, limitMs: number): Promise<unknown> {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const electron: string =
    process.env.AGENTHERD_TEST_ELECTRON ?? createRequire(import.meta.url)("electron");
  const child = spawn(
    electron,
    [join(import.meta.dirname, "fixtures/apps-search.cjs"), join(out, "index.html")],
    { env, stdio: ["ignore", "pipe", "pipe"] },
  );
  trace("electron launched");
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let stderrLine = "";
    let done = false;
    const finish = (error: Error | undefined, value?: unknown) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      child.kill();
      if (error === undefined) resolve(value);
      else reject(error);
    };
    const timer = setTimeout(
      () => finish(new Error(`Electron printed no result within ${limitMs} ms\n${stderr}`)),
      limitMs,
    );
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
      const end = stdout.indexOf("\n", stdout.indexOf(RESULT));
      if (stdout.includes(RESULT) && end !== -1) {
        trace("result received");
        const line = stdout.slice(stdout.indexOf(RESULT) + RESULT.length, end);
        try {
          finish(undefined, JSON.parse(line));
        } catch (e) {
          finish(e instanceof Error ? e : new Error(String(e)));
        }
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
      // A stage line can be split across chunks: keep the unfinished tail for the next one.
      const lines = (stderrLine + text).split("\n");
      stderrLine = lines.pop() ?? "";
      for (const line of lines) {
        if (line.startsWith(STAGE)) trace(line.slice(STAGE.length).trim());
      }
    });
    child.on("error", (e) => finish(e));
    child.on("close", (code, signal) => {
      trace(`electron closed: ${code ?? signal}`);
      finish(
        new Error(`Electron ended (${code ?? signal}) without a result\n${stdout}\n${stderr}`),
      );
    });
  });
}

it("keeps only matching apps while typing, after a late reply, and after an app event", async ({
  onTestFailed,
}) => {
  // Stage timings are printed only when the test fails, to tell a slow start from a slow page.
  const start = performance.now();
  const stages: string[] = [];
  const trace = (stage: string) =>
    stages.push(`[apps-search +${Math.round(performance.now() - start)}ms] ${stage}`);
  onTestFailed(() => {
    process.stderr.write(`${stages.join("\n")}\n`);
  });
  const result = await runFixture(trace, 50_000);
  expect(result).toEqual({
    firstBatch: ["App 10", "App 11", "App 0", "App 1", "App 2"],
    secondBatch: [
      "App 10",
      "App 11",
      "App 0",
      "App 1",
      "App 2",
      "App 3",
      "App 4",
      "App 5",
      "App 6",
      "App 7",
    ],
    lastBatch: [
      "App 10",
      "App 11",
      "App 0",
      "App 1",
      "App 2",
      "App 3",
      "App 4",
      "App 5",
      "App 6",
      "App 7",
      "App 8",
      "App 9",
    ],
    moreAtEnd: false,
    extraCalls: 0,
    searchBatch: ["App 10", "App 11", "App 0", "App 1", "App 2"],
    searchExpanded: 10,
    resetBatch: 5,
    immediate: ["GitHub"],
    newer: ["GitHub"],
    late: ["GitHub"],
    storedAfterLate: ["gmail", "CODE_HOST"],
    clearedPending: ["Gmail", "GitHub"],
    slugOnly: ["GitHub"],
    event: ["GitHub"],
    cleared: ["Gmail", "GitHub"],
    noMatch: [],
  });
}, 60_000);
