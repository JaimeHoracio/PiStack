# PiStack v0.0.4

Agent Harness para [PI](https://pi.dev) — orquestador de código con machine states, clasificación por niveles, y gestión de herramientas MCP.

**Repo:** [JaimeHoracio/PiStack](https://github.com/JaimeHoracio/PiStack)

## Qué es

PiStack es un agent harness que convierte PI en un orquestador de código sofisticado:

- **3 niveles de clasificación** — trivial (directo), chico (usuario elige), complejo (OpenSpec)
- **Controller MCP** — máquina de estados persistida que valida transiciones
- **Skills curadas** — TDD, review, writing-plans, execution-mode-evaluation, y más
- **MCP integration** — CodeGraph, Engram, Context7 vía pi-mcp-adapter
- **Seguridad** — protección de archivos con credenciales
- **Robustez** — manejo de fallos del LLM, skills, y herramientas
- **Proveedores locales opcionales** — Ollama, LM Studio, OpenCode Server via variables de entorno

## Instalación

### Requisitos

- [PI](https://pi.dev) instalado (`pi --version`)

### Instalar PI (si no está)

```bash
# Opción recomendada: BUN
bun add -g @earendil-works/pi-coding-agent

# Alternativa: npm
npm install -g @earendil-works/pi-coding-agent

# Alternativa: curl
curl -fsSL https://pi.dev/install.sh | sh
```

### Instalar PiStack (recomendado: npx - sin instalación global)

```bash
# En tu proyecto, ejecuta:
npx pistack install
```

Esto descarga e instala PiStack completo en tu proyecto (CodeGraph, Engram, skills, controller, MCP).

### Instalación global (opcional)

```bash
npm install -g pistack
# Luego en tu proyecto:
pistack install
```

### Instalar/desinstalar por componente

Cada herramienta se instala y desinstala de forma independiente:

```bash
npx pistack install codegraph          # Solo CodeGraph
npx pistack install engram             # Solo Engram
npx pistack install skills extensions  # Skills + extensions
npx pistack install --dir /ruta/proyecto codegraph

npx pistack uninstall engram           # Desinstala solo Engram
npx pistack uninstall codegraph        # Quita binario, índice y entrada MCP

npx pistack list                       # Estado de cada componente
```

Componentes disponibles: `pi-mcp-adapter`, `codegraph`, `engram`, `agents`, `skills`, `extensions`, `controller`, `mcp-config`, `models`.

### Setup del proyecto

```bash
cd tu-proyecto
npx pistack install
```

Esto crea:

```
.pi/
├── AGENTS.md          ← Agente custom
├── mcp.json           ← Config MCP
├── models.json        ← Config de modelos (opcional, para proveedores locales)
├── skills/            ← Skills (19)
├── extensions/        ← Extensions TypeScript
└── tools/             ← Binarios locales
```

> **Nota:** `npx pistack` sin argumentos muestra la ayuda. Usá `npx pistack install` para instalar.

## Uso

```bash
# Arrancar PI en el proyecto
pi

# El agente carga automáticamente AGENTS.md y las skills
```

### Flujo del agente

1. **Recibe request** → loguea qué pidió
2. **Discovery** → CodeGraph explora el código
3. **Clasifica nivel** → 0, 0+1, o 1+
4. **Pregunta al usuario** → spec o directo (según nivel)
5. **Ejecuta** → inline o con subagentes
6. **Verifica** → tests, review, sync

### Niveles

| Nivel   | Cuándo                                                  | Flujo                          |
| ------- | ------------------------------------------------------- | ------------------------------ |
| **0**   | 1 archivo, sin API pública, sin deps nuevas, <15 líneas | CodeGraph → directo            |
| **0+1** | 1-2 archivos, <30 líneas                                | CodeGraph → usuario elige      |
| **1+**  | API pública, refactor amplio, >30 líneas, cross-module  | CodeGraph → OpenSpec → evaluar |

## Proveedores Locales (Opcional)

PiStack incluye configuración para usar modelos locales como **Ollama**, **LM Studio** o **OpenCode Server**. Solo necesitás agregar las variables de entorno a tu `.env`:

### Variables de entorno (.env)

```bash
# Ollama (ej: http://localhost:11434/v1 o http://host.docker.internal:11434/v1 en Docker)
OLLAMA_BASE_URL=http://localhost:11434/v1
OLLAMA_API_KEY=ollama
OLLAMA_MODEL_1=llama3.1:8b
OLLAMA_MODEL_2=qwen2.5-coder:7b

# LM Studio (ej: http://localhost:1234/v1)
LMSTUDIO_BASE_URL=http://localhost:1234/v1
LMSTUDIO_API_KEY=lmstudio
LMSTUDIO_MODEL=llama3.1:8b

# OpenCode Server (ej: http://localhost:8080/v1)
OPENCODE_SERVER_BASE_URL=http://localhost:8080/v1
OPENCODE_SERVER_API_KEY=opencode
OPENCODE_SERVER_MODEL=gpt-4o
```

### Cómo funciona

1. Al ejecutar `pistack install`, se crea `.pi/models.json` desde la plantilla
2. Las variables `${VAR}` se resuelven automáticamente desde el entorno
3. Los modelos aparecen en `/model` y `--list-models` cuando las variables están definidas
4. Para usar: `pi --model ollama/llama3.1:8b` o seleccionar con `/model`

> **Nota:** Si usás Ollama en Docker, la URL debe ser `http://host.docker.internal:11434/v1` (no localhost).

## Estructura

```
proyecto/
├── .pi/
│   ├── AGENTS.md
│   ├── mcp.json
│   ├── models.json
│   ├── skills/
│   ├── extensions/
│   └── tools/
├── .codegraph/
└── README.md
```

## Herramientas

| Herramienta | Propósito                  | Localización                    |
| ----------- | -------------------------- | ------------------------------- |
| CodeGraph   | Exploración de código      | `.pi/tools/codegraph/bin/`      |
| Engram      | Memoria persistente        | `.pi/tools/engram/bin/`         |
| Context7    | Documentación de librerías | Remoto (MCP)                    |
| Controller  | Machine states             | `.pi/tools/pistack-controller/` |

## Seguridad

- **NUNCA** lee archivos con credenciales (`.env`, `*.key`, `credentials.json`)
- **SIEMPRE** pregunta antes de ejecutar
- **Logging** de todas las acciones

## Licencia

MIT

## Estructura del Repositorio (para desarrolladores)

```
PiStack/
├── src/
│   ├── cli.ts                      # Entry point: npx pistack
│   └── pistack-installer.ts        # Lógica de instalación/desinstalación por componentes
├── scripts/
│   └── generate-manifest.ts        # Genera manifest.json desde assets/ + package.json
├── assets/
│   ├── AGENTS.md                   # Agente custom
│   ├── models.json.template        # Template de proveedores locales
│   ├── extensions/                 # commands.ts
│   ├── skills/                     # 19 skills
│   └── tools/pistack-controller/   # Controller MCP (index.js + package.json)
├── manifest.json                   # Versión + hashes de assets (generado, no editar a mano)
├── package.json                    # name: pistack — fuente única de versión
└── README.md
```

### Publicar en npm (mantenedores)

```bash
bun run build              # instalador CLI
bun run build:installer    # módulo de instalación
bun run build:controller   # bundlea assets/tools/pistack-controller (src/ → index.js autónomo)
bun run generate-manifest  # regenera manifest.json (toma la versión de package.json)
npm version patch          # o minor/major
git add -A && git commit -m "chore: release vX.Y.Z"
git tag vX.Y.Z
git push && git push --tags
npm publish --access public
```

> **Nota:** la versión se centraliza en `package.json`. Regenerá el manifest SIEMPRE antes de publicar.
> El controller se distribuye como **bundle autónomo** (`index.js` con las deps embebidas) — nunca publiques sin correr `build:controller`, o el MCP fallará con `ERR_MODULE_NOT_FOUND`.
