// Edge Function: crea un usuario (cuenta Auth + perfil) con el service role,
// para poder DESACTIVAR el registro público (signup) en Supabase.
//
// Seguridad: verifica el JWT del que llama y que sea admin (de su empresa) o
// superadmin. Un admin sólo puede crear usuarios de SU empresa y NUNCA con rol
// 'superadmin'. Toda la lógica corre en el servidor; el service role nunca sale
// al navegador.
//
// Deploy:  supabase functions deploy admin-create-user
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

const ALLOWED_ROLES = ['admin', 'operador', 'repartidor']

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405)

  const url = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!

  // 1) Identificar a quien llama a partir de su JWT.
  const authHeader = req.headers.get('Authorization') ?? ''
  const asCaller = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
  })
  const {
    data: { user: caller },
    error: callerErr,
  } = await asCaller.auth.getUser()
  if (callerErr || !caller) return json({ error: 'No autenticado' }, 401)

  // 2) Cliente con service role para leer el perfil del que llama y para crear.
  const admin = createClient(url, serviceKey)
  const { data: callerProfile } = await admin
    .from('profiles')
    .select('role, company_id, active')
    .eq('id', caller.id)
    .maybeSingle()

  if (!callerProfile || callerProfile.active === false) {
    return json({ error: 'Sin permiso' }, 403)
  }
  const isSuperadmin = callerProfile.role === 'superadmin'
  const isAdmin = callerProfile.role === 'admin'
  if (!isSuperadmin && !isAdmin) return json({ error: 'Sin permiso' }, 403)

  // 3) Validar el cuerpo.
  let body: {
    email?: string
    password?: string
    full_name?: string
    role?: string
    company_id?: string | null
  }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Cuerpo inválido' }, 400)
  }
  const email = (body.email ?? '').trim().toLowerCase()
  const password = body.password ?? ''
  const role = body.role ?? ''
  const fullName = (body.full_name ?? '').trim()
  let companyId = body.company_id ?? null

  if (!email || !password) return json({ error: 'Faltan correo o contraseña' }, 400)
  if (password.length < 8) {
    return json({ error: 'La contraseña debe tener al menos 8 caracteres' }, 400)
  }

  // 4) Reglas de autorización por rol.
  if (isSuperadmin) {
    // El superadmin puede crear en cualquier empresa; si no manda company_id,
    // sólo se permite para otro superadmin.
    if (role !== 'superadmin' && !companyId) {
      return json({ error: 'Falta company_id' }, 400)
    }
  } else {
    // Admin de empresa: sólo su empresa y roles no privilegiados.
    if (!ALLOWED_ROLES.includes(role)) {
      return json({ error: 'Rol no permitido' }, 403)
    }
    companyId = callerProfile.company_id // se fuerza a su empresa
    if (!companyId) return json({ error: 'Tu cuenta no tiene empresa' }, 403)
  }

  // 5) Crear la cuenta de Auth SIN confirmar: el usuario recibe un correo de
  //    verificación (lo dispara el frontend con auth.resend) y debe confirmarlo
  //    antes de poder iniciar sesión.
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: false,
  })
  if (createErr || !created.user) {
    const msg = createErr?.message ?? 'No se pudo crear la cuenta'
    const already = /already|registered|exists/i.test(msg)
    return json(
      { error: already ? 'Ese correo ya tiene una cuenta.' : msg },
      already ? 409 : 400
    )
  }

  // 6) Crear el perfil.
  const { error: profileErr } = await admin.from('profiles').insert({
    id: created.user.id,
    company_id: companyId,
    role,
    full_name: fullName || null,
    email,
    created_by: caller.id,
  })
  if (profileErr) {
    // Revertir la cuenta de Auth para no dejar usuarios huérfanos.
    await admin.auth.admin.deleteUser(created.user.id)
    return json({ error: profileErr.message }, 400)
  }

  return json({ id: created.user.id }, 200)
})
