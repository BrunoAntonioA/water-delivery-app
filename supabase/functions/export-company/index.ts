// Edge Function: exporta TODOS los datos de una empresa (respaldo por empresa).
//
// Seguridad: verifica el JWT del que llama y que sea SUPERADMIN. Usa el service
// role para leer todas las tablas (las políticas RLS por empresa no aplican al
// superadmin, que no tiene company_id). Devuelve un JSON con una fila por tabla.
//
// Deploy:  supabase functions deploy export-company
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })

// Tablas del negocio (todas tienen company_id) + perfiles de la empresa.
const TABLES = [
  'clients',
  'addresses',
  'products',
  'supplies',
  'product_supplies',
  'whatsapp_templates',
  'cost_categories',
  'costs',
  'providers',
  'supply_purchases',
  'supply_purchase_items',
  'orders',
  'order_items',
  'routes',
  'route_stops',
  'route_loads',
  'route_pickups',
  'subscriptions',
  'subscription_payments',
  'payment_intents',
  'profiles',
]

async function handle(req: Request): Promise<Response> {
  const url = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!

  // 1) Identificar al que llama.
  const authHeader = req.headers.get('Authorization') ?? ''
  const asCaller = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
  })
  const {
    data: { user: caller },
    error: callerErr,
  } = await asCaller.auth.getUser()
  if (callerErr || !caller) return json({ error: 'No autenticado' }, 401)

  // 2) Sólo el superadmin puede exportar.
  const admin = createClient(url, serviceKey)
  const { data: profile } = await admin
    .from('profiles')
    .select('role, active')
    .eq('id', caller.id)
    .maybeSingle()
  if (!profile || profile.active === false || profile.role !== 'superadmin') {
    return json({ error: 'Sólo el superadmin puede exportar datos' }, 403)
  }

  // 3) Empresa a exportar (y, opcionalmente, qué tablas).
  let body: { companyId?: string; tables?: string[] }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Cuerpo inválido' }, 400)
  }
  const companyId = body.companyId ?? ''
  if (!companyId) return json({ error: 'Falta companyId' }, 400)

  // Sólo se exportan las tablas pedidas (validadas contra la lista permitida).
  // Si no se piden (o la lista queda vacía), se exportan TODAS.
  const requested = Array.isArray(body.tables) ? body.tables : []
  const selectedTables =
    requested.length > 0 ? TABLES.filter((t) => requested.includes(t)) : TABLES

  const { data: company } = await admin
    .from('companies')
    .select('*')
    .eq('id', companyId)
    .maybeSingle()
  if (!company) return json({ error: 'Empresa no encontrada' }, 404)

  // 4) Traer las tablas seleccionadas filtrando por company_id.
  const tables: Record<string, unknown[]> = {}
  for (const t of selectedTables) {
    const { data, error } = await admin
      .from(t)
      .select('*')
      .eq('company_id', companyId)
    if (error) return json({ error: `Error en ${t}: ${error.message}` }, 500)
    tables[t] = data ?? []
  }

  return json({
    company,
    exported_at: new Date().toISOString(),
    tables,
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405)
  try {
    return await handle(req)
  } catch (e) {
    console.error('export-company error:', e)
    return json({ error: (e as Error)?.message ?? 'Error interno' }, 500)
  }
})
