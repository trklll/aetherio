import { defineConfig } from "vite";
import { configDefaults } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig(async () => ({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (id.includes("react") || id.includes("scheduler")) return "vendor-react";
          if (id.includes("@tanstack")) return "vendor-query";
          if (id.includes("@tauri-apps")) return "vendor-tauri";
          if (id.includes("gsap")) return "vendor-motion";
          if (id.includes("lucide-react")) return "vendor-icons";
          if (id.includes("zustand")) return "vendor-state";
          return "vendor";
        },
      },
    },
  },
  clearScreen: false,
  optimizeDeps: {
    // Sin esto vite recorre todos los .html del repo, incluidos los del webui
    // vendorizado de librqbit, cuyas dependencias no estan instaladas: el
    // escaneo falla y el arranque del dev server se queda colgado.
    entries: ["index.html"],
  },
  test: {
    // Las especificaciones de `e2e/` corren con Playwright, no con vitest.
    exclude: [...configDefaults.exclude, "e2e/**"],
  },
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**"] },
  },
}));
