import { describe, expect, it } from "vitest";
import {
  fileToOpen,
  PICTURE_MAX_BYTES,
  type PictureDisk,
  pictureMime,
  pictureToShow,
} from "../src/main/open-file";
import { type PetMenuPlace, petMenuItems } from "../src/main/pet-menu";

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

  it("handles Windows drive and ~\\ paths cleanly", () => {
    const winFiles = new Set(["G:\\AgentHerd\\README.md", "C:\\Users\\me\\.agentherd\\run.cmd"]);
    const winHas = (p: string) => winFiles.has(p);
    expect(fileToOpen("G:\\AgentHerd\\README.md", winHas, "C:\\Users\\me")).toEqual({
      path: "G:\\AgentHerd\\README.md",
      how: "open",
    });
    expect(fileToOpen("~\\.agentherd\\run.cmd", winHas, "C:\\Users\\me")).toEqual({
      path: "C:\\Users\\me\\.agentherd\\run.cmd",
      how: "reveal",
    });
  });
});

describe("reading a picture the Herder shows (ADR 0075)", () => {
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7]);
  const disk = (files: Record<string, Uint8Array | number>): PictureDisk => ({
    fileSize: (p) => {
      const f = files[p];
      return f === undefined ? undefined : typeof f === "number" ? f : f.length;
    },
    read: (p) => {
      const f = files[p];
      if (f === undefined || typeof f === "number") throw new Error("not readable");
      return f;
    },
  });

  it("hands back a png as a data URL, by full path or from home", () => {
    const d = disk({ "/tmp/qr.png": PNG, "/Users/me/shot.PNG": PNG });
    const url = `data:image/png;base64,${Buffer.from(PNG).toString("base64")}`;
    expect(pictureToShow("/tmp/qr.png", d, HOME)).toBe(url);
    expect(pictureToShow("~/shot.PNG", d, HOME)).toBe(url);
  });

  it("handles Windows drive and ~\\ picture paths cleanly", () => {
    const d = disk({ "G:\\AgentHerd\\qr.png": PNG, "C:\\Users\\me\\shot.PNG": PNG });
    const url = `data:image/png;base64,${Buffer.from(PNG).toString("base64")}`;
    expect(pictureToShow("G:\\AgentHerd\\qr.png", d, "C:\\Users\\me")).toBe(url);
    expect(pictureToShow("~\\shot.PNG", d, "C:\\Users\\me")).toBe(url);
  });

  it("reads nothing that is not a picture of a fair size", () => {
    const script = new TextEncoder().encode("#!/bin/sh\n");
    const d = disk({
      "/tmp/run.sh": script,
      "/tmp/fake.png": script,
      "/tmp/empty.png": new Uint8Array(),
      "/tmp/huge.png": PICTURE_MAX_BYTES + 1,
      "/tmp/pic.svg": PNG,
    });
    expect(pictureToShow("/tmp/run.sh", d, HOME)).toBeUndefined();
    expect(pictureToShow("/tmp/fake.png", d, HOME)).toBeUndefined();
    expect(pictureToShow("/tmp/empty.png", d, HOME)).toBeUndefined();
    expect(pictureToShow("/tmp/huge.png", d, HOME)).toBeUndefined();
    expect(pictureToShow("/tmp/pic.svg", d, HOME)).toBeUndefined();
    expect(pictureToShow("/tmp/missing.png", d, HOME)).toBeUndefined();
    expect(pictureToShow("qr.png", d, HOME)).toBeUndefined();
    expect(pictureToShow(7, d, HOME)).toBeUndefined();
  });

  it("knows pictures by their first bytes", () => {
    expect(pictureMime(PNG)).toBe("image/png");
    expect(pictureMime(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39]))).toBe("image/gif");
    expect(pictureMime(new TextEncoder().encode("<svg"))).toBeUndefined();
  });
});

describe("the pet's right-click menu (ADR 0075)", () => {
  const place = (over: Partial<PetMenuPlace>): PetMenuPlace => ({
    selectionText: "",
    linkURL: "",
    mediaType: "none",
    isEditable: false,
    editFlags: { canCut: false, canCopy: false, canPaste: false, canSelectAll: false },
    ...over,
  });
  const labels = (p: PetMenuPlace) => petMenuItems(p).map((i) => i.label);

  it("copies selected words, a picture and a link", () => {
    expect(labels(place({ selectionText: "授权完回我一句" }))).toEqual(["复制"]);
    expect(labels(place({ mediaType: "image" }))).toEqual(["复制图片"]);
    expect(
      labels(place({ linkURL: "https://accounts.feishu.cn/x", selectionText: "链接" })),
    ).toEqual(["复制", "复制链接"]);
    expect(labels(place({ linkURL: "javascript:alert(1)" }))).toEqual([]);
    expect(labels(place({ selectionText: "  " }))).toEqual([]);
  });

  it("cuts, copies and pastes in the input", () => {
    const flags = { canCut: true, canCopy: true, canPaste: true, canSelectAll: true };
    expect(labels(place({ isEditable: true, editFlags: flags }))).toEqual([
      "剪切",
      "复制",
      "粘贴",
      "全选",
    ]);
    expect(
      labels(place({ isEditable: true, editFlags: { ...flags, canCut: false, canCopy: false } })),
    ).toEqual(["粘贴", "全选"]);
  });
});
