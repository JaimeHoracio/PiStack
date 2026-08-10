#!/usr/bin/env bun
/**
 * generate-manifest.ts
 *
 * Genera manifest.json desde package.json (fuente única de verdad para versión)
 * + hashes de assets. Ejecutar después de cada cambio de versión o de assets.
 *
 * Uso:
 *   bun run generate-manifest
 *
 * Efecto: escribe manifest.json con version/tag desde package.json y
 * recalcula todos los checksums contra los archivos reales en assets/.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "..");
const PACKAGE_JSON = join(PROJECT_ROOT, "package.json");
const MANIFEST_JSON = join(PROJECT_ROOT, "manifest.json");
const ASSETS_DIR = join(PROJECT_ROOT, "assets");

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf-8").digest("hex");
}

/**
 * Tree hash de un directorio — MISMO algoritmo que src/pistack-installer.ts.
 * Saltea node_modules/ y package-lock.json porque son artefactos generados.
 */
function computeTreeHash(dir: string): string {
  const lines: string[] = [];
  function walk(current: string) {
    for (const entry of readdirSync(current)) {
      if (entry === "node_modules" || entry === "package-lock.json") continue;
      const full = join(current, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        walk(full);
      } else {
        const relPath = relative(dir, full).replace(/\\/g, "/");
        const content = readFileSync(full, "utf-8");
        lines.push(`${relPath}:${sha256(content)}`);
      }
    }
  }
  walk(dir);
  const combined = lines.sort().join("\n");
  return createHash("sha256").update(combined, "utf-8").digest("hex");
}

// ── Fuente de verdad: package.json ────────────────────────────────────────────

const pkg = JSON.parse(readFileSync(PACKAGE_JSON, "utf-8"));
const version = pkg.version;
const tag = `v${version}`;
const repo = "JaimeHoracio/PiStack";

// ── Escanear assets ───────────────────────────────────────────────────────────

const agents: unknown[] = [];
const commands: unknown[] = [];
const skills: unknown[] = [];
const mcpServers: unknown[] = [];
const models: unknown[] = [];

// AGENTS.md + APPEND_SYSTEM.md → agents
const agentDefs = [
  {
    name: "pistack",
    file: "assets/AGENTS.md",
    description: "Orquestador PiStack para PI - 3 niveles, controller MCP, skills curadas, seguridad, robustez",
  },
  {
    name: "append-system",
    file: "assets/APPEND_SYSTEM.md",
    description: "Reglas PiStack que sobreescriben el system prompt default de PI (CodeGraph-first, Engram mandatory, Controller default)",
  },
];

for (const def of agentDefs) {
  const agentPath = join(ASSETS_DIR, def.file.replace(/^assets\//, ""));
  if (existsSync(agentPath)) {
    const content = readFileSync(agentPath, "utf-8");
    agents.push({
      name: def.name,
      file: def.file,
      description: def.description,
      version,
      sha256: sha256(content),
    });
  }
}

// extensions/*.ts → commands
const extensionsDir = join(ASSETS_DIR, "extensions");
if (existsSync(extensionsDir)) {
  for (const file of readdirSync(extensionsDir)) {
    if (!file.endsWith(".ts")) continue;
    const content = readFileSync(join(extensionsDir, file), "utf-8");
    const name = file.replace(".ts", "");
    commands.push({
      name,
      file: `assets/extensions/${file}`,
      description: `Comando PiStack: ${name}`,
      version,
      sha256: sha256(content),
    });
  }
}

// skills/*/ → skills (tree hash del directorio de cada skill)
const skillsDir = join(ASSETS_DIR, "skills");
if (existsSync(skillsDir)) {
  for (const skillName of readdirSync(skillsDir)) {
    const skillDir = join(skillsDir, skillName);
    if (!statSync(skillDir).isDirectory()) continue;
    if (!existsSync(join(skillDir, "SKILL.md"))) continue;
    skills.push({
      name: skillName,
      file: `assets/skills/${skillName}/SKILL.md`,
      description: `Skill: ${skillName}`,
      version,
      sha256: computeTreeHash(skillDir),
    });
  }
}

// tools/*/ → mcpServers (cada tool con index.js es un MCP server)
const toolsDir = join(ASSETS_DIR, "tools");
if (existsSync(toolsDir)) {
  for (const toolName of readdirSync(toolsDir)) {
    const toolDir = join(toolsDir, toolName);
    if (!statSync(toolDir).isDirectory()) continue;
    if (!existsSync(join(toolDir, "index.js"))) continue;
    mcpServers.push({
      name: toolName,
      file: `assets/tools/${toolName}/`,
      description: `MCP Server: ${toolName}`,
      version,
      sha256: computeTreeHash(toolDir),
    });
  }
}

// models.json.template → models
const modelsTemplate = join(ASSETS_DIR, "models.json.template");
if (existsSync(modelsTemplate)) {
  const content = readFileSync(modelsTemplate, "utf-8");
  models.push({
    name: "models-template",
    file: "assets/models.json.template",
    description: "Template para proveedores locales (Ollama, LM Studio, OpenCode Server) con variables de entorno",
    version,
    sha256: sha256(content),
  });
}

// ── Escribir manifest.json ────────────────────────────────────────────────────

const manifest = {
  version,
  repo,
  tag,
  agents,
  commands,
  skills,
  mcpServers,
  models,
};

writeFileSync(MANIFEST_JSON, JSON.stringify(manifest, null, 4) + "\n", "utf-8");
console.log(`✅ manifest.json generado para v${version} (tag ${tag})`);
console.log(
  `   ${agents.length} agents, ${commands.length} commands, ${skills.length} skills, ${mcpServers.length} mcpServers, ${models.length} models`
);
