#!/usr/bin/env bun
import { installPiStack, uninstallPiStack, findProjectRoot } from "./pistack-installer.js";
import { readFileSync } from "fs";
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

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] ?? "install";
  const projectRoot = args[1] ? resolve(args[1]) : undefined;

  switch (command) {
    case "install":
    case "install-stack":
      console.log("📦 Iniciando instalación de PiStack...\n");
      const result = await installPiStack(projectRoot);
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

    case "uninstall":
    case "remove":
      console.log("🗑️  Desinstalando PiStack...\n");
      const uninstallResult = await uninstallPiStack(projectRoot);
      console.log(`\n${uninstallResult.message}`);
      if (uninstallResult.removed.length > 0) {
        console.log("Eliminado:");
        for (const item of uninstallResult.removed) {
          console.log(`  - ${item}`);
        }
      }
      process.exit(uninstallResult.success ? 0 : 1);

    case "version":
    case "-v":
    case "--version":
      console.log(`PiStack v${getVersion()}`);
      process.exit(0);

    case "help":
    case "-h":
    case "--help":
    default:
      console.log(`
PiStack - Agent Harness para PI

Uso:
  npx pistack <comando> [directorio-proyecto]

Comandos:
  install         Instala PiStack completo (CodeGraph, Engram, skills, controller, MCP)
  install-stack   Alias de install
  uninstall       Desinstala PiStack del proyecto
  remove          Alias de uninstall
  version         Muestra la versión
  help            Muestra esta ayuda

Ejemplos:
  npx pistack install              # Instala en directorio actual
  npx pistack install /ruta/proyecto  # Instala en directorio específico
  npx pistack uninstall            # Desinstala del directorio actual

Variables de entorno (.env) para proveedores locales:
  OLLAMA_BASE_URL=http://localhost:11434/v1
  OLLAMA_MODEL_1=llama3.1:8b
  OLLAMA_MODEL_2=qwen2.5-coder:7b
  LMSTUDIO_BASE_URL=http://localhost:1234/v1
  LMSTUDIO_MODEL=llama3.1:8b
  OPENCODE_SERVER_BASE_URL=http://localhost:8080/v1
  OPENCODE_SERVER_MODEL=gpt-4o
`);
      process.exit(0);
  }
}

main().catch(console.error);
