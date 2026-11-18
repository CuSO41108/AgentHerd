import { describe, expect, it } from "vitest";
import { fileToOpen } from "../src/main/open-file";

const HOME = "/Users/me";
const files = new Set([
  "/Users/me/.agentherd/tasks/b1/report.md",
  "/tmp/run/install.sh",
  "/tmp/run/App.app",
  "/tmp/run/page.html",
]);
const isFile = (p: string) => files.has(p);

describe("opening a file a message names (ADR 0073)", () => {
  it("opens documents and only shows anything else in Finder", () => {
    expect(fileToOpen("~/.agentherd/tasks/b1/report.md", isFile, HOME)).toEqual({
      path: "/Users/me/.agentherd/tasks/b1/report.md",
      how: "open",
    });
    expect(fileToOpen("/tmp/run/install.sh", isFile, HOME)?.how).toBe("reveal");
    expect(fileToOpen("/tmp/run/App.app", isFile, HOME)?.how).toBe("reveal");
    expect(fileToOpen("/tmp/run/page.html", isFile, HOME)?.how).toBe("reveal");
  });

  it("refuses what is not a file on this Mac", () => {
    expect(fileToOpen("/tmp/run/missing.md", isFile, HOME)).toBeUndefined();
    expect(fileToOpen("run/report.md", isFile, HOME)).toBeUndefined();
    expect(fileToOpen("/tmp/run/../run/install.sh", isFile, HOME)?.path).toBe(
      "/tmp/run/install.sh",
    );
    expect(fileToOpen(42, isFile, HOME)).toBeUndefined();
    expect(fileToOpen("/tmp/a\0.md", isFile, HOME)).toBeUndefined();
  });
});
