import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { createBuiltinTools } from "../src/runtime/tools.ts";

let tempDir: string;
let tools: ReturnType<typeof createBuiltinTools>;

beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), "mdx-ai-test-"));
  tools = createBuiltinTools(tempDir, ["bash", "read_file", "write_file"]);
});

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

function getText(result: any): string {
  return result.content[0]?.text ?? "";
}

describe("bash tool", () => {
  const bash = () => tools.find((t) => t.name === "bash")!;

  test("executes a simple command", async () => {
    const result = await bash().execute("t1", { command: "echo hello" });
    expect(getText(result)).toBe("hello");
  });

  test("returns exit code in details", async () => {
    const result = await bash().execute("t1", { command: "true" });
    expect(result.details.exitCode).toBe(0);
  });

  test("handles command failure", async () => {
    const result = await bash().execute("t1", { command: "false" });
    expect(result.details.exitCode).not.toBe(0);
  });

  test("captures stderr", async () => {
    const result = await bash().execute("t1", { command: "echo err >&2" });
    expect(getText(result)).toContain("err");
  });

  test("runs in agent directory", async () => {
    const result = await bash().execute("t1", { command: "pwd" });
    // macOS resolves /var → /private/var, so use toContain
    expect(getText(result)).toContain(tempDir.replace("/private", ""));
  });

  test("respects timeout", async () => {
    const result = await bash().execute("t1", {
      command: "sleep 10",
      timeout: 100,
    });
    // Should fail/return quickly, not wait 10s
    expect(result.details.exitCode).not.toBe(0);
  }, 5000);
});

describe("read_file tool", () => {
  const readFile = () => tools.find((t) => t.name === "read_file")!;

  test("reads a file", async () => {
    const path = join(tempDir, "test-read.txt");
    await Bun.write(path, "file content here");

    const result = await readFile().execute("t1", { path });
    expect(getText(result)).toBe("file content here");
  });

  test("reads with offset and limit", async () => {
    const path = join(tempDir, "test-lines.txt");
    await Bun.write(path, "line0\nline1\nline2\nline3\nline4");

    const result = await readFile().execute("t1", { path, offset: 1, limit: 2 });
    expect(getText(result)).toBe("line1\nline2");
  });

  test("returns error for missing file", async () => {
    const result = await readFile().execute("t1", { path: "/nonexistent/file.txt" });
    expect(getText(result)).toContain("not found");
  });

  test("resolves relative paths against agent dir", async () => {
    const path = join(tempDir, "relative-test.txt");
    await Bun.write(path, "relative content");

    const result = await readFile().execute("t1", { path: "relative-test.txt" });
    expect(getText(result)).toBe("relative content");
  });
});

describe("write_file tool", () => {
  const writeFile = () => tools.find((t) => t.name === "write_file")!;

  test("writes a file", async () => {
    const path = join(tempDir, "test-write.txt");
    const result = await writeFile().execute("t1", { path, content: "written content" });
    expect(getText(result)).toContain("Wrote");

    const readBack = await Bun.file(path).text();
    expect(readBack).toBe("written content");
  });

  test("creates parent directories", async () => {
    const path = join(tempDir, "sub", "dir", "deep.txt");
    await writeFile().execute("t1", { path, content: "deep content" });

    const readBack = await Bun.file(path).text();
    expect(readBack).toBe("deep content");
  });

  test("overwrites existing file", async () => {
    const path = join(tempDir, "overwrite.txt");
    await Bun.write(path, "old");
    await writeFile().execute("t1", { path, content: "new" });

    const readBack = await Bun.file(path).text();
    expect(readBack).toBe("new");
  });
});
