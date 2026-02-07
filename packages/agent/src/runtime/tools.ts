import { Type, type Static } from "@sinclair/typebox";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { resolve, dirname } from "path";
import { existsSync } from "fs";
import { mkdir } from "fs/promises";

const BashParams = Type.Object({
  command: Type.String({ description: "The shell command to execute" }),
  timeout: Type.Optional(
    Type.Number({
      description: "Timeout in milliseconds (default: 30000)",
      default: 30000,
    }),
  ),
});

const ReadFileParams = Type.Object({
  path: Type.String({ description: "File path (relative to agent directory or absolute)" }),
  offset: Type.Optional(
    Type.Number({ description: "Line number to start reading from (0-based)" }),
  ),
  limit: Type.Optional(Type.Number({ description: "Maximum number of lines to read" })),
});

const WriteFileParams = Type.Object({
  path: Type.String({ description: "File path (relative to agent directory or absolute)" }),
  content: Type.String({ description: "Content to write to the file" }),
});

function resolvePath(cwd: string, filePath: string): string {
  if (filePath.startsWith("/")) return filePath;
  return resolve(cwd, filePath);
}

function createBashTool(cwd: string): AgentTool<typeof BashParams> {
  return {
    name: "bash",
    label: "bash",
    description:
      "Run a shell command. Use for system tasks, installing packages, running scripts, curl, etc.",
    parameters: BashParams,
    async execute(
      _toolCallId: string,
      params: Static<typeof BashParams>,
    ): Promise<AgentToolResult<{ exitCode: number }>> {
      const timeout = params.timeout ?? 30000;
      try {
        const proc = Bun.spawn(["bash", "-c", params.command], {
          cwd,
          stdout: "pipe",
          stderr: "pipe",
          env: { ...process.env },
        });

        const timer = setTimeout(() => proc.kill(), timeout);
        const [stdout, stderr] = await Promise.all([
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text(),
        ]);
        clearTimeout(timer);

        const exitCode = await proc.exited;
        const output = (stdout + (stderr ? `\n${stderr}` : "")).trim();

        return {
          content: [
            {
              type: "text",
              text: output || (exitCode === 0 ? "(no output)" : `Exit code: ${exitCode}`),
            },
          ],
          details: { exitCode },
        };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `Error: ${err.message}` }],
          details: { exitCode: 1 },
        };
      }
    },
  };
}

function createReadFileTool(cwd: string): AgentTool<typeof ReadFileParams> {
  return {
    name: "read_file",
    label: "read_file",
    description: "Read the contents of a file. Supports offset/limit for large files.",
    parameters: ReadFileParams,
    async execute(
      _toolCallId: string,
      params: Static<typeof ReadFileParams>,
    ): Promise<AgentToolResult<{}>> {
      const fullPath = resolvePath(cwd, params.path);
      try {
        if (!existsSync(fullPath)) {
          return {
            content: [{ type: "text", text: `File not found: ${params.path}` }],
            details: {},
          };
        }
        let text = await Bun.file(fullPath).text();

        if (params.offset !== undefined || params.limit !== undefined) {
          const lines = text.split("\n");
          const start = params.offset ?? 0;
          const end = params.limit !== undefined ? start + params.limit : lines.length;
          text = lines.slice(start, end).join("\n");
        }

        return {
          content: [{ type: "text", text }],
          details: {},
        };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `Error reading file: ${err.message}` }],
          details: {},
        };
      }
    },
  };
}

function createWriteFileTool(cwd: string): AgentTool<typeof WriteFileParams> {
  return {
    name: "write_file",
    label: "write_file",
    description: "Write content to a file. Creates parent directories if needed.",
    parameters: WriteFileParams,
    async execute(
      _toolCallId: string,
      params: Static<typeof WriteFileParams>,
    ): Promise<AgentToolResult<{}>> {
      const fullPath = resolvePath(cwd, params.path);
      try {
        const dir = dirname(fullPath);
        if (!existsSync(dir)) {
          await mkdir(dir, { recursive: true });
        }
        await Bun.write(fullPath, params.content);
        return {
          content: [
            { type: "text", text: `Wrote ${params.content.length} bytes to ${params.path}` },
          ],
          details: {},
        };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `Error writing file: ${err.message}` }],
          details: {},
        };
      }
    },
  };
}

export function createBuiltinTools(cwd: string): AgentTool<any>[] {
  return [createBashTool(cwd), createReadFileTool(cwd), createWriteFileTool(cwd)];
}
