import './instrument' // ← Sentry: debe ir ANTES que cualquier otro import
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { reactErrorHandler } from '@sentry/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import { AuthProvider } from './lib/auth.tsx'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      // Ahorro de egress (Supabase): las listas grandes no se vuelven a
      // descargar al remontar/navegar dentro de esta ventana. Las escrituras
      // invalidan sus claves explícitamente, así que los datos siguen frescos
      // después de una acción del usuario.
      staleTime: 5 * 60_000,
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
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>
)
