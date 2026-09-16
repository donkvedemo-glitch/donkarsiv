import { defineConfig, searchForWorkspaceRoot } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": "http://localhost:4000",
      "/uploads": "http://localhost:4000"
    },
    fs: {
      allow: [searchForWorkspaceRoot(process.cwd())]
    }
  }
});
