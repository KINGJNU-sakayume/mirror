import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? "/mirror/" : "./",
  plugins: [react(), tailwindcss()],
  build: { chunkSizeWarningLimit: 1100 },
});
