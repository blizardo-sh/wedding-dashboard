import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const privateDirectory = path.resolve(
  process.env.WEDDING_DATA_DIR || path.join(root, "../.private/dashboard"),
);

// This middleware exists ONLY in the dev server. It never copies data into public/ or dist/.
function privateLocalData() {
  return {
    name: "private-local-data",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__local__", async (req, res, next) => {
        const trustedHost = (value) => {
          try {
            return ["127.0.0.1", "localhost", "[::1]"].includes(
              new URL(value).hostname,
            );
          } catch {
            return false;
          }
        };
        if (
          !trustedHost("http://" + req.headers.host) ||
          (req.headers.origin && !trustedHost(req.headers.origin)) ||
          req.headers["sec-fetch-site"] === "cross-site"
        ) {
          res.statusCode = 403;
          res.end();
          return;
        }
        if (req.method !== "GET") {
          res.statusCode = 405;
          res.end();
          return;
        }
        const url = new URL(req.url, "http://localhost");
        let relative;
        if (url.pathname === "/catalog") relative = "catalog.json";
        else if (/^\/detail\/[a-z]+_\d+$/.test(url.pathname))
          relative =
            "details/" + url.pathname.slice("/detail/".length) + ".json";
        else return next();
        try {
          const data = await fs.readFile(path.join(privateDirectory, relative));
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.setHeader("Cache-Control", "no-store");
          res.setHeader("X-Content-Type-Options", "nosniff");
          res.end(data);
        } catch {
          res.statusCode = 404;
          res.end(
            JSON.stringify({ error: "Локальные данные ещё не импортированы" }),
          );
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), privateLocalData()],
  base: process.env.WEDDING_BASE_PATH || "./",
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: false,
    fs: { strict: true },
  },
  build: { target: "es2022", sourcemap: false },
});
