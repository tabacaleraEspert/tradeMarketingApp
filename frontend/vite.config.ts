import { defineConfig } from 'vite'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  server: {
    host: 'localhost',
    port: 5173,
    open: true,
    allowedHosts: true,
    proxy: {
      '/api-proxy': {
        target: 'http://localhost:8001',
        changeOrigin: true,
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
        ],
      },
      manifest: false, // We already have a manual manifest.json in public/
    }),
  ],
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
    },
  },
})
