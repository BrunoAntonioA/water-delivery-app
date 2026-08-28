import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { sentryVitePlugin } from '@sentry/vite-plugin'
import { VitePWA } from 'vite-plugin-pwa'

// Sólo se suben source maps a Sentry si hay auth token (en Vercel). Sin token
// (build local, o antes de configurarlo) el build funciona igual, sin subir nada.
const uploadSourceMaps = Boolean(process.env.SENTRY_AUTH_TOKEN)

// https://vite.dev/config/
export default defineConfig({
  // Id único por build: se usa para invalidar la caché persistida en cada deploy.
  define: {
    __BUILD_ID__: JSON.stringify(String(Date.now())),
  },
  build: {
    // 'hidden': genera source maps pero NO los referencia en el bundle (no
    // quedan expuestos a los usuarios); el plugin los sube a Sentry y los borra.
    sourcemap: uploadSourceMaps ? 'hidden' : false,
  },
  plugins: [
    react(),
    tailwindcss(),
    // PWA: la app se puede instalar y ABRE sin conexión (precachea los assets
    // estáticos). NO cachea la API de Supabase: de los datos offline se encarga
    // la caché persistida de React Query (ver src/lib/queryPersist.ts).
    VitePWA({
      registerType: 'prompt', // avisa "nueva versión" en vez de recargar sola
      includeAssets: ['favicon.svg', 'logo.png'],
      manifest: {
        name: 'Gestiona Agua',
        short_name: 'Gestiona Agua',
        description: 'Reparto de agua',
        lang: 'es',
        theme_color: '#0284c7',
        background_color: '#f8fafc',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff,woff2}'],
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
      },
    }),
    ...(uploadSourceMaps
      ? [
          sentryVitePlugin({
            org: process.env.SENTRY_ORG,
            project: process.env.SENTRY_PROJECT,
            authToken: process.env.SENTRY_AUTH_TOKEN,
          }),
        ]
      : []),
  ],
})
