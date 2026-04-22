import express from 'express';
import { createServer as createViteServer } from 'vite';
import { createProxyMiddleware } from 'http-proxy-middleware';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { google } from 'googleapis';
import cookieParser from 'cookie-parser';

// Simple JSON Database Helper
const DB_FILE = path.join(process.cwd(), 'database.json');

function getData() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      fs.writeFileSync(DB_FILE, JSON.stringify({ agents: {}, bookings: [] }));
    }
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
  } catch (err) {
    console.error('DB Read Error:', err);
    return { agents: {}, bookings: [] };
  }
}

function saveData(data: any) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('DB Write Error:', err);
  }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;
  
  app.use(express.json());
  app.use(cookieParser());

  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
  });

  app.get('/api/debug-server', (req, res) => {
    const distPath = path.resolve(process.cwd(), 'dist');
    res.json({
      cwd: process.cwd(),
      dirname: __dirname,
      distExists: fs.existsSync(distPath),
      distContent: fs.existsSync(distPath) ? fs.readdirSync(distPath) : [],
      env: {
          NODE_ENV: process.env.NODE_ENV
      }
    });
  });

  const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;

  // Google OAuth Config
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${process.env.VITE_APP_URL || 'http://localhost:3000'}/api/auth/google/callback`
  );

  // Auth URL Endpoint
  app.get('/api/auth/google/url', (req, res) => {
    const { agentId } = req.query;
    if (!agentId) return res.status(400).json({ error: 'agentId is required' });

    const url = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: ['https://www.googleapis.com/auth/calendar.events'],
      state: agentId as string,
      prompt: 'consent' // Ensure we get a refresh token
    });
    res.json({ url });
  });

  // Auth Callback Endpoint
  app.get('/api/auth/google/callback', async (req, res) => {
    const { code, state: agentId } = req.query;
    if (!code || !agentId) return res.status(400).send('Missing code or state');

    try {
      const { tokens } = await oauth2Client.getToken(code as string);
      
      // Save tokens to local database
      const data = getData();
      if (!data.agents[agentId as string]) {
        data.agents[agentId as string] = {};
      }
      data.agents[agentId as string].googleCalendarTokens = tokens;
      data.agents[agentId as string].calendarConnected = true;
      saveData(data);

      res.send(`
        <html>
          <body style="font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #f9fafb;">
            <div style="text-align: center; padding: 2rem; background: white; border-radius: 1rem; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1);">
              <h2 style="color: #4f46e5;">Connection Successful!</h2>
              <p style="color: #4b5563;">Google Calendar has been linked to your agent.</p>
              <p style="color: #9ca3af; font-size: 0.875rem;">This window will close automatically.</p>
              <script>
                if (window.opener) {
                  window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS', agentId: '${agentId}' }, '*');
                  setTimeout(() => window.close(), 1500);
                } else {
                  window.location.href = '/';
                }
              </script>
            </div>
          </body>
        </html>
      `);
    } catch (error) {
      console.error('Google OAuth Error:', error);
      const msg = error instanceof Error ? error.message : 'Unknown error';
      res.status(500).send(`Authentication failed: ${msg}`);
    }
  });

  // Create Calendar Event Endpoint
  app.post('/api/calendar/create', async (req, res) => {
    const { agentId, title, description, date, time } = req.body;
    if (!agentId) return res.status(400).json({ error: 'agentId is required' });

    try {
      const data = getData();
      const agentData = data.agents[agentId];
      if (!agentData) return res.status(404).json({ error: 'Agent not found' });

      const tokens = agentData?.googleCalendarTokens;

      if (!tokens) return res.status(400).json({ error: 'Calendar not connected' });

      oauth2Client.setCredentials(tokens);
      const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

      // If tokens were refreshed, save them back
      oauth2Client.on('tokens', (newTokens) => {
        const freshData = getData();
        freshData.agents[agentId].googleCalendarTokens = { ...tokens, ...newTokens };
        saveData(freshData);
      });

      // Simple date/time parsing
      // Assuming date is YYYY-MM-DD and time is HH:mm or similar
      let startDateTime = `${date}T09:00:00Z`; // Fallback
      if (time) {
         // Basic conversion of "10:00 AM" or "14:00" to ISO-ish
         const cleanTime = time.replace(/\s*[AP]M/i, '');
         const [hours, minutes] = cleanTime.split(':');
         let h = parseInt(hours);
         if (time.toLowerCase().includes('pm') && h < 12) h += 12;
         if (time.toLowerCase().includes('am') && h === 12) h = 0;
         const pad = (n: number) => n.toString().padStart(2, '0');
         startDateTime = `${date}T${pad(h)}:${pad(parseInt(minutes || '0'))}:00Z`;
      }

      const endDateTime = new Date(new Date(startDateTime).getTime() + 60 * 60 * 1000).toISOString();

      const event = {
        summary: title || 'PSSDC Appointment',
        description: description || 'Booked via AI Assistant',
        start: { dateTime: startDateTime },
        end: { dateTime: endDateTime },
      };

      const response = await calendar.events.insert({
        calendarId: 'primary',
        requestBody: event,
      });

      res.json({ success: true, eventId: response.data.id });
    } catch (error) {
      console.error('Calendar Creation Error:', error);
      res.status(500).json({ error: 'Failed to create event' });
    }
  });

  // --- LOCAL DB API ENDPOINTS ---

  // Get all profiles or specific profile
  app.get('/api/profiles', (req, res) => {
    const data = getData();
    res.json(Object.values(data.agents));
  });

  app.post('/api/profiles', (req, res) => {
    const profile = req.body;
    if (!profile.id) return res.status(400).json({ error: 'Profile ID required' });
    const data = getData();
    data.agents[profile.id] = { ...data.agents[profile.id], ...profile };
    saveData(data);
    res.json({ success: true });
  });

  app.delete('/api/profiles/:id', (req, res) => {
    const { id } = req.params;
    const data = getData();
    delete data.agents[id];
    saveData(data);
    res.json({ success: true });
  });

  // Get and Save Bookings
  app.get('/api/bookings', (req, res) => {
    const { agentId } = req.query;
    const data = getData();
    const filtered = agentId 
      ? data.bookings.filter((b: any) => b.agentId === agentId)
      : data.bookings;
    res.json(filtered);
  });

  app.post('/api/bookings', (req, res) => {
    const booking = req.body;
    const data = getData();
    const newBooking = { 
      id: Math.random().toString(36).substr(2, 9),
      createdAt: new Date().toISOString(),
      status: 'Pending',
      ...booking 
    };
    data.bookings.push(newBooking);
    saveData(data);
    res.json({ success: true, bookingId: newBooking.id });
  });

  app.patch('/api/bookings/:id', (req, res) => {
    const { id } = req.params;
    const updates = req.body;
    const data = getData();
    const index = data.bookings.findIndex((b: any) => b.id === id);
    if (index !== -1) {
      data.bookings[index] = { ...data.bookings[index], ...updates, updatedAt: new Date().toISOString() };
      saveData(data);
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'Booking not found' });
    }
  });

  app.delete('/api/bookings/:id', (req, res) => {
    const { id } = req.params;
    const data = getData();
    data.bookings = data.bookings.filter((b: any) => b.id !== id);
    saveData(data);
    res.json({ success: true });
  });

  // --- END LOCAL DB API ENDPOINTS ---

  // Proxy Gemini API requests
  const geminiProxy = createProxyMiddleware({
    target: 'https://generativelanguage.googleapis.com',
    changeOrigin: true,
    ws: true,
    pathFilter: ['/v1alpha', '/v1beta', '/ws'],
    pathRewrite: (path, req) => {
      if (!apiKey) return path;
      const separator = path.includes('?') ? '&' : '?';
      return `${path}${separator}key=${apiKey}`;
    },
    router: (req) => {
      if (req.headers.upgrade && req.headers.upgrade.toLowerCase() === 'websocket') {
        return 'wss://generativelanguage.googleapis.com';
      }
      return 'https://generativelanguage.googleapis.com';
    },
    on: {
      proxyReq: (proxyReq, req, res) => {
        proxyReq.removeHeader('x-goog-api-key');
      },
      proxyReqWs: (proxyReq, req, socket, options, head) => {
        proxyReq.removeHeader('x-goog-api-key');
      },
      error: (err, req, res) => {
        console.error('Proxy error:', err);
      }
    }
  });

  app.use(geminiProxy);

  // Vite middleware for development - Default to production mode especially on Vercel
  const isDev = process.env.NODE_ENV === 'development' && !process.env.VERCEL;
  
  if (isDev) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    const indexPath = path.join(distPath, 'index.html');
    
    console.log(`[Production] Serving static files from: ${distPath}`);
    console.log(`[Production] Index path mapped to: ${indexPath}`);
    console.log(`[Production] Index exists: ${fs.existsSync(indexPath)}`);
    
    app.use((req, res, next) => {
        if (req.path.startsWith('/assets/')) {
            console.log(`[Production] Serving asset: ${req.path}`);
        }
        next();
    });
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
      } else {
        res.status(404).send('Application build not found. Please run "npm run build" first.');
      }
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
