// Edge Function: webhook de confirmación de Flow (urlConfirmation).
//
// Flow hace POST con `token` (form-urlencoded). NO se confía en el cuerpo: la
// fuente de verdad es payment/getStatus (server-to-server, firmado). Si el pago
// está aprobado (status 2) y el monto coincide, se marca el intento como pagado,
// se extiende la suscripción y se registra el pago. Es IDEMPOTENTE (Flow puede
// reintentar y el navegador puede llegar en paralelo).
//
// Deploy (PÚBLICO, sin JWT: Flow no envía un JWT de Supabase):
//   supabase functions deploy flow-confirm --no-verify-jwt
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { callFlow, cors } from '../_shared/flow.ts'

// Siempre respondemos 200 para que Flow deje de reintentar (salvo error interno).
const ok = () => new Response('ok', { headers: cors })

async function handle(req: Request): Promise<Response> {
  const url = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const admin = createClient(url, serviceKey)

  // 1) Leer el token (Flow envía application/x-www-form-urlencoded).
  let token = ''
  try {
    const ct = req.headers.get('content-type') ?? ''
    if (ct.includes('application/json')) {
      token = ((await req.json()) as { token?: string }).token ?? ''
    } else {
      token = new URLSearchParams(await req.text()).get('token') ?? ''
    }
  } catch {
    /* sin token: se ignora */
  }
  if (!token) return ok()

  // 2) Fuente de verdad: getStatus.
  const { ok: statusOk, data: status } = await callFlow(
    'payment/getStatus',
    { token },
    'GET'
  )
  if (!statusOk || !status?.commerceOrder) return ok()

  const commerceOrder = String(status.commerceOrder)
  const paid = Number(status.status) === 2
  const paidAmount = Number(status.amount)

  // 3) Buscar el intento asociado.
  const { data: intent } = await admin
    .from('payment_intents')
    .select('id, company_id, plan_id, amount, months, status')
    .eq('commerce_order', commerceOrder)
    .maybeSingle()
  if (!intent) return ok()
  if (intent.status === 'paid') return ok() // ya procesado (idempotente)

  const now = new Date()
  const nowIso = now.toISOString()

  // 4) Si no está pagado, se registra el desenlace y se termina.
  if (!paid) {
    const newStatus = Number(status.status) === 4 ? 'canceled' : 'failed'
    await admin
      .from('payment_intents')
      .update({ status: newStatus, updated_at: nowIso })
      .eq('id', intent.id)
    return ok()
  }

  // 5) Validar el monto (defensa contra manipulación).
  if (Math.round(paidAmount) !== Math.round(Number(intent.amount))) {
    await admin
      .from('payment_intents')
      .update({ status: 'failed', updated_at: nowIso })
      .eq('id', intent.id)
    return ok()
  }

  // 6) Extender la suscripción: desde max(hoy, vencimiento actual) + N meses.
  const { data: sub } = await admin
    .from('subscriptions')
    .select('id, access_until, activated_at')
    .eq('company_id', intent.company_id)
    .maybeSingle()

  const base =
    sub?.access_until && new Date(sub.access_until) > now
      ? new Date(sub.access_until)
      : now
  const until = new Date(base)
  until.setMonth(until.getMonth() + (intent.months ?? 1))
  const untilIso = until.toISOString()

  if (sub) {
    await admin
      .from('subscriptions')
      .update({
        status: 'active',
        plan_id: intent.plan_id,
        access_until: untilIso,
        activated_at: sub.activated_at ?? nowIso,
        updated_at: nowIso,
      })
      .eq('id', sub.id)
  } else {
    await admin.from('subscriptions').insert({
      company_id: intent.company_id,
      plan_id: intent.plan_id,
      status: 'active',
      access_until: untilIso,
      activated_at: nowIso,
    })
  }

  // 7) Marcar el intento pagado + registrar el pago en el historial.
  await admin
    .from('payment_intents')
    .update({
      status: 'paid',
      paid_at: nowIso,
      flow_order: String(status.flowOrder ?? ''),
      updated_at: nowIso,
    })
    .eq('id', intent.id)

  await admin.from('subscription_payments').insert({
    company_id: intent.company_id,
    amount: intent.amount,
    paid_at: nowIso.slice(0, 10),
    method: 'flow',
    period_start: nowIso.slice(0, 10),
    period_end: untilIso.slice(0, 10),
    notes: `Flow ${status.flowOrder ?? ''}`.trim(),
  })

  return ok()
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return ok()
  try {
    return await handle(req)
  } catch (e) {
    // Se responde 200 para no entrar en un bucle de reintentos de Flow durante
    // la configuración; el error queda en los logs.
    console.error('flow-confirm error:', e)
    return ok()
  }
})
