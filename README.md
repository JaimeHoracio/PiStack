# PiStack v0.0.1

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
npx @jaimehoracio/pistack install
```

Esto descarga e instala PiStack completo en tu proyecto (CodeGraph, Engram, skills, controller, MCP).

### Instalación global (opcional)

```bash
npm install -g @jaimehoracio/pistack
# Luego en tu proyecto:
pistack install
```

### Setup del proyecto

```bash
cd tu-proyecto
npx @jaimehoracio/pistack install
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

| Nivel | Cuándo | Flujo |
|-------|--------|-------|
| **0** | <5 líneas, 1 archivo | CodeGraph → directo |
| **0+1** | 5-10 líneas, 1-2 archivos | CodeGraph → usuario elige |
| **1+** | >10 líneas, API pública | CodeGraph → OpenSpec → evaluar |

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

| Herramienta | Propósito | Localización |
|-------------|-----------|--------------|
| CodeGraph | Exploración de código | `.pi/tools/codegraph/bin/` |
| Engram | Memoria persistente | `.pi/tools/engram/bin/` |
| Context7 | Documentación de librerías | Remoto (MCP) |
| Controller | Machine states | `.pi/tools/pistack-controller/` |

## Seguridad

- **NUNCA** lee archivos con credenciales (`.env`, `*.key`, `credentials.json`)
- **SIEMPRE** pregunta antes de ejecutar
- **Logging** de todas las acciones

## Licencia

MIT

## Estructura del Repositorio (para desarrolladores)

```
PiStack/
├── fuente/                 # Código fuente del installer npm
│   ├── assets/pi/         # Assets que se instalan en .pi/
│   │   ├── AGENTS.md
│   │   ├── mcp.json
│   │   ├── models.json.template
│   │   ├── skills/        # 19 skills
│   │   ├── extensions/    # commands.ts
│   │   └── tools/         # pistack-controller
│   ├── src/
│   │   ├── cli.ts         # Entry point: npx pistack
│   │   └── pistack-installer.ts  # Lógica de instalación
│   ├── scripts/
│   │   └── update-manifest-hashes.ts
│   ├── manifest.json      # Versiones y hashes de assets
│   └── package.json       # Para npm publish
├── .pi/                   # Ejemplo instalado (gitignored)
├── PLAN.md                # Plan de migración
└── README.md
```

### Publicar en npm (mantenedores)

```bash
cd fuente
npm version patch  # o minor/major
bun run build
bun run build:installer
bun run scripts/update-manifest-hashes.ts
git add -A && git commit -m "chore: release vX.Y.Z"
git tag vX.Y.Z
git push && git push --tags
npm publish --access public
```