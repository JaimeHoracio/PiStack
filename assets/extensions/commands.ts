import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.notify("✅ PiStack extension loaded", "info");
  });

  // install-stack command
  pi.registerCommand("install-stack", {
    description: "Instala el stack completo PiStack: CodeGraph, Engram, skills, controller MCP",
    handler: async (args, ctx) => {
      ctx.ui.notify("🚀 Instalando PiStack...", "info");

      const cwd = process.cwd();

      // Verificar PI
      try {
        const piVersion = await Bun.$`pi --version`.text();
        ctx.ui.notify(`✅ PI detectado: ${piVersion.trim()}`, "info");
      } catch {
        ctx.ui.notify("❌ PI no encontrado. Instalá PI primero.", "error");
        return;
      }

      // Verificar pi-mcp-adapter
      try {
        await Bun.$`pi install npm:pi-mcp-adapter`.quiet();
        ctx.ui.notify("✅ pi-mcp-adapter instalado", "info");
      } catch {
        ctx.ui.notify("⚠️ pi-mcp-adapter ya instalado o error", "warning");
      }

      // Crear estructura de directorios
      const dirs = [
        ".pi/skills",
        ".pi/extensions",
        ".pi/tools/codegraph/bin",
        ".pi/tools/engram/bin",
        ".pi/tools/pistack-controller",
      ];
      for (const dir of dirs) {
        await Bun.$`mkdir -p ${dir}`.cwd(cwd);
      }
      ctx.ui.notify("✅ Estructura de directorios creada", "info");

      // CodeGraph
      ctx.ui.notify("📦 Instalando CodeGraph...", "info");
      try {
        const cgBin = ".pi/tools/codegraph/bin/codegraph";
        await Bun.$`curl -L -o ${cgBin}.tar.gz https://github.com/colbymchenry/codegraph/releases/download/v1.5.0/codegraph-linux-x64.tar.gz`.cwd(cwd);
        await Bun.$`tar -xzf ${cgBin}.tar.gz -C .pi/tools/codegraph/ && mv .pi/tools/codegraph/codegraph-linux-x64/* .pi/tools/codegraph/ && rm -rf .pi/tools/codegraph/codegraph-linux-x64 ${cgBin}.tar.gz`.cwd(cwd);
        await Bun.$`chmod +x ${cgBin}`.cwd(cwd);
        const cgVer = await Bun.$`${cgBin} --version`.text();
        ctx.ui.notify(`✅ CodeGraph ${cgVer.trim()} instalado`, "info");

        await Bun.$`${cgBin} init -i`.cwd(cwd);
        ctx.ui.notify("✅ CodeGraph inicializado", "info");
      } catch (e) {
        ctx.ui.notify(`❌ Error instalando CodeGraph: ${e}`, "error");
      }

      // Engram
      ctx.ui.notify("📦 Instalando Engram...", "info");
      try {
        const egBin = ".pi/tools/engram/bin/engram";
        await Bun.$`curl -L -o ${egBin}.tar.gz https://github.com/Gentleman-Programming/engram/releases/download/v1.20.0/engram_1.20.0_linux_amd64.tar.gz`.cwd(cwd);
        await Bun.$`tar -xzf ${egBin}.tar.gz -C .pi/tools/engram/ && mv .pi/tools/engram/engram ${egBin} && rm ${egBin}.tar.gz`.cwd(cwd);
        await Bun.$`chmod +x ${egBin}`.cwd(cwd);
        const egVer = await Bun.$`${egBin} --version`.text();
        ctx.ui.notify(`✅ Engram ${egVer.trim()} instalado`, "info");
      } catch (e) {
        ctx.ui.notify(`❌ Error instalando Engram: ${e}`, "error");
      }

      // Skills y controller ya vienen en el bundle
      ctx.ui.notify("✅ Skills (19) y controller copiados", "info");

      // Crear mcp.json
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
      await Bun.write(`${cwd}/.pi/mcp.json`, JSON.stringify(mcpConfig, null, 2));
      ctx.ui.notify("✅ .pi/mcp.json creado", "info");

      // Copiar models.json.template como models.json si no existe (para proveedores locales)
      try {
        const modelsTemplate = await Bun.file(`${cwd}/.pi/models.json.template`).text();
        const modelsFile = `${cwd}/.pi/models.json`;
        if (!(await Bun.file(modelsFile).exists())) {
          await Bun.write(modelsFile, modelsTemplate);
          ctx.ui.notify("✅ .pi/models.json creado (template para proveedores locales)", "info");
          ctx.ui.notify("   Editalo y agregá variables a .env: OLLAMA_BASE_URL, OLLAMA_MODEL_1, etc.", "info");
        }
      } catch {
        ctx.ui.notify("⚠️ No se pudo crear models.json", "warning");
      }

      ctx.ui.notify("🎉 PiStack instalado correctamente!", "info");
      ctx.ui.notify("Para usar: ejecuta 'pi' en tu proyecto", "info");
      ctx.ui.notify("", "info");
      ctx.ui.notify("📚 Paquetes oficiales en pi.dev (NO instalados):", "info");
      ctx.ui.notify("   ❌ pi-code-graph  → rechazado (Docker+OpenRouter; Rust local es mejor)", "info");
      ctx.ui.notify("   ❌ gentle-engram → rechazado (cloud-first; PiStack es local-first)", "info");
      ctx.ui.notify("   📋 openspec-pi   → upgrade opcional: npm i -g @fission-ai/openspec && pi install npm:openspec-pi", "info");
      ctx.ui.notify("   📋 pi-superpowers → upgrade opcional: pi install npm:pi-superpowers (deshabilitar plan-tracker)", "info");
      ctx.ui.notify("   Ver README §'Paquetes oficiales en pi.dev' para detalles", "info");
    },
  });

  // opsx-sync command
  pi.registerCommand("opsx-sync", {
    description: "Sincroniza CodeGraph y delta specs del change activo",
    handler: async (args, ctx) => {
      ctx.ui.notify("🔄 Sincronizando...", "info");

      const cwd = process.cwd();
      const cgBin = ".pi/tools/codegraph/bin/codegraph";

      try {
        await Bun.$`test -d .codegraph || ${cgBin} init -i`.cwd(cwd);
        await Bun.$`${cgBin} sync`.cwd(cwd);
        ctx.ui.notify("✅ CodeGraph sincronizado", "info");
      } catch (e) {
        ctx.ui.notify(`⚠️ CodeGraph sync: ${e}`, "warning");
      }

      try {
        await Bun.$`npx openspec update`.cwd(cwd);
        ctx.ui.notify("✅ OpenSpec actualizado", "info");
      } catch (e) {
        ctx.ui.notify(`⚠️ OpenSpec update: ${e}`, "warning");
      }

      ctx.ui.notify("✅ Sincronización completa", "info");
    },
  });

  // friendly-error command: decodifica errores HTTP crudos de proveedores
  pi.registerCommand("friendly-error", {
    description: "Decodifica un error HTTP crudo de proveedor (ej: '429 status code (no body)') y devuelve causa + acción sugerida",
    handler: async (args, ctx) => {
      const raw = (args ?? "").trim();
      if (!raw) {
        ctx.ui.notify("Uso: /friendly-error <error>", "warning");
        ctx.ui.notify("Ejemplo: /friendly-error 429 status code (no body)", "info");
        return;
      }

      const lower = raw.toLowerCase();
      let friendly: string;
      let action: string;

      if (lower.includes("429")) {
        friendly = "El proveedor limitó la cantidad de requests (429). Esperá unos segundos o bajá el tamaño del mensaje antes de reintentar.";
        action = "Esperar 15-30s y reintentar. Si persiste: revisar tier del proveedor o cambiar de modelo.";
      } else if (lower.includes("401")) {
        friendly = "La API key del proveedor fue rechazada (401). Verificá que la variable de entorno correspondiente esté bien definida.";
        action = "Pedirle al usuario que revise ${PROVIDER_API_KEY} sin mostrarla.";
      } else if (lower.includes("403")) {
        friendly = "La API key no tiene permiso para ese modelo (403). Posiblemente el modelo no está disponible en tu tier.";
        action = "Sugerir un modelo alternativo del mismo proveedor.";
      } else if (lower.includes("500") || lower.includes("502") || lower.includes("503")) {
        friendly = "El proveedor tuvo un error interno. Es transitorio — esperá unos segundos y reintentá.";
        action = "Retry con backoff exponencial. Tras 3 fallos: sugerir cambiar de proveedor.";
      } else if (lower.includes("fetch failed") && (lower.includes("econnrefused") || lower.includes("127.0.0.1"))) {
        friendly = "El proveedor local no está corriendo. Iniciá el servidor (ej: 'ollama serve', 'opencode serve --port <p>') y reintentá.";
        action = "Dar el comando exacto del servidor local que se sospecha caído.";
      } else if (lower.includes("fetch failed") && lower.includes("enotfound")) {
        friendly = "No se pudo resolver el host del proveedor. Revisá tu conexión a internet o la URL configurada.";
        action = "Pedir al usuario verificar la variable BASE_URL.";
      } else if (lower.includes("fetch failed") || lower.includes("etimedout")) {
        friendly = "La request al proveedor tardó demasiado y se cortó. Probablemente el modelo está sobrecargado o tu conexión es lenta.";
        action = "Reintentar una vez. Si persiste: modelo más chico o prompt más corto.";
      } else if (lower.includes("socket hang up")) {
        friendly = "La conexión con el proveedor se cortó mientras llegaba la respuesta.";
        action = "Reintentar — usualmente transitorio.";
      } else if (lower.includes("context_length_exceeded")) {
        friendly = "El mensaje es demasiado largo para este modelo. Acortá el contexto o cambiá a un modelo con ventana mayor.";
        action = "Sugerir /compact o un modelo con más contexto.";
      } else if (lower.includes("model_not_found")) {
        friendly = "El modelo solicitado no existe o fue dado de baja. Verificá el nombre en /model.";
        action = "Listar modelos disponibles de models.json y dejar elegir.";
      } else {
        friendly = "Error no reconocido. Mostrá el stack trace completo y revisá logs del proveedor.";
        action = "Si el error se repite, abrir un issue con el stack completo.";
      }

      ctx.ui.notify(`❌ ${raw}`, "error");
      ctx.ui.notify(`💡 ${friendly}`, "info");
      ctx.ui.notify(`🔧 ${action}`, "info");
    },
  });
}