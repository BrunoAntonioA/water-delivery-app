// Edge Function: registro PÚBLICO desde la landing. Crea, con el service role:
//   1) la cuenta de Auth (admin, email confirmado),
//   2) la empresa (razón social + RUT + datos de contacto),
//   3) el perfil (rol 'admin'),
//   4) una suscripción en PRUEBA de 7 días con el plan elegido.
//
// No requiere sesión (es signup). Verifica el captcha de Cloudflare Turnstile si
// hay TURNSTILE_SECRET configurado. El service role nunca sale al navegador.
//
// Deploy (sin verificación de JWT, porque es público):
//   supabase functions deploy signup-company --no-verify-jwt
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

const TRIAL_DAYS = 10

// Normalizadores para comparar sin importar el formato:
// RUT: sin puntos/guiones/espacios y en mayúscula (la "K"). Teléfono: sólo dígitos.
const normRut = (s: string) => s.replace(/[.\-\s]/g, '').toUpperCase()
const normPhone = (s: string) => s.replace(/\D/g, '')

async function verifyCaptcha(token: string | undefined): Promise<boolean> {
  const secret = Deno.env.get('TURNSTILE_SECRET')
  if (!secret) return true // captcha no configurado: no se exige
  if (!token) return false
  const form = new FormData()
  form.append('secret', secret)
  form.append('response', token)
  const res = await fetch(
    'https://challenges.cloudflare.com/turnstile/v0/siteverify',
    { method: 'POST', body: form }
  )
  const data = await res.json().catch(() => ({ success: false }))
  return Boolean(data.success)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405)

  const url = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const admin = createClient(url, serviceKey)

  // 1) Validar el cuerpo.
  let body: Record<string, string | undefined>
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Cuerpo inválido' }, 400)
  }

  const email = (body.email ?? '').trim().toLowerCase()
  const password = body.password ?? ''
  const fullName = (body.full_name ?? '').trim()
  const lastName = (body.last_name ?? '').trim()
  const phone = (body.phone ?? '').trim()
  const rut = (body.rut ?? '').trim()
  const razonSocial = (body.razon_social ?? '').trim()
  const planId = (body.plan_id ?? '').trim()

  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  if (!emailOk) return json({ error: 'Correo inválido' }, 400)
  if (password.length < 8) {
    return json({ error: 'La contraseña debe tener al menos 8 caracteres' }, 400)
  }
  if (!fullName || !lastName) return json({ error: 'Falta nombre o apellido' }, 400)
  if (!phone || !rut || !razonSocial) {
    return json({ error: 'Faltan datos de la empresa (RUT, razón social, teléfono)' }, 400)
  }
  if (!planId) return json({ error: 'Selecciona un plan' }, 400)

  // 2) Captcha (si está configurado).
  if (!(await verifyCaptcha(body.captchaToken))) {
    return json({ error: 'Verificación de seguridad fallida' }, 400)
  }

  // 3) Validar que el plan exista.
  const { data: plan } = await admin
    .from('plans')
    .select('id')
    .eq('id', planId)
    .maybeSingle()
  if (!plan) return json({ error: 'Plan no válido' }, 400)

  // 3b) RUT y teléfono únicos: no puede haber dos empresas con el mismo (el
  //     correo lo valida Auth al crear la cuenta). Se comparan normalizados.
  const { data: companies } = await admin
    .from('companies')
    .select('rut, phone')
  const rutN = normRut(rut)
  const phoneN = normPhone(phone)
  for (const c of companies ?? []) {
    if (c.rut && normRut(c.rut) === rutN) {
      return json({ error: 'Ya existe una empresa registrada con ese RUT.' }, 409)
    }
    if (c.phone && normPhone(c.phone) === phoneN) {
      return json(
        { error: 'Ya existe una empresa registrada con ese teléfono.' },
        409
      )
    }
  }

  // 4) Crear la cuenta de Auth SIN confirmar: el usuario debe verificar su correo
  //    (el correo de verificación lo dispara el frontend con auth.resend).
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
  const userId = created.user.id

  // 5) Crear la empresa.
  const { data: company, error: companyErr } = await admin
    .from('companies')
    .insert({
      name: razonSocial,
      razon_social: razonSocial,
      rut,
      phone,
      email,
    })
    .select('id')
    .single()
  if (companyErr || !company) {
    await admin.auth.admin.deleteUser(userId)
    return json({ error: companyErr?.message ?? 'No se pudo crear la empresa' }, 400)
  }

  // 6) Crear el perfil (rol admin).
  const { error: profileErr } = await admin.from('profiles').insert({
    id: userId,
    company_id: company.id,
    role: 'admin',
    full_name: `${fullName} ${lastName}`.trim(),
    email,
  })
  if (profileErr) {
    await admin.from('companies').delete().eq('id', company.id)
    await admin.auth.admin.deleteUser(userId)
    return json({ error: profileErr.message }, 400)
  }

  // 7) Crear la suscripción en PRUEBA (7 días). Los módulos durante la prueba
  //    los define el frontend (TRIAL_MODULES = Pro sin "usuarios").
  const accessUntil = new Date(
    Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000
  ).toISOString()
  const { error: subErr } = await admin.from('subscriptions').insert({
    company_id: company.id,
    plan_id: planId,
    status: 'trialing',
    access_until: accessUntil,
    trial_end: accessUntil,
  })
  if (subErr) {
    await admin.from('profiles').delete().eq('id', userId)
    await admin.from('companies').delete().eq('id', company.id)
    await admin.auth.admin.deleteUser(userId)
    return json({ error: subErr.message }, 400)
  }

  return json({ id: userId, company_id: company.id }, 200)
})
