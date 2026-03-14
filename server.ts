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

  console.log('GEMINI_API_KEY is set:', !!process.env.GEMINI_API_KEY);

  app.get('/api/check-key', (req, res) => {
    res.json({ hasKey: !!process.env.GEMINI_API_KEY });
  });

  app.get('/api/test-rewrite', (req, res) => {
    const path = '/v1alpha/models/gemini-2.5-flash:generateContent';
    const apiKey = process.env.GEMINI_API_KEY;
    const separator = path.includes('?') ? '&' : '?';
    res.json({ rewritten: `${path}${separator}key=${apiKey}` });
  });

  // Proxy Gemini API requests
  const geminiProxy = createProxyMiddleware({
    target: 'https://generativelanguage.googleapis.com',
    changeOrigin: true,
    ws: true,
    pathRewrite: (path, req) => {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        console.error('GEMINI_API_KEY is not set');
        return path;
      }
      
      // If the path was stripped by app.use, req.originalUrl contains the full path
      let fullPath = req.originalUrl || path;
      
      // Append the API key to the query string
      const separator = fullPath.includes('?') ? '&' : '?';
      return `${fullPath}${separator}key=${apiKey}`;
    },
    router: (req) => {
      // Route WebSocket requests to the wss:// endpoint
      if (req.headers.upgrade && req.headers.upgrade.toLowerCase() === 'websocket') {
        return 'wss://generativelanguage.googleapis.com';
      }
      return 'https://generativelanguage.googleapis.com';
    },
    on: {
      proxyReq: (proxyReq, req, res) => {
        // Remove the dummy API key header sent by the client SDK
        proxyReq.removeHeader('x-goog-api-key');
      },
      proxyReqWs: (proxyReq, req, socket, options, head) => {
        // Remove the dummy API key header sent by the client SDK
        proxyReq.removeHeader('x-goog-api-key');
      },
      error: (err, req, res) => {
        console.error('Proxy error:', err);
      }
    }
  });

  // Proxy REST and WebSocket requests to Gemini
  app.use('/v1alpha', geminiProxy);
  app.use('/v1beta', geminiProxy);
  app.use('/ws', geminiProxy);

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

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
