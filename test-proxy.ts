import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';

const app = express();

app.use('/api', createProxyMiddleware({
  target: 'http://httpbin.org',
  changeOrigin: true,
  on: {
    proxyReq: (proxyReq, req, res) => {
      console.log('Proxying:', proxyReq.path);
    }
  }
}));

app.listen(3001, () => console.log('Test server on 3001'));
