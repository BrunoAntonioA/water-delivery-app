import './instrument' // ← Sentry: debe ir ANTES que cualquier otro import
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { reactErrorHandler } from '@sentry/react'
import { QueryClient } from '@tanstack/react-query'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import { AuthProvider } from './lib/auth.tsx'
import { UpdatePrompt } from './components/UpdatePrompt.tsx'
import { queryPersister } from './lib/queryPersist.ts'

// 24 h: cuánto viven las consultas en caché. Debe ser >= al maxAge de la
// persistencia para que los datos sobrevivan al recargar y verse sin conexión.
const DAY = 24 * 60 * 60_000

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      // Al volver la conexión, se refrescan las consultas (comportamiento por
      // defecto; lo dejamos explícito por claridad).
      refetchOnReconnect: true,
      retry: 1,
      // Ahorro de egress (Supabase): las listas grandes no se vuelven a
      // descargar al remontar/navegar dentro de esta ventana. Las escrituras
      // invalidan sus claves explícitamente, así que los datos siguen frescos
      // después de una acción del usuario.
      staleTime: 5 * 60_000,
      // Se conservan en caché 24 h para poder mostrarlas offline.
      gcTime: DAY,
    },
  },
})

createRoot(document.getElementById('root')!, {
  // React 19: reporta a Sentry los errores capturados por React.
  onUncaughtError: reactErrorHandler(),
  onCaughtError: reactErrorHandler(),
  onRecoverableError: reactErrorHandler(),
}).render(
  <StrictMode>
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister: queryPersister,
        maxAge: DAY, // descarta datos guardados de más de 24 h
        buster: __BUILD_ID__, // cada deploy invalida la caché vieja
      }}
    >
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
      <UpdatePrompt />
    </PersistQueryClientProvider>
  </StrictMode>
)
