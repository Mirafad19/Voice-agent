import express from 'express';
import { createServer as createViteServer } from 'vite';
import { createProxyMiddleware } from 'http-proxy-middleware';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;

  // Proxy Gemini API requests
  const geminiProxy = createProxyMiddleware({
    target: 'https://generativelanguage.googleapis.com',
    changeOrigin: true,
    ws: true,
    pathFilter: (pathname, req) => {
      const cleanPath = pathname.replace(/^\/+/, '/');
      const isMatch = cleanPath.startsWith('/v1alpha') || cleanPath.startsWith('/v1beta') || cleanPath.startsWith('/ws');
      if (isMatch) {
        console.log(`[Proxy Match] Path: ${pathname} -> Cleaned: ${cleanPath} | Upgrade: ${req.headers.upgrade || 'none'}`);
      }
      return isMatch;
    },
    pathRewrite: (path, req) => {
      const cleanPath = path.replace(/^\/+/, '/');
      if (!apiKey) {
        console.log(`[Proxy Rewrite] Path: ${path} -> Cleaned: ${cleanPath} (No API key)`);
        return cleanPath;
      }
      try {
        const url = new URL(cleanPath, 'https://generativelanguage.googleapis.com');
        url.searchParams.set('key', apiKey);
        const rewritten = url.pathname + url.search;
        console.log(`[Proxy Rewrite] Path: ${path} -> Cleaned: ${cleanPath} -> Rewritten with API key`);
        return rewritten;
      } catch (err) {
        const separator = cleanPath.includes('?') ? '&' : '?';
        const rewritten = `${cleanPath}${separator}key=${apiKey}`;
        console.log(`[Proxy Rewrite Error-Fallback] Path: ${path} -> Cleaned: ${cleanPath} -> Rewritten: ${rewritten}`);
        return rewritten;
      }
    },
    router: (req) => {
      if (req.headers.upgrade && req.headers.upgrade.toLowerCase() === 'websocket') {
        return 'wss://generativelanguage.googleapis.com';
      }
      return 'https://generativelanguage.googleapis.com';
    },
    on: {
      proxyReq: (proxyReq, req, res) => {
        if (apiKey) {
          proxyReq.setHeader('x-goog-api-key', apiKey);
        }
      },
      proxyReqWs: (proxyReq, req, socket, options, head) => {
        console.log(`[Proxy WS Connect] Handshake URL: ${req.url}`);
        if (apiKey) {
          proxyReq.setHeader('x-goog-api-key', apiKey);
        }
      },
      error: (err, req, res) => {
        console.error('Proxy error:', err);
      }
    }
  });

  app.use(geminiProxy);

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });

  server.on('upgrade', (req, socket, head) => {
    geminiProxy.upgrade(req, socket as any, head);
  });
}

startServer();
