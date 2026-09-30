import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// - `npm run dev`        -> consome a API FastAPI (proxy /api -> :8000)
// - `npm run build`      -> modo "static": lê public/data/*.json (GitHub Pages)
// VITE_BASE define o subcaminho do Pages (ex: /fiis-site/). Default "./".
export default defineConfig({
  plugins: [react()],
  base: process.env.VITE_BASE ?? "./",
  server: {
    proxy: { "/api": "http://127.0.0.1:8000" },
  },
});
