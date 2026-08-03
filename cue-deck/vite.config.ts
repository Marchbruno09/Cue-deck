import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import electron from "vite-plugin-electron/simple";

const rendererOnly =
  process.env.CUEDECK_RENDERER_ONLY === "1" || process.env.VITEST === "true";

export default defineConfig({
  plugins: [
    react(),
    ...(
      rendererOnly
        ? []
        : [
            electron({
              main: {
                entry: "electron/main.ts",
              },
              preload: {
                input: path.join(__dirname, "electron/preload.ts"),
              },
              renderer: {},
            }),
          ]
    ),
  ],
  build: {
    sourcemap: true,
  },
  server: {
    host: "127.0.0.1",
    fs: {
      strict: !rendererOnly,
    },
  },
});
