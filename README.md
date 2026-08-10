# PiStack

Agent Harness para [PI](https://pi.dev) — convierte PI en un orquestador de código con machine states, clasificación por niveles y herramientas MCP.

## Qué es

PiStack agrega a PI:

- **3 niveles de clasificación** — trivial (directo), chico (usuario elige), complejo (OpenSpec)
- **Controller MCP** — máquina de estados persistida que valida transiciones
- **Skills curadas** — TDD, review, writing-plans, execution-mode-evaluation, y más
- **MCP integration** — CodeGraph, Engram, Context7 vía pi-mcp-adapter
- **Proveedores locales** — Ollama, LM Studio, Ollama Cloud via variables de entorno

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

### Instalar PiStack

```bash
# En tu proyecto:
npx pistack install
```

Esto descarga e instala PiStack completo en tu proyecto.

### Instalación global (opcional)

```bash
npm install -g pistack
# Luego en tu proyecto:
pistack install
```

### Instalar/desinstalar por componente

```bash
npx pistack install codegraph          # Solo CodeGraph
npx pistack install engram             # Solo Engram
npx pistack install skills extensions  # Skills + extensions
npx pistack install --dir /ruta/proyecto codegraph

npx pistack uninstall engram           # Desinstala solo Engram
npx pistack uninstall codegraph        # Quita binario, índice y entrada MCP

npx pistack list                       # Estado de cada componente
```

Componentes: `pi-mcp-adapter`, `codegraph`, `engram`, `agents`, `skills`, `extensions`, `controller`, `mcp-config`, `models`.

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
├── models.json        ← Config de modelos (proveedores locales)
├── skills/            ← Skills (19)
├── extensions/        ← Extensions TypeScript
└── bin/               ← Binarios locales (codegraph, engram, controller)
```

## Uso

```bash
# Arrancar PI en el proyecto
pi

# El agente carga automáticamente AGENTS.md y las skills
```

### Flujo del agente

1. **Recibe request** → interpreta qué quiere el usuario
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

PiStack incluye configuración para usar modelos locales o cloud sin infraestructura propia. Agregá las variables a tu `.env`:

### Ollama (local)

```bash
OLLAMA_BASE_URL=http://localhost:11434/v1
OLLAMA_API_KEY=ollama
OLLAMA_MODEL_1=llama3.1:8b
OLLAMA_MODEL_2=qwen2.5-coder:7b
```

### LM Studio (local)

```bash
LMSTUDIO_BASE_URL=http://localhost:1234/v1
LMSTUDIO_API_KEY=lmstudio
LMSTUDIO_MODEL=llama3.1:8b
```

### Ollama Cloud (cloud, requiere API key)

```bash
OLLAMA_CLOUD_BASE_URL=https://ollama.com/api
OLLAMA_CLOUD_API_KEY=tu_api_key
OLLAMA_CLOUD_MODEL=llama3.1
```

### Cómo funciona

1. Al ejecutar `pistack install`, se crea `.pi/models.json` desde la plantilla
2. Las variables `${VAR}` se resuelven automáticamente desde el entorno
3. Los modelos aparecen en `/model` y `--list-models` cuando las variables están definidas
4. Para usar: `pi --model ollama/llama3.1:8b` o seleccionar con `/model`

> **Nota:** Si usás Ollama en Docker, la URL debe ser `http://host.docker.internal:11434/v1` (no localhost).

## Seguridad

Cada componente publicado incluye un **hash SHA-256** en el `manifest.json` y en el `pistack-lock.json` del proyecto. Al instalar, PiStack verifica que los hashes coincidan — si un archivo fue modificado post-build, la instalación lo detecta y rechaza el componente.

## Estructura

```
proyecto/
├── .pi/
│   ├── AGENTS.md
│   ├── mcp.json
│   ├── models.json
│   ├── skills/
│   ├── extensions/
│   └── bin/
├── .codegraph/
└── README.md
```

## Herramientas

| Herramienta | Propósito                  | Localización                  |
| ----------- | -------------------------- | ----------------------------- |
| CodeGraph   | Exploración de código      | `.pi/bin/codegraph/bin/`      |
| Engram      | Memoria persistente        | `.pi/bin/engram/bin/`         |
| Context7    | Documentación de librerías | Remoto (MCP)                  |
| Controller  | Machine states             | `.pi/bin/pistack-controller/` |

## Licencia

MIT

## Estructura del Repositorio

```
PiStack/
├── src/
│   ├── cli.ts                  # Entry point: npx pistack
│   └── pistack-installer.ts    # Lógica de instalación/desinstalación
├── scripts/
│   └── generate-manifest.ts    # Genera manifest.json desde assets/ + package.json
├── assets/
│   ├── AGENTS.md               # Agente custom
│   ├── models.json.template    # Template de proveedores locales
│   ├── extensions/             # commands.ts, opencode-server.ts
│   ├── skills/                 # 19 skills
│   ├── types/                  # pi-types.d.ts (dev only)
│   └── tools/pistack-controller/ # Controller MCP
├── manifest.json               # Versión + hashes (generado, no editar)
├── package.json                # Fuente única de versión
└── README.md
```
