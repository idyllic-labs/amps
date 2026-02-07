import { existsSync, readdirSync } from "fs";
import { resolve } from "path";
import type { AgentModule } from "../types/module.ts";

export interface ModuleLoadResult {
  modules: AgentModule[];
  errors: Array<{ source: string; error: Error }>;
}

export async function loadModules(agentDir: string): Promise<ModuleLoadResult> {
  const modules: AgentModule[] = [];
  const errors: Array<{ source: string; error: Error }> = [];

  // 1. Built-in modules
  try {
    const { HeartbeatModule } = await import("../modules/heartbeat.ts");
    modules.push(new HeartbeatModule());
  } catch (err) {
    errors.push({
      source: "builtin:heartbeat",
      error: err instanceof Error ? err : new Error(String(err)),
    });
  }

  // 2. Agent-local modules from {agentDir}/modules/*.ts
  const localDir = resolve(agentDir, "modules");
  if (existsSync(localDir)) {
    const entries = readdirSync(localDir).filter((f) => f.endsWith(".ts"));
    for (const entry of entries) {
      const fullPath = resolve(localDir, entry);
      try {
        const imported = await import(fullPath);
        const defaultExport = imported.default;
        let mod: AgentModule;

        if (typeof defaultExport === "function") {
          try {
            mod = new (defaultExport as any)();
          } catch {
            mod = defaultExport();
          }
        } else if (defaultExport && typeof defaultExport.describe === "function") {
          mod = defaultExport;
        } else {
          throw new Error(
            `Module ${entry} must default-export a class, factory function, or AgentModule object`,
          );
        }

        validateModuleShape(mod, entry);
        modules.push(mod);
      } catch (err) {
        errors.push({
          source: `local:${entry}`,
          error: err instanceof Error ? err : new Error(String(err)),
        });
      }
    }
  }

  return { modules, errors };
}

function validateModuleShape(mod: any, source: string): void {
  const required = ["describe", "initialize", "tools", "systemPrompt", "start", "stop"];
  for (const method of required) {
    if (typeof mod[method] !== "function") {
      throw new Error(`Module ${source} is missing required method: ${method}()`);
    }
  }
}
