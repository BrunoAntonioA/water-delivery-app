import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
// Clave "publishable" (sb_publishable_...). Es la que reemplaza a la antigua
// "anon" y es segura para usar en el navegador. NUNCA pongas aquí la secret key.
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as
  | string
  | undefined

if (!url || !publishableKey) {
  // Mensaje claro en consola si faltan las variables de entorno.
  console.error(
    'Faltan VITE_SUPABASE_URL y/o VITE_SUPABASE_PUBLISHABLE_KEY. ' +
      'Copia .env.example a .env y rellena los valores.'
  )
}

// Usa un placeholder válido si faltan las variables, para que createClient no
// lance error al cargar el módulo (las consultas fallarán, pero la UI se muestra
// y aparece el aviso de configuración).
export const supabase = createClient(
  url || 'https://placeholder.supabase.co',
  publishableKey || 'sb_publishable_placeholder'
)

export const PRODUCT_IMAGES_BUCKET = 'product-images'

/** true si las variables de entorno están configuradas. */
export const isSupabaseConfigured = Boolean(url && publishableKey)

/**
 * Cliente temporal y aislado para crear usuarios (signUp) sin tocar la sesión
 * del admin que está usando el app. No persiste sesión en localStorage.
 */
export function createTempAuthClient() {
  return createClient(
    url || 'https://placeholder.supabase.co',
    publishableKey || 'sb_publishable_placeholder',
    { auth: { persistSession: false, autoRefreshToken: false } }
  )
}
