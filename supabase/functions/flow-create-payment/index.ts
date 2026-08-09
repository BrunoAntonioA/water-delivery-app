// Edge Function: inicia un pago de suscripción con Flow.
//
// Seguridad: verifica el JWT del que llama y que sea admin (de su empresa) o
// superadmin. El MONTO se toma del plan en la BD (nunca del cliente). Crea un
// payment_intent (service role) y una orden de pago en Flow; devuelve la URL a
// la que el navegador debe redirigir.
//
// Deploy:  supabase functions deploy flow-create-payment
// (verify_jwt queda en true: sólo usuarios autenticados pueden iniciar el pago.)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { callFlow, cors, json } from '../_shared/flow.ts'

async function handle(req: Request): Promise<Response> {
  const url = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!

  // 1) Identificar a quien llama por su JWT.
  const authHeader = req.headers.get('Authorization') ?? ''
  const asCaller = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
  })
  const {
    data: { user: caller },
    error: callerErr,
  } = await asCaller.auth.getUser()
  if (callerErr || !caller) return json({ error: 'No autenticado' }, 401)

  // 2) Perfil del que llama (service role): debe ser admin de una empresa.
  const admin = createClient(url, serviceKey)
  const { data: profile } = await admin
    .from('profiles')
    .select('role, company_id, active, email')
    .eq('id', caller.id)
    .maybeSingle()
  if (!profile || profile.active === false) return json({ error: 'Sin permiso' }, 403)
  const isAdmin = profile.role === 'admin' || profile.role === 'superadmin'
  if (!isAdmin || !profile.company_id) {
    return json({ error: 'Sólo el administrador de la empresa puede pagar' }, 403)
  }
  const companyId = profile.company_id as string

  // 3) Cuerpo: qué plan se paga (y opcionalmente cuántos meses).
  let body: { planKey?: string; months?: number }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Cuerpo inválido' }, 400)
  }
  const planKey = (body.planKey ?? '').trim()
  const months = Math.max(1, Math.trunc(Number(body.months ?? 1)))
  if (!planKey) return json({ error: 'Falta planKey' }, 400)

  // 4) Plan y MONTO desde la BD (nunca del cliente). CLP es entero.
  const { data: plan } = await admin
    .from('plans')
    .select('id, name, price')
    .eq('key', planKey)
    .eq('active', true)
    .maybeSingle()
  if (!plan) return json({ error: 'Plan no encontrado' }, 404)

  // Precio especial de la empresa (si el superadmin lo definió): tiene prioridad
  // sobre el precio del plan. El monto SIEMPRE se decide en el servidor.
  const { data: subRow } = await admin
    .from('subscriptions')
    .select('custom_price')
    .eq('company_id', companyId)
    .maybeSingle()
  const basePrice =
    subRow?.custom_price != null ? Number(subRow.custom_price) : Number(plan.price)
  const amount = Math.round(basePrice * months)
  if (!(amount > 0)) return json({ error: 'Monto inválido' }, 400)

  const { data: company } = await admin
    .from('companies')
    .select('name, email')
    .eq('id', companyId)
    .maybeSingle()
  const email = company?.email || profile.email || caller.email || ''
  if (!email) {
    return json({ error: 'La empresa no tiene un correo para el pago' }, 400)
  }

  // 5) Crear el intento de pago (service role; setea company_id explícito).
  const commerceOrder = crypto.randomUUID()
  const { data: intent, error: intentErr } = await admin
    .from('payment_intents')
    .insert({
      company_id: companyId,
      plan_id: plan.id,
      amount,
      currency: 'CLP',
      months,
      status: 'pending',
      commerce_order: commerceOrder,
      created_by: caller.id,
    })
    .select('id')
    .single()
  if (intentErr) return json({ error: intentErr.message }, 400)

  // 6) Crear el pago en Flow.
  const { ok, data } = await callFlow(
    'payment/create',
    {
      commerceOrder,
      subject: `Plan ${plan.name}${months > 1 ? ` (${months} meses)` : ''}`,
      currency: 'CLP',
      amount: String(amount),
      email,
      urlConfirmation: `${url}/functions/v1/flow-confirm`,
      urlReturn: `${url}/functions/v1/flow-return`,
      optional: JSON.stringify({ intentId: intent.id, companyId, planId: plan.id }),
    },
    'POST'
  )

  if (!ok || !data?.url || !data?.token) {
    await admin
      .from('payment_intents')
      .update({ status: 'failed', updated_at: new Date().toISOString() })
      .eq('id', intent.id)
    return json(
      { error: data?.message || 'No se pudo crear el pago en Flow' },
      502
    )
  }

  await admin
    .from('payment_intents')
    .update({
      flow_token: data.token,
      flow_order: String(data.flowOrder ?? ''),
      updated_at: new Date().toISOString(),
    })
    .eq('id', intent.id)

  // El navegador debe navegar a url?token=… para completar el pago en Flow.
  return json({ redirectUrl: `${data.url}?token=${data.token}` }, 200)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405)
  try {
    return await handle(req)
  } catch (e) {
    // Cualquier error inesperado se devuelve CON CORS y con mensaje, para no
    // caer en el genérico "Failed to send a request to the Edge Function".
    console.error('flow-create-payment error:', e)
    return json({ error: (e as Error)?.message ?? 'Error interno' }, 500)
  }
})
