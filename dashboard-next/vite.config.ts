import { resolve } from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig, loadEnv } from "vite"

// The dashboard is a SPA served by the Go panel in production and by Vite in
// development. In development every `/api` call is proxied to a real panel so
// the frontend never speaks cross-origin; cookies stay first-party, and the
// backend's same-origin guard is satisfied by rewriting the proxied Origin
// header to the target's own origin.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "")
  const apiTarget = (env.VITE_API_TARGET || "https://roverloom.com").replace(/\/+$/, "")
  const targetOrigin = new URL(apiTarget).origin

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@": resolve(import.meta.dirname, "./src"),
      },
    },
    server: {
      host: "127.0.0.1",
      port: Number(env.PORT || 3100),
      strictPort: false,
      proxy: {
        "/api": {
          target: apiTarget,
          changeOrigin: true,
          secure: true,
          headers: { Origin: targetOrigin },
        },
      },
    },
    build: {
      sourcemap: mode !== "production",
      chunkSizeWarningLimit: 900,
    },
    test: {
      environment: "jsdom",
      globals: true,
      setupFiles: ["./src/test/setup.ts"],
      css: false,
    },
  }
})
