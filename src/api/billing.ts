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
    .order('sort', { ascending: true })
  if (error) {
    console.warn('No se pudieron cargar los planes:', error.message)
    return []
  }
  return (data ?? []) as Plan[]
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
