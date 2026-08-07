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
}