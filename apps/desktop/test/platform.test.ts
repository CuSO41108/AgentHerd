import { describe, expect, it } from "vitest";
import { isAgentSecurityBlock, isMac, pathLeaf } from "../src/renderer/src/platform";

describe("platform helpers", () => {
  it("detects macOS user agents", () => {
    expect(isMac("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")).toBe(true);
    expect(isMac("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe(false);
  });

  it("extracts the last path segment across POSIX and Windows paths", () => {
    expect(pathLeaf("/Users/me/code/web-portal")).toBe("web-portal");
    expect(pathLeaf("C:\\Users\\me\\code\\web-portal")).toBe("web-portal");
    expect(pathLeaf("C:\\Users\\me\\code\\web-portal\\")).toBe("web-portal");
    expect(pathLeaf("")).toBeUndefined();
  });

  it("detects Windows OS or security-software blocks", () => {
    expect(isAgentSecurityBlock("spawn codex.exe EPERM")).toBe(true);
    expect(isAgentSecurityBlock("Access is denied.")).toBe(true);
    expect(
      isAgentSecurityBlock(
        "Operation did not complete successfully because the file contains a virus",
      ),
    ).toBe(true);
    expect(isAgentSecurityBlock("process exited with SIGKILL")).toBe(false);
    expect(isAgentSecurityBlock(undefined)).toBe(false);
  });
});
