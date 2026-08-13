import {
    existsSync,
    mkdirSync,
    writeFileSync,
    readFileSync,
    copyFileSync,
    rmSync,
    renameSync,
    readdirSync,
    statSync,
} from 'fs';
import { homedir } from 'os';
import { createHash } from 'crypto';
import { join, resolve, dirname, relative } from 'path';
import { fileURLToPath } from 'url';
import { createInterface } from 'readline';
import { $ } from 'bun';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(__dirname, '..');
const ASSETS_DIR = join(PACKAGE_ROOT, 'assets');

export interface PiStackPaths {
    root: string;
    skills: string;
    extensions: string;
    bin: string;
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
    | 'pi-mcp-adapter'
    | 'codegraph'
    | 'engram'
    | 'agents'
    | 'skills'
    | 'extensions'
    | 'controller'
    | 'mcp-config'
    | 'models';

export const COMPONENTS: ComponentName[] = [
    'pi-mcp-adapter',
    'codegraph',
    'engram',
    'agents',
    'skills',
    'extensions',
    'controller',
    'mcp-config',
    'models',
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
        const piDir = join(current, '.pi');
        if (existsSync(piDir)) return piDir;

        if (existsSync(join(current, '.git'))) return null;

        const parent = dirname(current);
        if (parent === current) return null;
        current = parent;
    }
}

export function findProjectRoot(startDir: string = process.cwd()): string {
    const start = resolve(startDir);
    let current = start;
    while (true) {
        const parent = dirname(current);
        // El home y la raíz del sistema NUNCA son destinos válidos: si no hay
        // proyecto en el camino, el directorio actual ES el destino.
        if (parent === current || current === resolve(homedir()) || current === resolve('/')) {
            return start;
        }
        if (existsSync(join(current, '.pi')) || existsSync(join(current, '.git'))) {
            return current;
        }
        current = parent;
    }
}

/**
 * Valida que el destino no sea el home directory ni la raíz del sistema.
 * CodeGraph rechaza inicializarse ahí y es un destino inválido para .pi/.
 */
export function isValidInstallRoot(root: string): boolean {
    const homeDir = resolve(homedir());
    return root !== homeDir && root !== resolve('/');
}

export function ensurePiPaths(piDir: string): PiStackPaths {
    const paths: PiStackPaths = {
        root: piDir,
        skills: join(piDir, 'skills'),
        extensions: join(piDir, 'extensions'),
        bin: join(piDir, 'bin'),
    };
    for (const dir of Object.values(paths)) {
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    }
    return paths;
}

export function createPiDir(baseDir: string): PiStackPaths {
    return ensurePiPaths(join(baseDir, '.pi'));
}

/**
 * PI 0.35+ deprecó la carpeta .pi/tools/ (custom tools → extensions) y muestra
 * warnings de migración si existe. Mueve una instalación vieja de .pi/tools/ a
 * .pi/bin/ (los binarios se preservan; mcp.json se regenera en el install).
 */
export function migrateLegacyToolsDir(root: string): void {
    const piDir = join(root, '.pi');
    const legacy = join(piDir, 'tools');
    const bin = join(piDir, 'bin');
    if (!existsSync(legacy)) return;
    if (existsSync(bin)) {
        rmSync(legacy, { recursive: true, force: true });
    } else {
        renameSync(legacy, bin);
    }
}

export function copyDirRecursive(src: string, dest: string, skipGenerated: boolean = false): void {
    if (!existsSync(dest)) mkdirSync(dest, { recursive: true });
    for (const entry of readdirSync(src)) {
        if (skipGenerated && (entry === 'node_modules' || entry === 'package-lock.json')) continue;
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

/**
 * Copia solo archivos de extensión válidos (*.ts que NO sean .d.ts ni tsconfig.json).
 * Pi espera que cada archivo en .pi/extensions/ exporte una factory function.
 * Los .d.ts son solo tipos y tsconfig.json es de soporte — ninguno tiene runtime code.
 */
export function copyExtensionsDir(src: string, dest: string): void {
    if (!existsSync(dest)) mkdirSync(dest, { recursive: true });
    for (const entry of readdirSync(src)) {
        if (entry.endsWith('.d.ts') || entry === 'tsconfig.json') continue;
        const srcPath = join(src, entry);
        const destPath = join(dest, entry);
        const stat = statSync(srcPath);
        if (stat.isDirectory()) {
            copyExtensionsDir(srcPath, destPath);
        } else {
            copyFileSync(srcPath, destPath);
        }
    }
}

function sha256(content: string): string {
    return createHash('sha256').update(content, 'utf-8').digest('hex');
}

export function computeTreeHash(dir: string): string {
    const lines: string[] = [];
    walkForHash(dir, dir, lines);
    const combined = lines.sort().join('\n');
    return createHash('sha256').update(combined, 'utf-8').digest('hex');
}

function walkForHash(root: string, current: string, lines: string[]): void {
    for (const entry of readdirSync(current)) {
        if (entry === 'node_modules' || entry === 'package-lock.json') continue;
        const full = join(current, entry);
        const stat = statSync(full);
        if (stat.isDirectory()) {
            walkForHash(root, full, lines);
        } else {
            const rel = relative(root, full);
            const content = readFileSync(full, 'utf-8');
            lines.push(`${rel}:${sha256(content)}`);
        }
    }
}

// ─── Lockfile helpers ─────────────────────────────────────────────────────────

function readLockfile(piDir: string): Lockfile | null {
    const lockPath = join(piDir, 'pistack-lock.json');
    if (!existsSync(lockPath)) return null;
    try {
        return JSON.parse(readFileSync(lockPath, 'utf-8'));
    } catch {
        return null;
    }
}

function writeLockfile(piDir: string, lock: Lockfile): void {
    const lockPath = join(piDir, 'pistack-lock.json');
    writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n', 'utf-8');
}

function upsertLockfile(
    paths: PiStackPaths,
    type: 'agents' | 'commands' | 'skills' | 'mcpServers' | 'models',
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
    const mcpPath = join(piDir, 'mcp.json');
    if (!existsSync(mcpPath)) return;
    try {
        const config = JSON.parse(readFileSync(mcpPath, 'utf-8'));
        if (config.mcpServers && config.mcpServers[name]) {
            delete config.mcpServers[name];
            writeFileSync(mcpPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
        }
    } catch {
        // mcp.json corrupto — no es fatal
    }
}

// ─── Cross-platform helpers ───────────────────────────────────────────────────

/** ¿Estamos en Windows? */
function isWindows(): boolean {
    return process.platform === 'win32';
}

/** Nombre del binario según plataforma (los ejecutables de Windows llevan .exe). */
function getBinaryName(base: string): string {
    return isWindows() ? `${base}.exe` : base;
}

/**
 * Nombre del asset de CodeGraph para la plataforma/arquitectura actual.
 * Assets publicados: codegraph-{darwin|linux|win32}-{x64|arm64}.{tar.gz|zip}
 */
function getCodeGraphAssetName(): string {
    const ext = isWindows() ? 'zip' : 'tar.gz';
    return `codegraph-${process.platform}-${process.arch}.${ext}`;
}

/**
 * Nombre del asset de Engram para la plataforma/arquitectura actual.
 * Assets publicados: engram_{version}_{darwin|linux|windows}_{amd64|arm64}.{tar.gz|zip}
 */
function getEngramAssetName(versionNum: string): string {
    const arch = process.arch === 'arm64' ? 'arm64' : 'amd64';
    const platform = isWindows() ? 'windows' : process.platform;
    const ext = isWindows() ? 'zip' : 'tar.gz';
    return `engram_${versionNum}_${platform}_${arch}.${ext}`;
}

/**
 * Descomprime un archivo descargado usando tar (disponible nativamente en
 * Windows 10+ y todas las versiones de Unix). tar soporta tanto .tar.gz
 * como .zip, eliminando la dependencia de PowerShell.
 * El archivo original se elimina después de extraer.
 */
async function extractArchive(archivePath: string, destDir: string): Promise<void> {
    await $`tar -xf ${archivePath} -C ${destDir}`.quiet();
    rmSync(archivePath, { force: true });
}

/**
 * Si el directorio extraído contiene una única subcarpeta de archive
 * (ej: codegraph-linux-x64/), la aplana moviendo su contenido al nivel superior.
 *
 * Ignora directorios pre-existentes (ej: bin/ creado antes de la extracción)
 * para no confundirlos con la estructura del archive.
 */
function flattenExtractedDir(destDir: string): void {
    const entries = readdirSync(destDir);
    // Buscar la carpeta del archive: debe ser la única entrada que es directorio
    // y cuyo nombre sugiere que viene de un archive (contiene '-' o '_' con plataforma).
    // Si hay exactamente 1 directorio y el resto son archivos o no existen, aplanar.
    const dirs = entries.filter((e) => {
        const full = join(destDir, e);
        return statSync(full).isDirectory();
    });

    if (dirs.length === 1) {
        const only = join(destDir, dirs[0]);
        for (const inner of readdirSync(only)) {
            renameSync(join(only, inner), join(destDir, inner));
        }
        rmSync(only, { recursive: true, force: true });
    }
}

/** chmod +x solo en Unix — en Windows no existe y no hace falta. */
async function chmodIfUnix(filePath: string): Promise<void> {
    if (!isWindows()) {
        await $`chmod +x ${filePath}`.quiet();
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

/** Descarga con retry y backoff exponencial (1s, 2s, 3s). */
async function downloadWithRetry(
    url: string,
    dest: string,
    maxSize: number = 100_000_000,
    maxRetries = 3
): Promise<void> {
    let lastError: Error | undefined;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            await downloadFile(url, dest, maxSize);
            return;
        } catch (e) {
            lastError = e instanceof Error ? e : new Error(String(e));
            if (attempt < maxRetries) {
                await new Promise((r) => setTimeout(r, attempt * 1000));
            }
        }
    }
    throw lastError;
}

/**
 * Valida que un binario exista y sea ejecutable.
 * En Windows, si falla la ejecución directa, intenta con cmd /c como fallback
 * (resuelve problemas de permisos NTFS y Windows Defender).
 */
async function validateBinary(localBin: string): Promise<boolean> {
    if (!existsSync(localBin)) return false;
    try {
        await $`${localBin} --version`.quiet();
        return true;
    } catch {
        if (!isWindows()) return false;
        try {
            await $`cmd /c "${localBin}" --version`.quiet();
            return true;
        } catch {
            return false;
        }
    }
}

// ─── Instalación de PI (si no está instalado) ────────────────────────────────

/** ¿Existe un comando en el PATH? */
function commandExists(cmd: string): boolean {
    return Bun.which(cmd) !== null;
}

/** Pide input al usuario (solo si hay terminal interactiva). null si no hay TTY. */
function promptInput(question: string): Promise<string | null> {
    if (!process.stdin.isTTY) return Promise.resolve(null);
    return new Promise((resolve) => {
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        rl.question(question, (answer) => {
            rl.close();
            resolve(answer.trim());
        });
    });
}

/**
 * Ofrece instalar PI (@earendil-works/pi-coding-agent) si no está instalado.
 * Nunca instala sin preguntar. Devuelve true si PI quedó disponible.
 */
async function installPiIfNeeded(): Promise<boolean> {
    try {
        await $`pi --version`.quiet();
        return true; // PI ya está instalado
    } catch {
        // PI no está → ofrecer instalarlo
    }

    console.log('\n⚠️  PI no está instalado.');
    console.log('PiStack requiere PI (@earendil-works/pi-coding-agent).');

    const hasBun = commandExists('bun');
    const hasNpm = commandExists('npm');
    const hasCurl = !isWindows() && commandExists('curl');

    if (!hasBun && !hasNpm && !hasCurl) {
        console.log('❌ No se detectó bun, npm ni curl. Instalá PI manualmente: https://pi.dev');
        return false;
    }

    const options: { label: string; args: string[]; shell?: boolean }[] = [];
    if (hasBun) {
        options.push({
            label: 'bun add -g @earendil-works/pi-coding-agent (recomendado)',
            args: ['bun', 'add', '-g', '@earendil-works/pi-coding-agent'],
        });
    }
    if (hasNpm) {
        options.push({
            label: 'npm install -g @earendil-works/pi-coding-agent',
            args: ['npm', 'install', '-g', '@earendil-works/pi-coding-agent'],
        });
    }
    if (hasCurl) {
        options.push({
            label: 'curl -fsSL https://pi.dev/install.sh | sh',
            args: ['curl -fsSL https://pi.dev/install.sh | sh'],
            shell: true,
        });
    }

    console.log('\nOpciones de instalación:');
    options.forEach((opt, i) => console.log(`  ${i + 1}. ${opt.label}`));
    console.log(`  ${options.length + 1}. Cancelar (instalar PI manualmente después)`);

    const answer = await promptInput(`\nElegí una opción (1-${options.length + 1}): `);
    if (answer === null) {
        console.log('❌ Sin terminal interactiva. Instalá PI manualmente: https://pi.dev');
        return false;
    }
    const choice = Number(answer);
    if (!Number.isInteger(choice) || choice < 1 || choice > options.length + 1) {
        console.log('❌ Opción inválida. Instalá PI manualmente: https://pi.dev');
        return false;
    }
    if (choice === options.length + 1) {
        console.log('❌ Instalación de PI cancelada por el usuario.');
        return false;
    }

    const opt = options[choice - 1];
    console.log(`\n🚀 Instalando PI: ${opt.label}`);
    let exitCode = 1;
    try {
        if (opt.shell) {
            exitCode = await $.shell(opt.args[0]).exited;
        } else {
            const [bin, ...rest] = opt.args;
            exitCode = await Bun.spawn([bin, ...rest], { stdout: 'inherit', stderr: 'inherit' }).exited;
        }
    } catch {
        exitCode = 1;
    }
    if (exitCode !== 0) {
        console.log('❌ Falló la instalación de PI. Instalalo manualmente: https://pi.dev');
        return false;
    }

    try {
        const piVersion = await $`pi --version`.text();
        console.log(`✅ PI instalado correctamente (${piVersion.trim()}).`);
        return true;
    } catch {
        console.log('❌ No se pudo verificar PI tras la instalación. Instalalo manualmente: https://pi.dev');
        return false;
    }
}

// ─── Install por componente ───────────────────────────────────────────────────

export async function installPiMcpAdapterComponent(): Promise<ComponentDetail> {
    try {
        await $`pi install npm:pi-mcp-adapter`.quiet();
        return { success: true, message: 'pi-mcp-adapter instalado' };
    } catch (e) {
        return { success: false, message: `Error instalando pi-mcp-adapter: ${e}` };
    }
}

export async function installCodeGraphComponent(toolsDir: string, projectRoot: string): Promise<ComponentDetail> {
    const cgToolDir = join(toolsDir, 'codegraph');
    const cgBinDir = join(cgToolDir, 'bin');
    const binName = getBinaryName('codegraph');
    const localBin = join(cgBinDir, binName);

    // Verificar si el binario actual es válido (Fix 2: validación antes de usar)
    if (await validateBinary(localBin)) {
        // Binario OK — continuar directo
    } else if (existsSync(localBin)) {
        // Binario corrupto/incompatible: limpieza TOTAL del tool dir
        try {
            rmSync(cgToolDir, { recursive: true, force: true });
        } catch {}
    }

    if (!existsSync(localBin)) {
        try {
            const tagResponse = await fetch('https://api.github.com/repos/colbymchenry/codegraph/releases/latest');
            const tagData = await tagResponse.json();
            const tag = tagData.tag_name || 'v1.5.0';

            const assetName = getCodeGraphAssetName();
            const url = `https://github.com/colbymchenry/codegraph/releases/download/${tag}/${assetName}`;

            // Fix 5: staging atómico — extraer a directorio temporal, validar, promover
            const stagingDir = `${cgToolDir}.staging`;
            try {
                rmSync(stagingDir, { recursive: true, force: true });
            } catch {}
            mkdirSync(stagingDir, { recursive: true });

            try {
                const archivePath = join(stagingDir, assetName);
                // Fix 4: retry con backoff para descargas
                await downloadWithRetry(url, archivePath, 200_000_000);
                await extractArchive(archivePath, stagingDir);
                flattenExtractedDir(stagingDir);

                // Buscar el binario en las ubicaciones posibles tras flatten
                const stagingBinDir = join(stagingDir, 'bin');
                if (!existsSync(stagingBinDir)) mkdirSync(stagingBinDir, { recursive: true });
                const binInStagingBin = join(stagingBinDir, binName);
                const binInStagingRoot = join(stagingDir, binName);
                if (existsSync(binInStagingBin)) {
                    // OK — ya está en bin/
                } else if (existsSync(binInStagingRoot)) {
                    renameSync(binInStagingRoot, binInStagingBin);
                }

                // Fix 2: validar binario antes de promover
                if (!(await validateBinary(binInStagingBin))) {
                    throw new Error(
                        `Binario CodeGraph no ejecutable. En Windows: verificar Visual C++ Redistributable.`
                    );
                }

                // Promover atómicamente: limpiar dir viejo → renombrar staging
                if (existsSync(cgToolDir)) rmSync(cgToolDir, { recursive: true, force: true });
                renameSync(stagingDir, cgToolDir);
            } catch (e) {
                // Limpiar staging en caso de fallo
                try {
                    rmSync(stagingDir, { recursive: true, force: true });
                } catch {}
                return { success: false, message: `Error instalando CodeGraph: ${e}` };
            }
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

    return { success: true, message: `CodeGraph instalado e inicializado (.pi/bin/codegraph/${binName})` };
}

export async function installEngramComponent(toolsDir: string): Promise<ComponentDetail> {
    const egToolDir = join(toolsDir, 'engram');
    const egBinDir = join(egToolDir, 'bin');
    const binName = getBinaryName('engram');
    const localBin = join(egBinDir, binName);

    // Verificar si el binario actual es válido (Fix 2: validación antes de usar)
    if (await validateBinary(localBin)) {
        // Binario OK — continuar directo
    } else if (existsSync(localBin)) {
        // Binario corrupto/incompatible: limpieza TOTAL del tool dir
        try {
            rmSync(egToolDir, { recursive: true, force: true });
        } catch {}
    }

    if (!existsSync(localBin)) {
        try {
            const tagResponse = await fetch(
                'https://api.github.com/repos/Gentleman-Programming/engram/releases/latest'
            );
            const tagData = await tagResponse.json();
            const tag = tagData.tag_name || 'v1.20.0';
            const versionNum = tag.replace('v', '');

            const assetName = getEngramAssetName(versionNum);
            const url = `https://github.com/Gentleman-Programming/engram/releases/download/${tag}/${assetName}`;

            // Fix 5: staging atómico — extraer a directorio temporal, validar, promover
            const stagingDir = `${egToolDir}.staging`;
            try {
                rmSync(stagingDir, { recursive: true, force: true });
            } catch {}
            mkdirSync(stagingDir, { recursive: true });

            try {
                const archivePath = join(stagingDir, assetName);
                // Fix 4: retry con backoff para descargas
                await downloadWithRetry(url, archivePath, 50_000_000);
                await extractArchive(archivePath, stagingDir);
                flattenExtractedDir(stagingDir);

                // Buscar el binario en las ubicaciones posibles tras flatten
                const stagingBinDir = join(stagingDir, 'bin');
                if (!existsSync(stagingBinDir)) mkdirSync(stagingBinDir, { recursive: true });
                const binInStagingBin = join(stagingBinDir, binName);
                const binInStagingRoot = join(stagingDir, binName);
                if (existsSync(binInStagingBin)) {
                    // OK — ya está en bin/
                } else if (existsSync(binInStagingRoot)) {
                    renameSync(binInStagingRoot, binInStagingBin);
                }

                // Fix 2: validar binario antes de promover
                if (!(await validateBinary(binInStagingBin))) {
                    throw new Error(`Binario Engram no ejecutable. En Windows: verificar Visual C++ Redistributable.`);
                }

                // Promover atómicamente: limpiar dir viejo → renombrar staging
                if (existsSync(egToolDir)) rmSync(egToolDir, { recursive: true, force: true });
                renameSync(stagingDir, egToolDir);
            } catch (e) {
                // Limpiar staging en caso de fallo
                try {
                    rmSync(stagingDir, { recursive: true, force: true });
                } catch {}
                return { success: false, message: `Error instalando Engram: ${e}` };
            }
        } catch (e) {
            return { success: false, message: `Error instalando Engram: ${e}` };
        }
    }

    return { success: true, message: `Engram instalado (.pi/bin/engram/${binName})` };
}

export function installAgentsComponent(piDir: PiStackPaths, manifest: Manifest): ComponentDetail {
    try {
        for (const agent of manifest.agents) {
            // agent.file ya incluye "assets/" (ej: "assets/AGENTS.md")
            // ASSETS_DIR ya apunta a la carpeta assets, así que usamos solo el nombre del archivo
            const fileName = agent.file.replace(/^assets\//, '');
            const srcPath = join(ASSETS_DIR, fileName);
            const destPath = join(piDir.root, fileName);
            copyFileSync(srcPath, destPath);
            const content = readFileSync(srcPath, 'utf-8');
            const hash = sha256(content);
            upsertLockfile(
                piDir,
                'agents',
                {
                    name: agent.name,
                    file: agent.file,
                    description: agent.description,
                    version: agent.version,
                    sha256: hash,
                },
                manifest,
                hash
            );
        }
        return { success: true, message: `${manifest.agents.length} agent(s) instalados` };
    } catch (e) {
        return { success: false, message: `Error copiando agents: ${e}` };
    }
}

export function installSkillsComponent(piDir: PiStackPaths, manifest: Manifest): ComponentDetail {
    try {
        copyDirRecursive(join(ASSETS_DIR, 'skills'), join(piDir.root, 'skills'));
        const skillsDir = join(ASSETS_DIR, 'skills');
        for (const skillName of readdirSync(skillsDir)) {
            const skillPath = join(skillsDir, skillName, 'SKILL.md');
            if (existsSync(skillPath)) {
                const content = readFileSync(skillPath, 'utf-8');
                const hash = sha256(content);
                upsertLockfile(
                    piDir,
                    'skills',
                    {
                        name: skillName,
                        file: `skills/${skillName}/SKILL.md`,
                        description: `Skill: ${skillName}`,
                        version: manifest.version,
                        sha256: hash,
                    },
                    manifest,
                    hash
                );
            }
        }
        return { success: true, message: `${readdirSync(skillsDir).length} skills instaladas` };
    } catch (e) {
        return { success: false, message: `Error instalando skills: ${e}` };
    }
}

export function installExtensionsComponent(piDir: PiStackPaths): ComponentDetail {
    try {
        copyExtensionsDir(join(ASSETS_DIR, 'extensions'), join(piDir.root, 'extensions'));
        return { success: true, message: 'Extensions instaladas' };
    } catch (e) {
        return { success: false, message: `Error instalando extensions: ${e}` };
    }
}

export function installControllerComponent(piDir: PiStackPaths): ComponentDetail {
    try {
        const srcDir = join(ASSETS_DIR, 'tools', 'pistack-controller');
        const destDir = join(piDir.bin, 'pistack-controller');
        // Copia solo el bundle autónomo (index.js) y su package.json.
        // NO se copia src/ (fuente) ni node_modules: el bundle embebe las deps.
        mkdirSync(destDir, { recursive: true });
        copyFileSync(join(srcDir, 'index.js'), join(destDir, 'index.js'));
        copyFileSync(join(srcDir, 'package.json'), join(destDir, 'package.json'));
        return { success: true, message: 'Controller MCP instalado (bundle autónomo)' };
    } catch (e) {
        return { success: false, message: `Error instalando controller: ${e}` };
    }
}

export function installMcpConfigComponent(piDir: PiStackPaths, manifest: Manifest): ComponentDetail {
    try {
        const cgBinName = getBinaryName('codegraph');
        const egBinName = getBinaryName('engram');
        const mcpConfig = {
            settings: { toolPrefix: 'none' },
            mcpServers: {
                'pistack-controller': {
                    command: 'node',
                    args: ['.pi/bin/pistack-controller/index.js'],
                    lifecycle: 'keep-alive',
                    directTools: true,
                },
                codegraph: {
                    command: `.pi/bin/codegraph/bin/${cgBinName}`,
                    args: ['serve', '--mcp'],
                    lifecycle: 'lazy',
                    directTools: true,
                },
                engram: {
                    command: `.pi/bin/engram/bin/${egBinName}`,
                    args: ['mcp'],
                    lifecycle: 'lazy',
                    directTools: ['mem_context', 'mem_search', 'mem_save', 'mem_session_summary'],
                },
                context7: {
                    url: 'https://mcp.context7.com/mcp',
                    lifecycle: 'lazy',
                },
            },
        };
        writeFileSync(join(piDir.root, 'mcp.json'), JSON.stringify(mcpConfig, null, 2) + '\n', 'utf-8');
        const mcpHash = sha256(JSON.stringify(mcpConfig));
        upsertLockfile(
            piDir,
            'mcpServers',
            {
                name: 'mcp-config',
                file: 'mcp.json',
                description: 'Configuración MCP para PiStack',
                version: manifest.version,
                sha256: mcpHash,
            },
            manifest,
            mcpHash
        );
        return { success: true, message: '.pi/mcp.json creado' };
    } catch (e) {
        return { success: false, message: `Error creando mcp.json: ${e}` };
    }
}

export function installModelsComponent(piDir: PiStackPaths, manifest: Manifest): ComponentDetail {
    try {
        const templatePath = join(ASSETS_DIR, 'models.json.template');
        const destPath = join(piDir.root, 'models.json');
        if (existsSync(templatePath) && !existsSync(destPath)) {
            copyFileSync(templatePath, destPath);
            const content = readFileSync(templatePath, 'utf-8');
            const hash = sha256(content);
            upsertLockfile(
                piDir,
                'models',
                {
                    name: 'models-template',
                    file: 'models.json',
                    description: 'Template para proveedores locales (Ollama, LM Studio, OpenCode Server)',
                    version: manifest.version,
                    sha256: hash,
                },
                manifest,
                hash
            );
            return { success: true, message: '.pi/models.json creado (configurar variables en .env)' };
        }
        return { success: true, message: '.pi/models.json ya existe, se omite' };
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
        case 'pi-mcp-adapter':
            return installPiMcpAdapterComponent();
        case 'codegraph':
            return installCodeGraphComponent(piDir.bin, projectRoot);
        case 'engram':
            return installEngramComponent(piDir.bin);
        case 'agents':
            return installAgentsComponent(piDir, manifest);
        case 'skills':
            return installSkillsComponent(piDir, manifest);
        case 'extensions':
            return installExtensionsComponent(piDir);
        case 'controller':
            return installControllerComponent(piDir);
        case 'mcp-config':
            return installMcpConfigComponent(piDir, manifest);
        case 'models':
            return installModelsComponent(piDir, manifest);
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
                `No se puede instalar PiStack en ${root} (directorio del sistema).\n` +
                `Esto suele pasar cuando hay un .pi/ residual en tu home (de una instalación previa).\n` +
                `  1. Eliminalo: rm -rf ${join(homedir(), '.pi')}\n` +
                `  2. Ejecutá el instalador dentro de un directorio de proyecto:\n` +
                `     cd tu-proyecto && npx pistack install`,
            details: {},
        };
    }

    let selected: ComponentName[];
    if (tools && tools.length > 0) {
        const valid = validateComponents(tools);
        if (valid === null) {
            return {
                success: false,
                message: `Componente(s) inválido(s): ${tools.join(', ')}. Válidos: ${COMPONENTS.join(', ')}`,
                details: {},
            };
        }
        selected = valid;
    } else {
        selected = [...COMPONENTS];
    }

    // Migración: PI 0.35+ deprecó .pi/tools/ (custom tools → extensions) y emite
    // warnings si la carpeta existe. Nuestros binarios viven en .pi/bin/ desde 0.0.13.
    migrateLegacyToolsDir(root);

    const piDir = createPiDir(root);
    const manifest = await loadManifest();

    console.log(`🚀 Instalando PiStack v${manifest.version} en ${root}`);
    console.log(`   Componentes: ${selected.join(', ')}\n`);

    const details: Record<string, ComponentDetail> = {};

    // 1. Verificar PI (precondición de todo el stack) — ofrecer instalarlo si falta
    try {
        const piVersion = await $`pi --version`.text();
        details.pi = { success: true, message: `PI detectado: ${piVersion.trim()}` };
    } catch {
        const piReady = await installPiIfNeeded();
        if (!piReady) {
            details.pi = { success: false, message: 'PI no encontrado. Instalá PI primero.' };
            return { success: false, message: 'PI no instalado', details };
        }
        const piVersion = await $`pi --version`.text();
        details.pi = { success: true, message: `PI instalado: ${piVersion.trim()}` };
    }

    // 2. Instalar componentes seleccionados
    for (const name of selected) {
        details[name] = await installComponent(name, piDir, manifest, root);
    }

    const allSuccess = Object.values(details).every((d) => d.success);
    return {
        success: allSuccess,
        message: allSuccess ? '✅ PiStack instalado correctamente' : '⚠️ PiStack instalado con advertencias',
        details,
    };
}

// ─── Uninstall por componente ─────────────────────────────────────────────────

export function uninstallAgentsComponent(root: string): string[] {
    const removed: string[] = [];
    const p = join(root, '.pi', 'AGENTS.md');
    if (existsSync(p)) {
        rmSync(p, { force: true });
        removed.push('.pi/AGENTS.md');
    }
    return removed;
}

export function uninstallSkillsComponent(root: string): string[] {
    const removed: string[] = [];
    const p = join(root, '.pi', 'skills');
    if (existsSync(p)) {
        rmSync(p, { recursive: true, force: true });
        removed.push('.pi/skills/');
    }
    return removed;
}

export function uninstallExtensionsComponent(root: string): string[] {
    const removed: string[] = [];
    const p = join(root, '.pi', 'extensions');
    if (existsSync(p)) {
        rmSync(p, { recursive: true, force: true });
        removed.push('.pi/extensions/');
    }
    return removed;
}

export function uninstallControllerComponent(root: string): string[] {
    const removed: string[] = [];
    const p = join(root, '.pi', 'tools', 'pistack-controller');
    if (existsSync(p)) {
        rmSync(p, { recursive: true, force: true });
        removed.push('.pi/bin/pistack-controller/');
    }
    removeMcpEntry(join(root, '.pi'), 'pistack-controller');
    return removed;
}

export function uninstallCodeGraphComponent(root: string): string[] {
    const removed: string[] = [];
    const toolDir = join(root, '.pi', 'tools', 'codegraph');
    if (existsSync(toolDir)) {
        rmSync(toolDir, { recursive: true, force: true });
        removed.push('.pi/bin/codegraph/');
    }
    const indexDir = join(root, '.codegraph');
    if (existsSync(indexDir)) {
        rmSync(indexDir, { recursive: true, force: true });
        removed.push('.codegraph/');
    }
    removeMcpEntry(join(root, '.pi'), 'codegraph');
    return removed;
}

export function uninstallEngramComponent(root: string): string[] {
    const removed: string[] = [];
    const p = join(root, '.pi', 'tools', 'engram');
    if (existsSync(p)) {
        rmSync(p, { recursive: true, force: true });
        removed.push('.pi/bin/engram/');
    }
    removeMcpEntry(join(root, '.pi'), 'engram');
    return removed;
}

export function uninstallMcpConfigComponent(root: string): string[] {
    const removed: string[] = [];
    const p = join(root, '.pi', 'mcp.json');
    if (existsSync(p)) {
        rmSync(p, { force: true });
        removed.push('.pi/mcp.json');
    }
    return removed;
}

export function uninstallModelsComponent(root: string): string[] {
    const removed: string[] = [];
    const p = join(root, '.pi', 'models.json');
    if (existsSync(p)) {
        rmSync(p, { force: true });
        removed.push('.pi/models.json');
    }
    return removed;
}

export async function uninstallPiMcpAdapterComponent(): Promise<string[]> {
    try {
        await $`pi uninstall npm:pi-mcp-adapter`.quiet();
        return ['pi-mcp-adapter'];
    } catch {
        return [];
    }
}

export async function uninstallComponent(name: ComponentName, root: string): Promise<string[]> {
    switch (name) {
        case 'pi-mcp-adapter':
            return uninstallPiMcpAdapterComponent();
        case 'codegraph':
            return uninstallCodeGraphComponent(root);
        case 'engram':
            return uninstallEngramComponent(root);
        case 'agents':
            return uninstallAgentsComponent(root);
        case 'skills':
            return uninstallSkillsComponent(root);
        case 'extensions':
            return uninstallExtensionsComponent(root);
        case 'controller':
            return uninstallControllerComponent(root);
        case 'mcp-config':
            return uninstallMcpConfigComponent(root);
        case 'models':
            return uninstallModelsComponent(root);
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
    const piDir = join(root, '.pi');

    if (!existsSync(piDir)) {
        return { success: true, message: 'PiStack no estaba instalado', removed: [] };
    }

    // Sin selección → desinstalación completa (comportamiento original)
    if (!tools || tools.length === 0) {
        const removed: string[] = [];
        const codegraphDir = join(root, '.codegraph');
        if (existsSync(codegraphDir)) {
            rmSync(codegraphDir, { recursive: true, force: true });
            removed.push('.codegraph/');
        }
        rmSync(piDir, { recursive: true, force: true });
        removed.push('.pi/');
        return { success: true, message: 'PiStack desinstalado', removed };
    }

    // Con selección → desinstalar componentes individuales
    const valid = validateComponents(tools);
    if (valid === null) {
        return {
            success: false,
            message: `Componente(s) inválido(s): ${tools.join(', ')}. Válidos: ${COMPONENTS.join(', ')}`,
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
        message: removed.length > 0 ? 'Componentes desinstalados' : 'Nada para desinstalar',
        removed,
    };
}

// ─── Estado (list) ────────────────────────────────────────────────────────────

export function listComponents(projectRoot?: string): Record<string, { installed: boolean; detail: string }> {
    const root = projectRoot ?? findProjectRoot();
    const piDir = join(root, '.pi');
    const exists = (p: string): boolean => existsSync(join(piDir, p));
    const hasFiles = (p: string): boolean => {
        const dir = join(piDir, p);
        if (!existsSync(dir)) return false;
        return readdirSync(dir).some((entry) => statSync(join(dir, entry)).isFile());
    };
    const hasSkills = (): boolean => {
        const skillsDir = join(piDir, 'skills');
        if (!existsSync(skillsDir)) return false;
        return readdirSync(skillsDir).some((skill) => existsSync(join(skillsDir, skill, 'SKILL.md')));
    };

    const status: Record<string, { installed: boolean; detail: string }> = {
        'pi-mcp-adapter': { installed: false, detail: 'no verificable localmente (gestionado por PI)' },
        codegraph: { installed: exists('tools/codegraph/bin/codegraph'), detail: '.pi/bin/codegraph/' },
        engram: { installed: exists('tools/engram/bin/engram'), detail: '.pi/bin/engram/' },
        agents: { installed: exists('AGENTS.md'), detail: '.pi/AGENTS.md' },
        skills: { installed: hasSkills(), detail: '.pi/skills/' },
        extensions: { installed: hasFiles('extensions'), detail: '.pi/extensions/' },
        controller: { installed: exists('tools/pistack-controller'), detail: '.pi/bin/pistack-controller/' },
        'mcp-config': { installed: exists('mcp.json'), detail: '.pi/mcp.json' },
        models: { installed: exists('models.json'), detail: '.pi/models.json' },
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
    const manifestPath = join(PACKAGE_ROOT, 'manifest.json');
    return JSON.parse(readFileSync(manifestPath, 'utf-8'));
}
