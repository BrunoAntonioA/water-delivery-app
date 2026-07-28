// Edge Function: actualiza un usuario existente (contraseña y/o nombre) con el
// service role. Cambiar la contraseña de OTRO usuario requiere el Admin API de
// Supabase, que sólo puede usarse en el servidor.
//
// Seguridad: verifica el JWT del que llama y que sea admin (de la empresa del
// usuario objetivo) o superadmin. Un admin NUNCA puede editar a un superadmin.
//
// Deploy:  supabase functions deploy admin-update-user
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405)

  const url = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!

  // 1) Identificar a quien llama.
  const asCaller = createClient(url, anonKey, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  })
  const {
    data: { user: caller },
    error: callerErr,
  } = await asCaller.auth.getUser()
  if (callerErr || !caller) return json({ error: 'No autenticado' }, 401)

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

  // 2) Cuerpo.
  let body: { id?: string; password?: string; full_name?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Cuerpo inválido' }, 400)
  }
  const id = body.id ?? ''
  if (!id) return json({ error: 'Falta el id del usuario' }, 400)

  // 3) Usuario objetivo + reglas de autorización.
  const { data: target } = await admin
    .from('profiles')
    .select('company_id, role')
    .eq('id', id)
    .maybeSingle()
  if (!target) return json({ error: 'Usuario no encontrado' }, 404)

  if (!isSuperadmin) {
    if (target.company_id !== callerProfile.company_id) {
      return json({ error: 'Sin permiso sobre este usuario' }, 403)
    }
    if (target.role === 'superadmin') {
      return json({ error: 'No puedes editar a un superadmin' }, 403)
    }
  }

  // 4) Cambiar la contraseña (si se envió).
  if (body.password !== undefined && body.password !== '') {
    if (body.password.length < 8) {
      return json({ error: 'La contraseña debe tener al menos 8 caracteres' }, 400)
    }
    const { error } = await admin.auth.admin.updateUserById(id, {
      password: body.password,
    })
    if (error) return json({ error: error.message }, 400)
  }

  // 5) Cambiar el nombre (si se envió).
  if (body.full_name !== undefined) {
    const { error } = await admin
      .from('profiles')
      .update({ full_name: body.full_name.trim() || null })
      .eq('id', id)
    if (error) return json({ error: error.message }, 400)
  }

  return json({ ok: true })
})
