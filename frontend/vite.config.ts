import { defineConfig } from 'vite'
import path from 'path'
import { execSync } from 'child_process'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Build identity: short git SHA + UTC build timestamp. Inyectados como string
// literal en compile-time. Si git no está disponible (caso raro), caen a "dev".
function safeExec(cmd: string, fallback: string): string {
  try { return execSync(cmd, { stdio: ['pipe', 'pipe', 'ignore'] }).toString().trim(); }
  catch { return fallback; }
}
const BUILD_SHA = process.env.GITHUB_SHA?.slice(0, 7) ?? safeExec('git rev-parse --short HEAD', 'dev');
const BUILD_TIME = new Date().toISOString();

export default defineConfig({
  server: {
    host: 'localhost',
    port: 5173,
    open: true,
    allowedHosts: true,
    proxy: {
      '/api-proxy': {
        target: 'https://espert-trade-api.azurewebsites.net',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/api-proxy/, ''),
      },
    },
  },
  preview: {
    port: 5174,
    proxy: {
      '/api-proxy': {
        target: 'https://espert-trade-api.azurewebsites.net',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/api-proxy/, ''),
      },
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        // Pre-cache all JS/CSS/HTML chunks so they work offline
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        // Max file size to pre-cache (5MB — covers large chunks like recharts)
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        // Activate new SW immediately (don't wait for all tabs to close)
        skipWaiting: true,
        clientsClaim: true,
        // Clean old caches from previous deploys
        cleanupOutdatedCaches: true,
        // Runtime cache for API calls and images
        runtimeCaching: [
          {
            // Cache Google Maps tiles
            urlPattern: /^https:\/\/(maps|mt[0-3])\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-maps',
              expiration: { maxEntries: 200, maxAgeSeconds: 7 * 24 * 60 * 60 },
            },
          },
          {
            // Cache uploaded photos/files from Azure blob
            urlPattern: /^https:\/\/.*\.blob\.core\.windows\.net\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'blob-images',
              expiration: { maxEntries: 300, maxAgeSeconds: 30 * 24 * 60 * 60 },
            },
          },
          {
            // Cache API GET calls — NetworkFirst so offline serves cached data
            // Excludes /auth/ endpoints (tokens must not be cached in SW)
            urlPattern: /^https:\/\/espert-trade-api\.azurewebsites\.net\/(?!auth\/).*/i,
            handler: 'NetworkFirst',
            method: 'GET',
            options: {
              cacheName: 'api-data',
              expiration: { maxEntries: 150, maxAgeSeconds: 24 * 60 * 60 },
              networkTimeoutSeconds: 5,
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      manifest: false, // We already have a manual manifest.json in public/
    }),
  ],
  define: {
    __BUILD_SHA__: JSON.stringify(BUILD_SHA),
    __BUILD_TIME__: JSON.stringify(BUILD_TIME),
  },

  resolve: {
    alias: {
      // Alias @ to the src directory
      '@': path.resolve(__dirname, './src'),
    },
  },

  // File types to support raw imports. Never add .css, .tsx, or .ts files to this.
  assetsInclude: ['**/*.svg', '**/*.csv'],

  // Optional peer deps que pueden no estar instaladas en dev (ej: @sentry/react).
  // Las marcamos como external en rollup para que el build no falle.
  build: {
    rollupOptions: {
      external: ['@sentry/react'],
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router'],
          'vendor-charts': ['recharts'],
        },
      },
    },
  },
})
