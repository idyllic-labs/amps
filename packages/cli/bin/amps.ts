import { Command } from "commander";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { resolve } from "path";

// ─── ANSI ────────────────────────────────────────────────────────────────────

const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
  green: "\x1b[32m",
  red: "\x1b[31m",
};

// ─── Config (~/.amps/config.json) ───────────────────────────────────────────

const CONFIG_DIR = resolve(homedir(), ".amps");
const CONFIG_PATH = resolve(CONFIG_DIR, "config.json");

interface Config {
  defaultModel?: string;
}

function readConfig(): Config {
  try {
    if (existsSync(CONFIG_PATH)) {
      return JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
    }
  } catch {}
  return {};
}

function writeConfig(config: Config): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n");
}

// ─── Providers ───────────────────────────────────────────────────────────────

interface ProviderDef {
  name: string;
  shorthand: string;
  envVars: string[];
  models: string[];
}

const PROVIDERS: ProviderDef[] = [
  {
    name: "Azure OpenAI",
    shorthand: "azure",
    envVars: ["AZURE_OPENAI_API_KEY", "AZURE_OPENAI_RESOURCE_NAME"],
    models: ["gpt-5.2", "gpt-4.1", "gpt-4o", "gpt-4o-mini"],
  },
  {
    name: "OpenAI",
    shorthand: "openai",
    envVars: ["OPENAI_API_KEY"],
    models: ["gpt-5.2", "gpt-4.1", "gpt-4o", "gpt-4o-mini", "o3", "o4-mini"],
  },
  {
    name: "Anthropic",
    shorthand: "anthropic",
    envVars: ["ANTHROPIC_API_KEY"],
    models: ["claude-sonnet-4-5", "claude-haiku-4-5", "claude-opus-4"],
  },
  {
    name: "Google",
    shorthand: "google",
    envVars: ["GEMINI_API_KEY"],
    models: ["gemini-2.5-pro", "gemini-2.5-flash"],
  },
  {
    name: "Groq",
    shorthand: "groq",
    envVars: ["GROQ_API_KEY"],
    models: ["llama-4-scout", "llama-4-maverick"],
  },
  {
    name: "xAI",
    shorthand: "xai",
    envVars: ["XAI_API_KEY"],
    models: ["grok-3", "grok-3-mini"],
  },
  {
    name: "Mistral",
    shorthand: "mistral",
    envVars: ["MISTRAL_API_KEY"],
    models: ["mistral-large", "mistral-medium"],
  },
  {
    name: "OpenRouter",
    shorthand: "openrouter",
    envVars: ["OPENROUTER_API_KEY"],
    models: ["any model via openrouter"],
  },
];

const FALLBACK_MODEL = "azure/gpt-5.2";

function checkProvider(p: ProviderDef): { configured: boolean; missing: string[] } {
  const missing: string[] = [];
  for (const v of p.envVars) {
    if (!process.env[v]) missing.push(v);
  }
  return { configured: missing.length === 0, missing };
}

function getDefaultModel(): string {
  if (process.env.AMPS_MODEL) return process.env.AMPS_MODEL;
  const config = readConfig();
  if (config.defaultModel) return config.defaultModel;
  return FALLBACK_MODEL;
}

function printProviders() {
  const defaultModel = getDefaultModel();
  const defaultProvider = defaultModel.split("/")[0];
  const config = readConfig();

  const configured: ProviderDef[] = [];
  const unconfigured: ProviderDef[] = [];

  for (const p of PROVIDERS) {
    const { configured: ok } = checkProvider(p);
    if (ok) configured.push(p);
    else unconfigured.push(p);
  }

  process.stdout.write(`\n${c.cyan}amps providers${c.reset}\n\n`);

  if (configured.length === 0) {
    process.stdout.write(`  ${c.yellow}No providers configured.${c.reset}\n`);
    process.stdout.write(`  Set the required environment variables for at least one provider.\n\n`);
  } else {
    process.stdout.write(`  ${c.green}Configured${c.reset}\n\n`);
    for (const p of configured) {
      const isDefault = p.shorthand === defaultProvider;
      const marker = isDefault ? `${c.green}◆${c.reset}` : `${c.dim}○${c.reset}`;
      const tag = isDefault ? `  ${c.dim}(default)${c.reset}` : "";
      const models = p.models.map((m) => `${c.dim}${p.shorthand}/${m}${c.reset}`).join(", ");
      process.stdout.write(`  ${marker} ${c.bold}${p.name}${c.reset}${tag}\n`);
      process.stdout.write(`    ${models}\n\n`);
    }
  }

  if (unconfigured.length > 0) {
    process.stdout.write(`  ${c.dim}Not configured${c.reset}\n\n`);
    for (const p of unconfigured) {
      const { missing } = checkProvider(p);
      const vars = missing.map((v) => `${c.yellow}${v}${c.reset}`).join(", ");
      process.stdout.write(`  ${c.dim}○ ${p.name}${c.reset}\n`);
      process.stdout.write(`    ${c.dim}needs${c.reset} ${vars}\n\n`);
    }
  }

  process.stdout.write(`  ${c.dim}─────────────────────────────────────────${c.reset}\n`);
  process.stdout.write(`  ${c.dim}Default model:${c.reset} ${c.bold}${defaultModel}${c.reset}`);
  if (process.env.AMPS_MODEL) {
    process.stdout.write(`  ${c.dim}(from AMPS_MODEL)${c.reset}`);
  } else if (config.defaultModel) {
    process.stdout.write(`  ${c.dim}(from ~/.amps/config.json)${c.reset}`);
  }
  process.stdout.write(`\n`);
  process.stdout.write(
    `  ${c.dim}Change with:${c.reset} amps providers default ${c.dim}<provider/model>${c.reset}\n\n`,
  );
}

function setDefaultModel(model: string) {
  if (!model.includes("/")) {
    process.stderr.write(
      `${c.red}Error:${c.reset} Model must be in provider/model format (e.g., azure/gpt-5.2)\n`,
    );
    process.exit(1);
  }

  const provider = model.split("/")[0];
  const providerDef = PROVIDERS.find((p) => p.shorthand === provider);

  if (providerDef) {
    const { configured } = checkProvider(providerDef);
    if (!configured) {
      process.stderr.write(
        `${c.yellow}Warning:${c.reset} ${providerDef.name} is not configured (missing env vars)\n`,
      );
    }
  }

  const config = readConfig();
  config.defaultModel = model;
  writeConfig(config);

  process.stdout.write(`${c.green}✓${c.reset} Default model set to ${c.bold}${model}${c.reset}\n`);
  process.stdout.write(`${c.dim}  Saved to ~/.amps/config.json${c.reset}\n`);
}

// ─── Spawn helper ────────────────────────────────────────────────────────────

async function spawn(binPath: string, args: string[]): Promise<never> {
  const proc = Bun.spawn(["bun", "run", binPath, ...args], {
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  });
  process.exit(await proc.exited);
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

const program = new Command()
  .name("amps")
  .description("Agent MetaProgramming System — scriptable AI agents in Markdown")
  .version("0.1.0-alpha.4")
  .enablePositionalOptions();

// workflow — pass-through to sub-package
program
  .command("workflow")
  .description("Execute or validate MDX workflows")
  .helpOption(false)
  .allowUnknownOption()
  .passThroughOptions()
  .argument("[args...]")
  .action((_args) => {
    const raw = process.argv.slice(process.argv.indexOf("workflow") + 1);
    const binPath = new URL("../../workflow/bin/amps-workflow.ts", import.meta.url).pathname;
    spawn(binPath, raw);
  });

// agent — pass-through to sub-package
program
  .command("agent")
  .description("Start a markdown-defined agent")
  .helpOption(false)
  .allowUnknownOption()
  .passThroughOptions()
  .argument("[args...]")
  .action((_args) => {
    const raw = process.argv.slice(process.argv.indexOf("agent") + 1);
    const binPath = new URL("../../agent/bin/amps-agent.ts", import.meta.url).pathname;
    spawn(binPath, raw);
  });

// providers
const providers = program
  .command("providers")
  .description("Show available LLM providers and configuration status")
  .action(() => {
    printProviders();
  });

providers
  .command("default")
  .description("Set the default provider and model")
  .argument("<provider/model>", "e.g., azure/gpt-5.2, openai/gpt-4o")
  .action((model: string) => {
    setDefaultModel(model);
  });

program.parse();
