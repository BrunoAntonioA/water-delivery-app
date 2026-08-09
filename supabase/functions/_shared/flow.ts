// Utilidades compartidas para integrar Flow (flow.cl) desde Edge Functions.
//
// Firma: Flow exige firmar cada request con HMAC-SHA256 sobre los parámetros
// ORDENADOS por nombre y concatenados como name+value (sin separadores). La
// firma va en el parámetro `s`; el `apiKey` SÍ se incluye en la firma, `s` no.
//
// Secrets requeridos (supabase secrets set …):
//   FLOW_API_KEY, FLOW_SECRET_KEY, FLOW_API_BASE (sandbox o prod)

export const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })

const enc = new TextEncoder()

/** Firma HMAC-SHA256 (hex) de los parámetros, ordenados por nombre. */
export async function flowSign(
  params: Record<string, string>,
  secret: string
): Promise<string> {
  const toSign = Object.keys(params)
    .sort()
    .map((k) => k + params[k])
    .join('')
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(toSign))
  return [...new Uint8Array(sig)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function flowConfig() {
  const base = Deno.env.get('FLOW_API_BASE') ?? 'https://sandbox.flow.cl/api'
  const apiKey = Deno.env.get('FLOW_API_KEY')
  const secret = Deno.env.get('FLOW_SECRET_KEY')
  if (!apiKey || !secret) {
    throw new Error('Faltan los secrets FLOW_API_KEY / FLOW_SECRET_KEY')
  }
  return { base: base.replace(/\/$/, ''), apiKey, secret }
}

// deno-lint-ignore no-explicit-any
type FlowResult = { ok: boolean; status: number; data: any }

/**
 * Llama a un endpoint de la API de Flow firmando los parámetros. `payment/create`
 * usa POST (form-urlencoded); `payment/getStatus` usa GET. Devuelve el JSON.
 */
export async function callFlow(
  endpoint: string,
  params: Record<string, string>,
  method: 'GET' | 'POST'
): Promise<FlowResult> {
  const { base, apiKey, secret } = flowConfig()
  const all: Record<string, string> = { ...params, apiKey }
  const s = await flowSign(all, secret)
  const qs = new URLSearchParams({ ...all, s })

  let res: Response
  if (method === 'GET') {
    res = await fetch(`${base}/${endpoint}?${qs.toString()}`)
  } else {
    res = await fetch(`${base}/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: qs.toString(),
    })
  }

  const text = await res.text()
  // deno-lint-ignore no-explicit-any
  let data: any = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = { raw: text }
  }
  return { ok: res.ok, status: res.status, data }
}
