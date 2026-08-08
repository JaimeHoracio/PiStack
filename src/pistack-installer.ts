import { existsSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, rmSync, readdirSync, statSync } from "fs";
import { homedir } from "os";
import { createHash } from "crypto";
import { join, resolve, dirname, relative } from "path";
import { fileURLToPath } from "url";
import { $ } from "bun";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(__dirname, "..");
const ASSETS_DIR = join(PACKAGE_ROOT, "assets");

export interface PiStackPaths {
  root: string;
  agents: string;
  commands: string;
  skills: string;
  extensions: string;
  tools: string;
  mcp: string;
}

export interface ManifestItem {
  name: string;
  file: string;
  description: string;
  version: string;
  sha256: string;
}

export interface Manifest {
  version: string;
  repo: string;
  tag: string;
  agents: ManifestItem[];
  commands: ManifestItem[];
  skills: ManifestItem[];
  mcpServers: ManifestItem[];
}

export interface Lockfile {
  version: string;
  lockedAt: string;
  repo: string;
  tag: string;
  agents: Record<string, { version: string; installedAt: string; sha256: string }>;
  commands: Record<string, { version: string; installedAt: string; sha256: string }>;
  skills: Record<string, { version: string; installedAt: string; sha256: string }>;
  mcpServers: Record<string, { version: string; installedAt: string; sha256: string }>;
  models: Record<string, { version: string; installedAt: string; sha256: string }>;
}

export type ComponentDetail = { success: boolean; message: string };

export type ComponentName =
  | "pi-mcp-adapter"
  | "codegraph"
  | "engram"
  | "agents"
  | "skills"
  | "extensions"
  | "controller"
  | "mcp-config"
  | "models";

export const COMPONENTS: ComponentName[] = [
  "pi-mcp-adapter",
  "codegraph",
  "engram",
  "agents",
  "skills",
  "extensions",
  "controller",
  "mcp-config",
  "models",
];

export function validateComponents(tools: string[]): ComponentName[] | null {
  const valid = new Set<string>(COMPONENTS);
  for (const t of tools) {
    if (!valid.has(t)) return null;
  }
  return tools as ComponentName[];
}

// ─── Path helpers ─────────────────────────────────────────────────────────────

export function findPiDir(startDir: string = process.cwd()): string | null {
  let current = resolve(startDir);
  while (true) {
    const piDir = join(current, ".pi");
    if (existsSync(piDir)) return piDir;

    if (existsSync(join(current, ".git"))) return null;

    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

export function findProjectRoot(startDir: string = process.cwd()): string {
  let current = resolve(startDir);
  while (true) {
    if (existsSync(join(current, ".pi")) || existsSync(join(current, ".git"))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) return resolve(startDir);
    current = parent;
  }
}

/**
 * Valida que el destino no sea el home directory ni la raíz del sistema.
 * CodeGraph rechaza inicializarse ahí y es un destino inválido para .pi/.
 */
export function isValidInstallRoot(root: string): boolean {
  const homeDir = resolve(homedir());
  return root !== homeDir && root !== resolve("/");
}

export function ensurePiPaths(piDir: string): PiStackPaths {
  const paths: PiStackPaths = {
    root: piDir,
    agents: join(piDir, "agents"),
    commands: join(piDir, "commands"),
    skills: join(piDir, "skills"),
    extensions: join(piDir, "extensions"),
    tools: join(piDir, "tools"),
    mcp: join(piDir, "mcp"),
  };
  for (const dir of Object.values(paths)) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
  return paths;
}

export function createPiDir(baseDir: string): PiStackPaths {
  return ensurePiPaths(join(baseDir, ".pi"));
}

export function copyDirRecursive(src: string, dest: string, skipGenerated: boolean = false): void {
  if (!existsSync(dest)) mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src)) {
    if (skipGenerated && (entry === "node_modules" || entry === "package-lock.json")) continue;
    const srcPath = join(src, entry);
    const destPath = join(dest, entry);
    const stat = statSync(srcPath);
    if (stat.isDirectory()) {
      copyDirRecursive(srcPath, destPath, skipGenerated);
    } else {
      copyFileSync(srcPath, destPath);
    }
  }
}

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf-8").digest("hex");
}

export function computeTreeHash(dir: string): string {
  const lines: string[] = [];
  walkForHash(dir, dir, lines);
  const combined = lines.sort().join("\n");
  return createHash("sha256").update(combined, "utf-8").digest("hex");
}

function walkForHash(root: string, current: string, lines: string[]): void {
  for (const entry of readdirSync(current)) {
    if (entry === "node_modules" || entry === "package-lock.json") continue;
    const full = join(current, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walkForHash(root, full, lines);
    } else {
      const rel = relative(root, full);
      const content = readFileSync(full, "utf-8");
      lines.push(`${rel}:${sha256(content)}`);
    }
  }
}

// ─── Lockfile helpers ─────────────────────────────────────────────────────────

function readLockfile(piDir: string): Lockfile | null {
  const lockPath = join(piDir, "pistack-lock.json");
  if (!existsSync(lockPath)) return null;
  try {
    return JSON.parse(readFileSync(lockPath, "utf-8"));
  } catch {
    return null;
  }
}

function writeLockfile(piDir: string, lock: Lockfile): void {
  const lockPath = join(piDir, "pistack-lock.json");
  writeFileSync(lockPath, JSON.stringify(lock, null, 2) + "\n", "utf-8");
}

function upsertLockfile(
  paths: PiStackPaths,
  type: "agents" | "commands" | "skills" | "mcpServers" | "models",
  item: ManifestItem,
  manifest: Manifest,
  contentHash: string
): void {
  const existing: Lockfile = readLockfile(paths.root) ?? {
    version: manifest.version,
    lockedAt: new Date().toISOString(),
    repo: manifest.repo,
    tag: manifest.tag,
    agents: {},
    commands: {},
    skills: {},
    mcpServers: {},
    models: {},
  };

  if (!existing[type]) existing[type] = {};

  existing[type]![item.name] = {
    version: item.version,
    installedAt: new Date().toISOString(),
    sha256: contentHash,
  };

  writeLockfile(paths.root, existing);
}

/**
 * Remueve una entrada del mcp.json del proyecto (ej: desinstalar codegraph
 * quita su server de mcpServers pero deja el resto de la config intacta).
 */
function removeMcpEntry(piDir: string, name: string): void {
  const mcpPath = join(piDir, "mcp.json");
  if (!existsSync(mcpPath)) return;
  try {
    const config = JSON.parse(readFileSync(mcpPath, "utf-8"));
    if (config.mcpServers && config.mcpServers[name]) {
      delete config.mcpServers[name];
      writeFileSync(mcpPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
    }
  } catch {
    // mcp.json corrupto — no es fatal
  }
}

// ─── Downloads ────────────────────────────────────────────────────────────────

async function downloadFile(url: string, dest: string, maxSize: number = 100_000_000): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to download ${url}: ${response.statusText}`);
  const arrayBuffer = await response.arrayBuffer();
  if (arrayBuffer.byteLength > maxSize) throw new Error(`Download too large: ${arrayBuffer.byteLength} bytes`);
  writeFileSync(dest, Buffer.from(arrayBuffer));
}

// ─── Install por componente ───────────────────────────────────────────────────

export async function installPiMcpAdapterComponent(): Promise<ComponentDetail> {
  try {
    
    await $`pi install npm:pi-mcp-adapter`.quiet();
    return { success: true, message: "pi-mcp-adapter instalado" };
  } catch (e) {
    return { success: false, message: `Error instalando pi-mcp-adapter: ${e}` };
  }
}

export async function installCodeGraphComponent(toolsDir: string, projectRoot: string): Promise<ComponentDetail> {
  const cgToolDir = join(toolsDir, "codegraph");
  const cgBinDir = join(cgToolDir, "bin");
  if (!existsSync(cgBinDir)) mkdirSync(cgBinDir, { recursive: true });

  const localBin = join(cgBinDir, "codegraph");
  if (existsSync(localBin)) {
    try {
      
      await $`${localBin} --version`.quiet();
    } catch {
      try { rmSync(cgBinDir, { recursive: true, force: true }); } catch {}
    }
  }

  if (!existsSync(localBin)) {
    try {
      const tagResponse = await fetch("https://api.github.com/repos/colbymchenry/codegraph/releases/latest");
      const tagData = await tagResponse.json();
      const tag = tagData.tag_name || "v1.5.0";

      const url = `https://github.com/colbymchenry/codegraph/releases/download/${tag}/codegraph-linux-x64.tar.gz`;
      const tarPath = join(cgToolDir, "codegraph.tar.gz");

      await downloadFile(url, tarPath, 200_000_000);

      
      await $`tar -xzf ${tarPath} -C ${cgToolDir} && mv ${cgToolDir}/codegraph-linux-x64/* ${cgToolDir}/ && rm -rf ${cgToolDir}/codegraph-linux-x64 ${tarPath}`.cwd(cgToolDir);
      await $`chmod +x ${localBin}`;
    } catch (e) {
      return { success: false, message: `Error instalando CodeGraph: ${e}` };
    }
  }

  // Inicializar el índice en el proyecto
  try {
    
    await $`${localBin} init -i`.cwd(projectRoot);
  } catch (e) {
    return { success: false, message: `CodeGraph descargado pero init falló: ${e}` };
  }

  return { success: true, message: "CodeGraph instalado e inicializado (.pi/tools/codegraph)" };
}

export async function installEngramComponent(toolsDir: string): Promise<ComponentDetail> {
  const egToolDir = join(toolsDir, "engram");
  const egBinDir = join(egToolDir, "bin");
  if (!existsSync(egBinDir)) mkdirSync(egBinDir, { recursive: true });

  const localBin = join(egBinDir, "engram");
  if (existsSync(localBin)) {
    try {
      
      await $`${localBin} --version`.quiet();
    } catch {
      try { rmSync(egBinDir, { recursive: true, force: true }); } catch {}
    }
  }

  if (!existsSync(localBin)) {
    try {
      const tagResponse = await fetch("https://api.github.com/repos/Gentleman-Programming/engram/releases/latest");
      const tagData = await tagResponse.json();
      const tag = tagData.tag_name || "v1.20.0";
      const versionNum = tag.replace("v", "");

      const url = `https://github.com/Gentleman-Programming/engram/releases/download/${tag}/engram_${versionNum}_linux_amd64.tar.gz`;
      const tarPath = join(egToolDir, "engram.tar.gz");

      await downloadFile(url, tarPath, 50_000_000);

      
      await $`tar -xzf ${tarPath} -C ${egToolDir} && mv ${egToolDir}/engram ${localBin} && rm ${tarPath}`.cwd(egToolDir);
      await $`chmod +x ${localBin}`;
    } catch (e) {
      return { success: false, message: `Error instalando Engram: ${e}` };
    }
  }

  return { success: true, message: "Engram instalado (.pi/tools/engram)" };
}

export function installAgentsComponent(piDir: PiStackPaths, manifest: Manifest): ComponentDetail {
  try {
    copyFileSync(join(ASSETS_DIR, "AGENTS.md"), join(piDir.root, "AGENTS.md"));
    const content = readFileSync(join(ASSETS_DIR, "AGENTS.md"), "utf-8");
    const hash = sha256(content);
    upsertLockfile(piDir, "agents", {
      name: "pistack",
      file: "AGENTS.md",
      description: "Agente PiStack para PI",
      version: manifest.version,
      sha256: hash,
    }, manifest, hash);
    return { success: true, message: "AGENTS.md instalado" };
  } catch (e) {
    return { success: false, message: `Error copiando AGENTS.md: ${e}` };
  }
}

export function installSkillsComponent(piDir: PiStackPaths, manifest: Manifest): ComponentDetail {
  try {
    copyDirRecursive(join(ASSETS_DIR, "skills"), join(piDir.root, "skills"));
    const skillsDir = join(ASSETS_DIR, "skills");
    for (const skillName of readdirSync(skillsDir)) {
      const skillPath = join(skillsDir, skillName, "SKILL.md");
      if (existsSync(skillPath)) {
        const content = readFileSync(skillPath, "utf-8");
        const hash = sha256(content);
        upsertLockfile(piDir, "skills", {
          name: skillName,
          file: `skills/${skillName}/SKILL.md`,
          description: `Skill: ${skillName}`,
          version: manifest.version,
          sha256: hash,
        }, manifest, hash);
      }
    }
    return { success: true, message: `${readdirSync(skillsDir).length} skills instaladas` };
  } catch (e) {
    return { success: false, message: `Error instalando skills: ${e}` };
  }
}

export function installExtensionsComponent(piDir: PiStackPaths): ComponentDetail {
  try {
    copyDirRecursive(join(ASSETS_DIR, "extensions"), join(piDir.root, "extensions"));
    return { success: true, message: "Extensions instaladas" };
  } catch (e) {
    return { success: false, message: `Error instalando extensions: ${e}` };
  }
}

export function installControllerComponent(piDir: PiStackPaths): ComponentDetail {
  try {
    copyDirRecursive(join(ASSETS_DIR, "tools", "pistack-controller"), join(piDir.tools, "pistack-controller"), true);
    return { success: true, message: "Controller MCP instalado" };
  } catch (e) {
    return { success: false, message: `Error instalando controller: ${e}` };
  }
}

export function installMcpConfigComponent(piDir: PiStackPaths, manifest: Manifest): ComponentDetail {
  try {
    const mcpConfig = {
      settings: { toolPrefix: "none" },
      mcpServers: {
        "pistack-controller": {
          command: "node",
          args: [".pi/tools/pistack-controller/index.js"],
          lifecycle: "keep-alive",
          directTools: true,
        },
        codegraph: {
          command: ".pi/tools/codegraph/bin/codegraph",
          args: ["serve", "--mcp"],
          lifecycle: "lazy",
          directTools: true,
        },
        engram: {
          command: ".pi/tools/engram/bin/engram",
          args: ["mcp"],
          lifecycle: "lazy",
          directTools: ["mem_context", "mem_search", "mem_save", "mem_session_summary"],
        },
        context7: {
          url: "https://mcp.context7.com/mcp",
          lifecycle: "lazy",
        },
      },
    };
    writeFileSync(join(piDir.root, "mcp.json"), JSON.stringify(mcpConfig, null, 2) + "\n", "utf-8");
    const mcpHash = sha256(JSON.stringify(mcpConfig));
    upsertLockfile(piDir, "mcpServers", {
      name: "mcp-config",
      file: "mcp.json",
      description: "Configuración MCP para PiStack",
      version: manifest.version,
      sha256: mcpHash,
    }, manifest, mcpHash);
    return { success: true, message: ".pi/mcp.json creado" };
  } catch (e) {
    return { success: false, message: `Error creando mcp.json: ${e}` };
  }
}

export function installModelsComponent(piDir: PiStackPaths, manifest: Manifest): ComponentDetail {
  try {
    const templatePath = join(ASSETS_DIR, "models.json.template");
    const destPath = join(piDir.root, "models.json");
    if (existsSync(templatePath) && !existsSync(destPath)) {
      copyFileSync(templatePath, destPath);
      const content = readFileSync(templatePath, "utf-8");
      const hash = sha256(content);
      upsertLockfile(piDir, "models", {
        name: "models-template",
        file: "models.json",
        description: "Template para proveedores locales (Ollama, LM Studio, OpenCode Server)",
        version: manifest.version,
        sha256: hash,
      }, manifest, hash);
      return { success: true, message: ".pi/models.json creado (configurar variables en .env)" };
    }
    return { success: true, message: ".pi/models.json ya existe, se omite" };
  } catch (e) {
    return { success: false, message: `Error creando models.json: ${e}` };
  }
}

export async function installComponent(
  name: ComponentName,
  piDir: PiStackPaths,
  manifest: Manifest,
  projectRoot: string
): Promise<ComponentDetail> {
  switch (name) {
    case "pi-mcp-adapter": return installPiMcpAdapterComponent();
    case "codegraph": return installCodeGraphComponent(piDir.tools, projectRoot);
    case "engram": return installEngramComponent(piDir.tools);
    case "agents": return installAgentsComponent(piDir, manifest);
    case "skills": return installSkillsComponent(piDir, manifest);
    case "extensions": return installExtensionsComponent(piDir);
    case "controller": return installControllerComponent(piDir);
    case "mcp-config": return installMcpConfigComponent(piDir, manifest);
    case "models": return installModelsComponent(piDir, manifest);
  }
}

export async function installPiStack(
  projectRoot?: string,
  tools?: string[]
): Promise<{
  success: boolean;
  message: string;
  details: Record<string, ComponentDetail>;
}> {
  const root = projectRoot ?? findProjectRoot();

  if (!isValidInstallRoot(root)) {
    return {
      success: false,
      message:
        `No se puede instalar PiStack en ${root}. ` +
        `Ejecutá el instalador dentro de un directorio de proyecto: ` +
        `cd tu-proyecto && npx pistack install`,
      details: {},
    };
  }

  let selected: ComponentName[];
  if (tools && tools.length > 0) {
    const valid = validateComponents(tools);
    if (valid === null) {
      return {
        success: false,
        message: `Componente(s) inválido(s): ${tools.join(", ")}. Válidos: ${COMPONENTS.join(", ")}`,
        details: {},
      };
    }
    selected = valid;
  } else {
    selected = [...COMPONENTS];
  }

  const piDir = createPiDir(root);
  const manifest = await loadManifest();

  console.log(`🚀 Instalando PiStack v${manifest.version} en ${root}`);
  console.log(`   Componentes: ${selected.join(", ")}\n`);

  const details: Record<string, ComponentDetail> = {};

  // 1. Verificar PI (precondición de todo el stack)
  try {
    
    const piVersion = await $`pi --version`.text();
    details.pi = { success: true, message: `PI detectado: ${piVersion.trim()}` };
  } catch {
    details.pi = { success: false, message: "PI no encontrado. Instalá PI primero." };
    return { success: false, message: "PI no instalado", details };
  }

  // 2. Instalar componentes seleccionados
  for (const name of selected) {
    details[name] = await installComponent(name, piDir, manifest, root);
  }

  const allSuccess = Object.values(details).every(d => d.success);
  return {
    success: allSuccess,
    message: allSuccess ? "✅ PiStack instalado correctamente" : "⚠️ PiStack instalado con advertencias",
    details,
  };
}

// ─── Uninstall por componente ─────────────────────────────────────────────────

export function uninstallAgentsComponent(root: string): string[] {
  const removed: string[] = [];
  const p = join(root, ".pi", "AGENTS.md");
  if (existsSync(p)) {
    rmSync(p, { force: true });
    removed.push(".pi/AGENTS.md");
  }
  return removed;
}

export function uninstallSkillsComponent(root: string): string[] {
  const removed: string[] = [];
  const p = join(root, ".pi", "skills");
  if (existsSync(p)) {
    rmSync(p, { recursive: true, force: true });
    removed.push(".pi/skills/");
  }
  return removed;
}

export function uninstallExtensionsComponent(root: string): string[] {
  const removed: string[] = [];
  const p = join(root, ".pi", "extensions");
  if (existsSync(p)) {
    rmSync(p, { recursive: true, force: true });
    removed.push(".pi/extensions/");
  }
  return removed;
}

export function uninstallControllerComponent(root: string): string[] {
  const removed: string[] = [];
  const p = join(root, ".pi", "tools", "pistack-controller");
  if (existsSync(p)) {
    rmSync(p, { recursive: true, force: true });
    removed.push(".pi/tools/pistack-controller/");
  }
  removeMcpEntry(join(root, ".pi"), "pistack-controller");
  return removed;
}

export function uninstallCodeGraphComponent(root: string): string[] {
  const removed: string[] = [];
  const toolDir = join(root, ".pi", "tools", "codegraph");
  if (existsSync(toolDir)) {
    rmSync(toolDir, { recursive: true, force: true });
    removed.push(".pi/tools/codegraph/");
  }
  const indexDir = join(root, ".codegraph");
  if (existsSync(indexDir)) {
    rmSync(indexDir, { recursive: true, force: true });
    removed.push(".codegraph/");
  }
  removeMcpEntry(join(root, ".pi"), "codegraph");
  return removed;
}

export function uninstallEngramComponent(root: string): string[] {
  const removed: string[] = [];
  const p = join(root, ".pi", "tools", "engram");
  if (existsSync(p)) {
    rmSync(p, { recursive: true, force: true });
    removed.push(".pi/tools/engram/");
  }
  removeMcpEntry(join(root, ".pi"), "engram");
  return removed;
}

export function uninstallMcpConfigComponent(root: string): string[] {
  const removed: string[] = [];
  const p = join(root, ".pi", "mcp.json");
  if (existsSync(p)) {
    rmSync(p, { force: true });
    removed.push(".pi/mcp.json");
  }
  return removed;
}

export function uninstallModelsComponent(root: string): string[] {
  const removed: string[] = [];
  const p = join(root, ".pi", "models.json");
  if (existsSync(p)) {
    rmSync(p, { force: true });
    removed.push(".pi/models.json");
  }
  return removed;
}

export async function uninstallPiMcpAdapterComponent(): Promise<string[]> {
  try {
    
    await $`pi uninstall npm:pi-mcp-adapter`.quiet();
    return ["pi-mcp-adapter"];
  } catch {
    return [];
  }
}

export async function uninstallComponent(name: ComponentName, root: string): Promise<string[]> {
  switch (name) {
    case "pi-mcp-adapter": return uninstallPiMcpAdapterComponent();
    case "codegraph": return uninstallCodeGraphComponent(root);
    case "engram": return uninstallEngramComponent(root);
    case "agents": return uninstallAgentsComponent(root);
    case "skills": return uninstallSkillsComponent(root);
    case "extensions": return uninstallExtensionsComponent(root);
    case "controller": return uninstallControllerComponent(root);
    case "mcp-config": return uninstallMcpConfigComponent(root);
    case "models": return uninstallModelsComponent(root);
  }
}

export async function uninstallPiStack(
  projectRoot?: string,
  tools?: string[]
): Promise<{
  success: boolean;
  message: string;
  removed: string[];
}> {
  const root = projectRoot ?? findProjectRoot();
  const piDir = join(root, ".pi");

  if (!existsSync(piDir)) {
    return { success: true, message: "PiStack no estaba instalado", removed: [] };
  }

  // Sin selección → desinstalación completa (comportamiento original)
  if (!tools || tools.length === 0) {
    const removed: string[] = [];
    const codegraphDir = join(root, ".codegraph");
    if (existsSync(codegraphDir)) {
      rmSync(codegraphDir, { recursive: true, force: true });
      removed.push(".codegraph/");
    }
    rmSync(piDir, { recursive: true, force: true });
    removed.push(".pi/");
    return { success: true, message: "PiStack desinstalado", removed };
  }

  // Con selección → desinstalar componentes individuales
  const valid = validateComponents(tools);
  if (valid === null) {
    return {
      success: false,
      message: `Componente(s) inválido(s): ${tools.join(", ")}. Válidos: ${COMPONENTS.join(", ")}`,
      removed: [],
    };
  }

  const removed: string[] = [];
  for (const name of valid) {
    const items = await uninstallComponent(name, root);
    if (items.length > 0) removed.push(...items);
    else removed.push(`${name}: no estaba instalado`);
  }

  return {
    success: true,
    message: removed.length > 0 ? "Componentes desinstalados" : "Nada para desinstalar",
    removed,
  };
}

// ─── Estado (list) ────────────────────────────────────────────────────────────

export function listComponents(projectRoot?: string): Record<string, { installed: boolean; detail: string }> {
  const root = projectRoot ?? findProjectRoot();
  const piDir = join(root, ".pi");
  const exists = (p: string): boolean => existsSync(join(piDir, p));
  const hasFiles = (p: string): boolean => {
    const dir = join(piDir, p);
    if (!existsSync(dir)) return false;
    return readdirSync(dir).some((entry) => statSync(join(dir, entry)).isFile());
  };
  const hasSkills = (): boolean => {
    const skillsDir = join(piDir, "skills");
    if (!existsSync(skillsDir)) return false;
    return readdirSync(skillsDir).some((skill) => existsSync(join(skillsDir, skill, "SKILL.md")));
  };

  const status: Record<string, { installed: boolean; detail: string }> = {
    "pi-mcp-adapter": { installed: false, detail: "no verificable localmente (gestionado por PI)" },
    codegraph: { installed: exists("tools/codegraph/bin/codegraph"), detail: ".pi/tools/codegraph/" },
    engram: { installed: exists("tools/engram/bin/engram"), detail: ".pi/tools/engram/" },
    agents: { installed: exists("AGENTS.md"), detail: ".pi/AGENTS.md" },
    skills: { installed: hasSkills(), detail: ".pi/skills/" },
    extensions: { installed: hasFiles("extensions"), detail: ".pi/extensions/" },
    controller: { installed: exists("tools/pistack-controller"), detail: ".pi/tools/pistack-controller/" },
    "mcp-config": { installed: exists("mcp.json"), detail: ".pi/mcp.json" },
    models: { installed: exists("models.json"), detail: ".pi/models.json" },
  };

  // Marcar si .pi no existe
  if (!existsSync(piDir)) {
    for (const key of Object.keys(status)) {
      status[key].installed = false;
    }
  }

  return status;
}

async function loadManifest(): Promise<Manifest> {
  const manifestPath = join(PACKAGE_ROOT, "manifest.json");
  return JSON.parse(readFileSync(manifestPath, "utf-8"));
}
