// server.ts
import express from "express";
import { createServer as createViteServer } from "vite";
import { createProxyMiddleware } from "http-proxy-middleware";
import path from "path";
import { fileURLToPath } from "url";
var __filename = fileURLToPath(import.meta.url);
var __dirname = path.dirname(__filename);
async function startServer() {
  const app = express();
  const PORT = 3e3;
  const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
  const geminiProxy = createProxyMiddleware({
    target: "https://generativelanguage.googleapis.com",
    changeOrigin: true,
    ws: true,
    pathFilter: ["/v1alpha", "/v1beta", "/ws"],
    pathRewrite: (path2, req) => {
      if (!apiKey) return path2;
      const separator = path2.includes("?") ? "&" : "?";
      return `${path2}${separator}key=${apiKey}`;
    },
    router: (req) => {
      if (req.headers.upgrade && req.headers.upgrade.toLowerCase() === "websocket") {
        return "wss://generativelanguage.googleapis.com";
      }
      return "https://generativelanguage.googleapis.com";
    },
    on: {
      proxyReq: (proxyReq, req, res) => {
        proxyReq.removeHeader("x-goog-api-key");
      },
      proxyReqWs: (proxyReq, req, socket, options, head) => {
        proxyReq.removeHeader("x-goog-api-key");
      },
      error: (err, req, res) => {
        console.error("Proxy error:", err);
      }
    }
  });
  app.use(geminiProxy);
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}
startServer();
