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

  app.use(express.json());

  const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;

  // Groq Chat API route
  app.post('/api/chat', async (req, res) => {
    const { messages, systemInstruction } = req.body;
    const groqApiKey = process.env.GROQ_API_KEY;

    if (!groqApiKey) {
      console.warn("GROQ_API_KEY is not defined in the environment.");
      return res.status(500).json({ error: "Groq API Key is missing. Please set GROQ_API_KEY in the environment." });
    }

    const groqMessages = [
      { role: 'system', content: systemInstruction || '' }
    ];

    if (Array.isArray(messages)) {
      messages.forEach((msg) => {
        const role = msg.role === 'model' ? 'assistant' : 'user';
        groqMessages.push({ role, content: msg.text || '' });
      });
    }

    try {
      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${groqApiKey}`
        },
        body: JSON.stringify({
          model: "llama-3.1-8b-instant",
          messages: groqMessages,
          temperature: 0.7,
          max_completion_tokens: 2048,
        })
      });

      if (!response.ok) {
        const errText = await response.text();
        console.error("Groq API error response:", errText);
        return res.status(response.status).json({ error: `Groq error: ${errText}` });
      }

      const data = (await response.json()) as any;
      const modelResponse = data.choices?.[0]?.message?.content || "";
      return res.json({ text: modelResponse });
    } catch (err: any) {
      console.error("Failed to query Groq API:", err);
      return res.status(500).json({ error: err.message || "Unknown error calling Groq API" });
    }
  });

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
