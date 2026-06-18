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

  // Collect all server-side Gemini API Keys
  const serverKeys: string[] = [];

  // 1. Check GEMINI_API_KEYS (comma-separated list)
  if (process.env.GEMINI_API_KEYS) {
    process.env.GEMINI_API_KEYS.split(',').forEach(k => {
      const trimmed = k.trim();
      if (trimmed) serverKeys.push(trimmed);
    });
  }

  // 2. Check numbered GEMINI_API_KEY_1 through GEMINI_API_KEY_5
  for (let i = 1; i <= 5; i++) {
    const key = process.env[`GEMINI_API_KEY_${i}`];
    if (key && key.trim()) {
      serverKeys.push(key.trim());
    }
  }

  // 3. Fallback to standard env variables
  const defaultKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
  if (defaultKey && defaultKey.trim() && !serverKeys.includes(defaultKey.trim())) {
    serverKeys.push(defaultKey.trim());
  }

  console.log(`[Server Pool] Loaded ${serverKeys.length} Gemini API keys for rotating proxies.`);

  let keyIndex = 0;
  const getRotatedServerKey = (): string => {
    if (serverKeys.length === 0) return '';
    const key = serverKeys[keyIndex];
    keyIndex = (keyIndex + 1) % serverKeys.length;
    return key;
  };

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
      const activeKey = getRotatedServerKey();
      if (!activeKey) {
        console.warn(`[Proxy Rewrite] No Gemini API keys found configured on this server! Path: ${cleanPath}`);
        return cleanPath;
      }
      
      try {
        // Parse incoming query params and inject rotating key
        const url = new URL(cleanPath, 'https://generativelanguage.googleapis.com');
        url.searchParams.set('key', activeKey);
        const rewritten = url.pathname + url.search;
        console.log(`[Proxy Rewrite] Rotating to server key ${activeKey.substring(0, 10)}...`);
        return rewritten;
      } catch (err) {
        const separator = cleanPath.includes('?') ? '&' : '?';
        const rewritten = `${cleanPath}${separator}key=${activeKey}`;
        console.log(`[Proxy Rewrite Fallback] Rotating to server key ${activeKey.substring(0, 10)}... (Fallback url builder)`);
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
        // Extract key from rewritten path to match header and query params
        try {
          const urlObj = new URL(proxyReq.path, 'https://localhost');
          const keyInPath = urlObj.searchParams.get('key');
          if (keyInPath) {
            proxyReq.setHeader('x-goog-api-key', keyInPath);
          }
        } catch (e) {
          const fallbackKey = getRotatedServerKey();
          if (fallbackKey) {
            proxyReq.setHeader('x-goog-api-key', fallbackKey);
          }
        }
      },
      proxyReqWs: (proxyReq, req, socket, options, head) => {
        console.log(`[Proxy WS Connect] Handshake URL: ${req.url}`);
        try {
          const urlObj = new URL(req.url || '', 'https://localhost');
          const keyInPath = urlObj.searchParams.get('key');
          if (keyInPath) {
            proxyReq.setHeader('x-goog-api-key', keyInPath);
          }
        } catch (e) {
          const fallbackKey = getRotatedServerKey();
          if (fallbackKey) {
            proxyReq.setHeader('x-goog-api-key', fallbackKey);
          }
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
