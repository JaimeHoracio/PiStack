import { existsSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, rmSync, readdirSync, statSync } from "fs";
import { createHash } from "crypto";
import { join, resolve, dirname, relative } from "path";
import { fileURLToPath } from "url";

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

async function downloadFile(url: string, dest: string, maxSize: number = 100_000_000): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to download ${url}: ${response.statusText}`);
  const arrayBuffer = await response.arrayBuffer();
  if (arrayBuffer.byteLength > maxSize) throw new Error(`Download too large: ${arrayBuffer.byteLength} bytes`);
  writeFileSync(dest, Buffer.from(arrayBuffer));
}

async function installCodeGraph(toolsDir: string): Promise<{ success: boolean; message: string }> {
  const cgToolDir = join(toolsDir, "codegraph");
  const cgBinDir = join(cgToolDir, "bin");
  if (!existsSync(cgBinDir)) mkdirSync(cgBinDir, { recursive: true });

  const localBin = join(cgBinDir, "codegraph");
  if (existsSync(localBin)) {
    return { success: true, message: "CodeGraph ya instalado localmente" };
  }

  try {
    const tagResponse = await fetch("https://api.github.com/repos/colbymchenry/codegraph/releases/latest");
    const tagData = await tagResponse.json();
    const tag = tagData.tag_name || "v1.5.0";

    const url = `https://github.com/colbymchenry/codegraph/releases/download/${tag}/codegraph-linux-x64.tar.gz`;
    const tarPath = join(cgToolDir, "codegraph.tar.gz");

    await downloadFile(url, tarPath, 200_000_000);

    const { $ } = await import("bun");
    await $`tar -xzf ${tarPath} -C ${cgToolDir} && mv ${cgToolDir}/codegraph-linux-x64/* ${cgToolDir}/ && rm -rf ${cgToolDir}/codegraph-linux-x64 ${tarPath}`.cwd(cgToolDir);
    await $`chmod +x ${localBin}`;

    return { success: true, message: `CodeGraph ${tag} instalado en ${cgBinDir}` };
  } catch (e) {
    return { success: false, message: `Error instalando CodeGraph: ${e}` };
  }
}

async function installEngram(toolsDir: string): Promise<{ success: boolean; message: string }> {
  const egToolDir = join(toolsDir, "engram");
  const egBinDir = join(egToolDir, "bin");
  if (!existsSync(egBinDir)) mkdirSync(egBinDir, { recursive: true });

  const localBin = join(egBinDir, "engram");
  if (existsSync(localBin)) {
    return { success: true, message: "Engram ya instalado localmente" };
  }

  try {
    const tagResponse = await fetch("https://api.github.com/repos/Gentleman-Programming/engram/releases/latest");
    const tagData = await tagResponse.json();
    const tag = tagData.tag_name || "v1.20.0";
    const versionNum = tag.replace("v", "");

    const url = `https://github.com/Gentleman-Programming/engram/releases/download/${tag}/engram_${versionNum}_linux_amd64.tar.gz`;
    const tarPath = join(egToolDir, "engram.tar.gz");

    await downloadFile(url, tarPath, 50_000_000);

    const { $ } = await import("bun");
    await $`tar -xzf ${tarPath} -C ${egToolDir} && mv ${egToolDir}/engram ${localBin} && rm ${tarPath}`.cwd(egToolDir);
    await $`chmod +x ${localBin}`;

    return { success: true, message: `Engram ${tag} instalado en ${egBinDir}` };
  } catch (e) {
    return { success: false, message: `Error instalando Engram: ${e}` };
  }
}

async function installPiMcpAdapter(): Promise<{ success: boolean; message: string }> {
  try {
    const { $ } = await import("bun");
    await $`pi install npm:pi-mcp-adapter`.quiet();
    return { success: true, message: "pi-mcp-adapter instalado" };
  } catch (e) {
    return { success: false, message: `Error instalando pi-mcp-adapter: ${e}` };
  }
}

export async function installPiStack(projectRoot?: string): Promise<{
  success: boolean;
  message: string;
  details: Record<string, { success: boolean; message: string }>;
}> {
  const root = projectRoot ?? findProjectRoot();
  const piDir = createPiDir(root);
  const manifest = await loadManifest();

  console.log(`🚀 Instalando PiStack v${manifest.version} en ${root}`);

  const details: Record<string, { success: boolean; message: string }> = {};

  // 1. Verificar/instalar PI
  try {
    const { $ } = await import("bun");
    const piVersion = await $`pi --version`.text();
    details.pi = { success: true, message: `PI detectado: ${piVersion.trim()}` };
  } catch {
    details.pi = { success: false, message: "PI no encontrado. Instalá PI primero." };
    return { success: false, message: "PI no instalado", details };
  }

  // 2. Instalar pi-mcp-adapter
  details.piMcpAdapter = await installPiMcpAdapter();

  // 3. Instalar CodeGraph
  details.codegraph = await installCodeGraph(piDir.tools);

  // 4. Inicializar CodeGraph
  try {
    const { $ } = await import("bun");
    const cgBin = join(piDir.tools, "codegraph", "bin", "codegraph");
    await $`${cgBin} init -i`.cwd(root);
    details.codegraphInit = { success: true, message: "CodeGraph inicializado" };
  } catch (e) {
    details.codegraphInit = { success: false, message: `Error inicializando CodeGraph: ${e}` };
  }

  // 5. Instalar Engram
  details.engram = await installEngram(piDir.tools);

  // 6. Copiar AGENTS.md
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
    details.agents = { success: true, message: "AGENTS.md instalado" };
  } catch (e) {
    details.agents = { success: false, message: `Error copiando AGENTS.md: ${e}` };
  }

  // 7. Copiar skills
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
    details.skills = { success: true, message: `${readdirSync(skillsDir).length} skills instaladas` };
  } catch (e) {
    details.skills = { success: false, message: `Error instalando skills: ${e}` };
  }

  // 8. Copiar extensions
  try {
    copyDirRecursive(join(ASSETS_DIR, "extensions"), join(piDir.root, "extensions"));
    details.extensions = { success: true, message: "Extensions instaladas" };
  } catch (e) {
    details.extensions = { success: false, message: `Error instalando extensions: ${e}` };
  }

  // 9. Copiar controller MCP
  try {
    copyDirRecursive(join(ASSETS_DIR, "tools", "pistack-controller"), join(piDir.tools, "pistack-controller"), true);
    details.controller = { success: true, message: "Controller MCP instalado" };
  } catch (e) {
    details.controller = { success: false, message: `Error instalando controller: ${e}` };
  }

  // 10. Crear mcp.json
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
    details.mcpConfig = { success: true, message: ".pi/mcp.json creado" };
  } catch (e) {
    details.mcpConfig = { success: false, message: `Error creando mcp.json: ${e}` };
  }

  // 11. Crear models.json desde template
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
      details.models = { success: true, message: ".pi/models.json creado (configurar variables en .env)" };
    } else if (existsSync(destPath)) {
      details.models = { success: true, message: ".pi/models.json ya existe, se omite" };
    }
  } catch (e) {
    details.models = { success: false, message: `Error creando models.json: ${e}` };
  }

  const allSuccess = Object.values(details).every(d => d.success);
  return {
    success: allSuccess,
    message: allSuccess ? "✅ PiStack instalado correctamente" : "⚠️ PiStack instalado con advertencias",
    details,
  };
}

export async function uninstallPiStack(projectRoot?: string): Promise<{
  success: boolean;
  message: string;
  removed: string[];
}> {
  const root = projectRoot ?? findProjectRoot();
  const piDir = join(root, ".pi");

  if (!existsSync(piDir)) {
    return { success: true, message: "PiStack no estaba instalado", removed: [] };
  }

  const removed: string[] = [];

  // Remover .codegraph/
  const codegraphDir = join(root, ".codegraph");
  if (existsSync(codegraphDir)) {
    rmSync(codegraphDir, { recursive: true, force: true });
    removed.push(".codegraph/");
  }

  // Remover .pi/
  rmSync(piDir, { recursive: true, force: true });
  removed.push(".pi/");

  return { success: true, message: "PiStack desinstalado", removed };
}

async function loadManifest(): Promise<Manifest> {
  const manifestPath = join(PACKAGE_ROOT, "manifest.json");
  return JSON.parse(readFileSync(manifestPath, "utf-8"));
}
