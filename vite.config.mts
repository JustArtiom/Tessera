import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  root: `frontend`,
  plugins: [react(), tailwindcss()],
  build: {
    outDir: `../dist_frontend`,
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./frontend", import.meta.url)),
    },
  },
  server: {
    proxy: {
      "/api": {
        target: `http://localhost:3000`,
        changeOrigin: true,
        secure: false,
      },
    },
  },
});
