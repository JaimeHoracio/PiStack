#!/usr/bin/env bun
import { installPiStack, uninstallPiStack, listComponents, COMPONENTS, type ComponentName } from "./pistack-installer.js";
import { readFileSync, existsSync, statSync } from "fs";
import { join, resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(__dirname, "..");

function getVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf-8"));
    return pkg.version;
  } catch {
    return "0.0.0";
  }
}

function looksLikePath(arg: string): boolean {
  return arg.startsWith("~") || arg.startsWith("/") || arg.startsWith(".") || arg.includes("/");
}

interface ParsedArgs {
  projectRoot?: string;
  tools: string[];
}

/**
 * Parsea argumentos posicionales.
 * - `--dir <path>` (o `--dir=<path>`) fija el directorio del proyecto
 * - Un solo argumento que parece path (contiene `/`, empieza con `~`, `.` o `/`) → directorio (compat con `npx pistack install /ruta`)
 * - El resto son componentes (tools)
 */
function parseArgs(rest: string[]): ParsedArgs {
  let projectRoot: string | undefined;
  const positional: string[] = [];

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === "--dir" || arg === "--project-root") {
      const value = rest[i + 1];
      if (!value) {
        console.error(`❌ ${arg} requiere un valor`);
        process.exit(1);
      }
      projectRoot = resolve(value);
      i++;
    } else if (arg.startsWith("--dir=")) {
      projectRoot = resolve(arg.slice("--dir=".length));
    } else if (arg.startsWith("--project-root=")) {
      projectRoot = resolve(arg.slice("--project-root=".length));
    } else {
      positional.push(arg);
    }
  }

  if (positional.length === 1 && looksLikePath(positional[0]) && !projectRoot) {
    return { projectRoot: resolve(positional[0]), tools: [] };
  }

  return { projectRoot, tools: positional };
}

async function cmdInstall(rest: string[]): Promise<void> {
  const { projectRoot, tools } = parseArgs(rest);

  console.log("📦 Iniciando instalación de PiStack...\n");
  const result = await installPiStack(projectRoot, tools);

  console.log(`\n${result.message}`);
  console.log("\n--- Detalles ---");
  for (const [key, detail] of Object.entries(result.details)) {
    const icon = detail.success ? "✅" : "❌";
    console.log(`  ${icon} ${key}: ${detail.message}`);
  }
  if (result.success) {
    console.log("\n🎉 Para usar PiStack:");
    console.log("   cd tu-proyecto");
    console.log("   pi -e .pi/extensions/commands.ts -p \"/install-stack\"");
    console.log("   o simplemente: pi (si .pi/ está en el proyecto)");
  }
  process.exit(result.success ? 0 : 1);
}

async function cmdUninstall(rest: string[]): Promise<void> {
  const { projectRoot, tools } = parseArgs(rest);

  console.log("🗑️  Desinstalando PiStack...\n");
  const result = await uninstallPiStack(projectRoot, tools);

  console.log(`\n${result.message}`);
  if (result.removed.length > 0) {
    console.log("Eliminado:");
    for (const item of result.removed) {
      console.log(`  - ${item}`);
    }
  }
  process.exit(result.success ? 0 : 1);
}

function cmdList(rest: string[]): void {
  const { projectRoot } = parseArgs(rest);
  const root = projectRoot ?? findProjectRootForList();

  console.log(`📋 Estado de PiStack en ${root}\n`);
  const status = listComponents(root);
  let anyInstalled = false;
  for (const name of COMPONENTS) {
    const s = status[name];
    const icon = s.installed ? "✅" : "⬜";
    if (s.installed) anyInstalled = true;
    console.log(`  ${icon} ${name.padEnd(16)} ${s.detail}`);
  }
  console.log(anyInstalled ? "\nInstalado parcial o completo." : "\nPiStack no está instalado.");
}

function findProjectRootForList(): string {
  return process.cwd();
}

function printHelp(): void {
  console.log(`
PiStack - Agent Harness para PI

Uso:
  npx pistack <comando> [componentes...] [--dir <directorio>]

Comandos:
  install [tools...]  Instala PiStack (todos los componentes por defecto)
  uninstall [tools...] Desinstala PiStack o componentes específicos
  list                Muestra el estado de cada componente
  version             Muestra la versión
  help                Muestra esta ayuda

Componentes:
  ${COMPONENTS.join("  ")}

Ejemplos:
  npx pistack install                          # Todo el stack en el directorio actual
  npx pistack install /ruta/proyecto           # Todo el stack en otro directorio
  npx pistack install codegraph engram         # Solo CodeGraph y Engram
  npx pistack install skills --dir /ruta       # Solo skills en un directorio
  npx pistack uninstall                        # Desinstala todo
  npx pistack uninstall engram                 # Desinstala solo Engram
  npx pistack list                             # Estado de componentes

Variables de entorno (.env) para proveedores locales:
  OLLAMA_BASE_URL=http://localhost:11434/v1
  OLLAMA_MODEL_1=llama3.1:8b
  OLLAMA_MODEL_2=qwen2.5-coder:7b
  LMSTUDIO_BASE_URL=http://localhost:1234/v1
  LMSTUDIO_MODEL=llama3.1:8b
  OPENCODE_SERVER_BASE_URL=http://localhost:8080/v1
  OPENCODE_SERVER_MODEL=gpt-4o
`);
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] ?? "help";
  const rest = args.slice(1);

  switch (command) {
    case "install":
    case "install-stack":
      await cmdInstall(rest);
      break;

    case "uninstall":
    case "remove":
      await cmdUninstall(rest);
      break;

    case "list":
      cmdList(rest);
      process.exit(0);

    case "version":
    case "-v":
    case "--version":
      console.log(`PiStack v${getVersion()}`);
      process.exit(0);

    case "help":
    case "-h":
    case "--help":
    default:
      printHelp();
      process.exit(0);
  }
}

main().catch((e) => {
  console.error(`❌ Error: ${e}`);
  process.exit(1);
});
