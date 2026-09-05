import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // Required for GitHub Pages: site serves from /neural-notes/
  base: "/neural-notes/",
  plugins: [react()],
  build: { chunkSizeWarningLimit: 1500 },
});
