import { supabase } from '../lib/supabase'
import type {
  Plan,
  Subscription,
  SubscriptionPayment,
  SubscriptionStatus,
} from '../types/billing'

/**
 * Lista los planes activos (ordenados). Tolera que la tabla aún no exista (si no
 * se ha corrido la migración): devuelve [] en vez de romper la app.
 */
export async function listPlans(): Promise<Plan[]> {
  const { data, error } = await supabase
    .from('plans')
    .select('*')
    .eq('active', true)
    .eq('is_public', true) // excluye planes internos como "Prueba"
    .order('sort', { ascending: true })
  if (error) {
    console.warn('No se pudieron cargar los planes:', error.message)
    return []
  }
  return (data ?? []) as Plan[]
}

/**
 * Plan de PRUEBA (key 'prueba'): el que gobierna el período de prueba. Sus
 * módulos y días definen lo que recibe una empresa en estado 'trialing'.
 * Devuelve null si aún no existe (semilla no aplicada) para que el llamador use
 * un respaldo. Legible por todos (política plans_read).
 */
export async function getTrialPlan(): Promise<Plan | null> {
  const { data, error } = await supabase
    .from('plans')
    .select('*')
    .eq('key', 'prueba')
    .maybeSingle()
  if (error) {
    console.warn('No se pudo cargar el plan de prueba:', error.message)
    return null
  }
  return (data as Plan | null) ?? null
}

/** Todos los planes (incluye inactivos), para el editor del superadmin. */
export async function listAllPlans(): Promise<Plan[]> {
  const { data, error } = await supabase
    .from('plans')
    .select('*')
    .order('sort', { ascending: true })
  if (error) throw error
  return (data ?? []) as Plan[]
}

export interface PlanPatch {
  name?: string
  description?: string | null
  price?: number
  modules?: string[]
  max_users?: number | null
  max_clients?: number | null
  trial_days?: number
  is_public?: boolean
  active?: boolean
}

/** Edita un plan (sólo superadmin, por RLS). Se refleja en todo el sistema. */
export async function updatePlan(id: string, patch: PlanPatch): Promise<void> {
  const { error } = await supabase.from('plans').update(patch).eq('id', id)
  if (error) throw error
}

/**
 * Suscripción de una empresa (con su plan). Devuelve null si no tiene (empresa
 * "legado" con acceso libre) o si la tabla aún no existe.
 */
export async function getCompanySubscription(
  companyId: string
): Promise<Subscription | null> {
  const { data, error } = await supabase
    .from('subscriptions')
    .select('*, plan:plans(*)')
    .eq('company_id', companyId)
    .maybeSingle()
  if (error) {
    console.warn('No se pudo cargar la suscripción:', error.message)
    return null
  }
  return (data as Subscription | null) ?? null
}

export interface SubscriptionPatch {
  plan_id?: string | null
  status?: SubscriptionStatus
  access_until?: string | null
  trial_end?: string | null
  activated_at?: string | null
  canceled_at?: string | null
  notes?: string | null
  custom_price?: number | null
}

/**
 * Crea o actualiza la suscripción de una empresa (sólo superadmin, por RLS).
 * Activación manual mientras no está integrado el pago automático.
 */
export async function saveSubscription(
  companyId: string,
  patch: SubscriptionPatch
): Promise<void> {
  const { error } = await supabase.from('subscriptions').upsert(
    {
      company_id: companyId,
      ...patch,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'company_id' }
  )
  if (error) throw error
}

// --- Registro público (self-signup desde la landing) ---

export interface SignupInput {
  email: string
  password: string
  full_name: string
  last_name: string
  phone: string
  rut: string
  razon_social: string
  captchaToken?: string | null
}

/**
 * Crea la cuenta (admin), su empresa y una suscripción en prueba. El plan y los
 * días de la prueba los define el plan "Prueba" en la BD. Toda la lógica corre
 * en la Edge Function "signup-company" con el service role.
 */
export async function signupCompany(input: SignupInput): Promise<void> {
  const { error } = await supabase.functions.invoke('signup-company', {
    body: input,
  })
  if (error) {
    let message = error.message
    const context = (error as { context?: Response }).context
    if (context && typeof context.json === 'function') {
      try {
        const body = await context.json()
        if (body?.error) message = body.error
      } catch {
        /* sin cuerpo JSON: se usa el mensaje genérico */
      }
    }
    throw new Error(message)
  }
}

// --- Pago en línea con Flow ---

/**
 * Inicia un pago del plan indicado con Flow (Edge Function flow-create-payment).
 * Devuelve la URL de Flow a la que hay que redirigir el navegador. El monto lo
 * fija el servidor según el plan; aquí sólo se manda la clave del plan.
 */
export async function startFlowPayment(planKey: string): Promise<string> {
  const { data, error } = await supabase.functions.invoke('flow-create-payment', {
    body: { planKey },
  })
  if (error) {
    let message = error.message
    const context = (error as { context?: Response }).context
    if (context && typeof context.json === 'function') {
      try {
        const body = await context.json()
        if (body?.error) message = body.error
      } catch {
        /* sin cuerpo JSON */
      }
    }
    throw new Error(message)
  }
  const redirectUrl = (data as { redirectUrl?: string } | null)?.redirectUrl
  if (!redirectUrl) throw new Error('No se recibió la URL de pago de Flow')
  return redirectUrl
}

// --- Pagos de la suscripción (registro manual) ---

/** Pagos de una empresa (más recientes primero). Tolera tabla inexistente. */
export async function listSubscriptionPayments(
  companyId: string
): Promise<SubscriptionPayment[]> {
  const { data, error } = await supabase
    .from('subscription_payments')
    .select('*')
    .eq('company_id', companyId)
    .order('paid_at', { ascending: false })
  if (error) {
    console.warn('No se pudieron cargar los pagos:', error.message)
    return []
  }
  return (data ?? []) as SubscriptionPayment[]
}

export interface NewSubscriptionPayment {
  company_id: string
  amount: number
  paid_at: string
  method?: string | null
  period_start?: string | null
  period_end?: string | null
  notes?: string | null
}

/** Registra un pago de suscripción (sólo superadmin, por RLS). */
export async function addSubscriptionPayment(
  input: NewSubscriptionPayment
): Promise<void> {
  const { error } = await supabase.from('subscription_payments').insert(input)
  if (error) throw error
}

/** Elimina un pago registrado (sólo superadmin). */
export async function deleteSubscriptionPayment(id: string): Promise<void> {
  const { error } = await supabase
    .from('subscription_payments')
    .delete()
    .eq('id', id)
  if (error) throw error
}
