import type { ModuleKey } from './auth'

// Módulos que se otorgan durante la PRUEBA (equivalente al plan Pro: todo menos
// "usuarios"). Se aplican mientras la suscripción está en estado 'trialing',
// sin importar el plan elegido.
export const TRIAL_MODULES: ModuleKey[] = [
  'rutas',
  'pedidos',
  'clientes',
  'productos',
  'costos',
  'abastecimiento',
  'entregas',
  'reportes',
  'plantillas',
]

export type SubscriptionStatus =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'paused'
  | 'canceled'
  | 'manual'

export interface Plan {
  id: string
  key: string
  name: string
  description: string | null
  price: number
  interval: string
  modules: ModuleKey[]
  max_users: number | null
  max_clients: number | null
  trial_days: number
  sort: number
  is_public: boolean
  active: boolean
}

export interface Subscription {
  id: string
  company_id: string
  plan_id: string | null
  status: SubscriptionStatus
  access_until: string | null
  trial_end: string | null
  activated_at: string | null
  canceled_at: string | null
  notes: string | null
  created_at: string
  updated_at: string
  // Cargado con embed cuando se consulta con el plan.
  plan?: Plan | null
}

export interface SubscriptionPayment {
  id: string
  company_id: string
  amount: number
  paid_at: string
  method: string | null
  period_start: string | null
  period_end: string | null
  notes: string | null
  created_at: string
}

export const SUBSCRIPTION_STATUS_LABELS: Record<SubscriptionStatus, string> = {
  trialing: 'Prueba',
  active: 'Activa',
  past_due: 'Pago pendiente',
  paused: 'Pausada',
  canceled: 'Cancelada',
  manual: 'Activa (manual)',
}

/**
 * ¿La empresa tiene acceso vigente? Refleja la misma lógica que la BD
 * (`company_has_access`): sin suscripción = legado (permitido); con
 * suscripción, sólo estados vigentes y no vencidos.
 */
export function subscriptionActive(sub: Subscription | null): boolean {
  if (!sub) return true
  if (!['trialing', 'active', 'manual'].includes(sub.status)) return false
  if (sub.access_until && new Date(sub.access_until) <= new Date()) return false
  return true
}

/**
 * Módulos efectivos de la empresa según su suscripción: durante la prueba se
 * usan los TRIAL_MODULES (Pro sin "usuarios"); con plan activo, los del plan;
 * si no hay suscripción (legado), la lista manual de la empresa.
 */
export function resolvedCompanyModules(
  sub: Subscription | null,
  companyModules: ModuleKey[] | undefined
): ModuleKey[] | undefined {
  if (sub?.status === 'trialing') return TRIAL_MODULES
  return sub?.plan?.modules ?? companyModules
}

/** Días restantes de la prueba (o del período con vencimiento). Null si no aplica. */
export function accessDaysLeft(sub: Subscription | null): number | null {
  if (!sub?.access_until) return null
  const ms = new Date(sub.access_until).getTime() - Date.now()
  if (ms <= 0) return 0
  return Math.ceil(ms / (1000 * 60 * 60 * 24))
}
