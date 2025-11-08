import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    headers: {
      // Sets the Content Security Policy for the dev server.
      // This is necessary to allow the browser to connect to Cloudinary's API for file uploads.
      // It also allows scripts and resources from the CDNs used in index.html.
      'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com https://aistudiocdn.com https://cdn.jsdelivr.net; connect-src 'self' https://api.cloudinary.com; img-src 'self' data:; style-src 'self' 'unsafe-inline';"
    }
  }
})
