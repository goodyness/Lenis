import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Forward API calls to the FastAPI backend while allowing browser page navigations
// and page refreshes (Accept: text/html) to fall through to the Single Page Application index.html.
const createApiProxy = (target = 'http://127.0.0.1:8000') => ({
  target,
  changeOrigin: true,
  bypass: (req: { headers?: Record<string, string | string[] | undefined> }) => {
    const accept = req.headers?.['accept'] || req.headers?.['Accept']
    if (typeof accept === 'string' && accept.includes('text/html')) {
      return '/index.html'
    }
  },
})

export default defineConfig({
  plugins: [react()],
  build: {
    ssrManifest: true,
    outDir: 'dist/client',
  },
  server: {
    proxy: {
      // Forward all API calls to the FastAPI backend on port 8000.
      // Start the backend with: python lenis.py   (defaults to 127.0.0.1:8000)
      '/auth': createApiProxy(),
      '/merchant': createApiProxy(),
      '/admin': createApiProxy(),
      '/users': createApiProxy(),
      '/networks': createApiProxy(),
      '/verification': createApiProxy(),
      '/notifications': createApiProxy(),
      '/pay': createApiProxy(),
      '/api': createApiProxy(),
      '/uploads': createApiProxy(),
    },
  },
})

