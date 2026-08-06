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

// deno-lint-ignore no-explicit-any
type Admin = any

/** Busca una cuenta de Auth por correo (paginando la lista de usuarios). */
async function findAuthUserByEmail(admin: Admin, email: string) {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: 200,
    })
    if (error || !data) break
    const found = data.users.find(
      (u: { email?: string }) => (u.email ?? '').toLowerCase() === email
    )
    if (found) return found
    if (data.users.length < 200) break
  }
  return null
}

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
  let userId: string
  let createdNew = false
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: false,
  })
  if (created?.user) {
    userId = created.user.id
    createdNew = true
  } else {
    const msg = createErr?.message ?? 'No se pudo crear la cuenta'
    if (!/already|registered|exists/i.test(msg)) {
      return json({ error: msg }, 400)
    }
    // El correo ya existe en Auth. Como el cliente ya verificó que no hay perfil
    // en esta empresa, se trata de una cuenta HUÉRFANA (p. ej. un usuario que se
    // eliminó y dejó la cuenta de acceso). La reutilizamos en vez de fallar.
    const existing = await findAuthUserByEmail(admin, email)
    if (!existing) {
      return json({ error: 'Ese correo ya tiene una cuenta.' }, 409)
    }
    // Si esa cuenta AÚN tiene perfil (activo en otra empresa), no se reutiliza.
    const { data: existingProfile } = await admin
      .from('profiles')
      .select('id')
      .eq('id', existing.id)
      .maybeSingle()
    if (existingProfile) {
      return json({ error: 'Ese correo ya tiene una cuenta.' }, 409)
    }
    const { error: updErr } = await admin.auth.admin.updateUserById(existing.id, {
      password,
    })
    if (updErr) return json({ error: updErr.message }, 400)
    userId = existing.id
  }

  // 6) Crear el perfil.
  const { error: profileErr } = await admin.from('profiles').insert({
    id: userId,
    company_id: companyId,
    role,
    full_name: fullName || null,
    email,
    created_by: caller.id,
  })
  if (profileErr) {
    // Sólo revertimos la cuenta de Auth si la acabamos de crear (no si era una
    // cuenta reutilizada preexistente).
    if (createdNew) await admin.auth.admin.deleteUser(userId)
    return json({ error: profileErr.message }, 400)
  }

  return json({ id: created.user.id }, 200)
})
