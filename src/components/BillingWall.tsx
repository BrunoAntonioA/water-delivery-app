import type { Subscription } from '../types/billing'
import { SUBSCRIPTION_STATUS_LABELS } from '../types/billing'
import { Button } from './ui'

/**
 * Pantalla de bloqueo cuando la empresa no tiene una suscripción vigente
 * (prueba vencida, pausada o cancelada). Mientras el pago es manual, invita a
 * contactar para reactivar. El acceso a los datos también está bloqueado a
 * nivel de base de datos (current_company_id() devuelve null).
 */
export function BillingWall({
  companyName,
  subscription,
  onSignOut,
}: {
  companyName: string
  subscription: Subscription | null
  onSignOut: () => void
}) {
  const status = subscription?.status
  const planName = subscription?.plan?.name
  const trialExpired = status === 'trialing'

  const title = trialExpired
    ? 'Tu período de prueba terminó'
    : status === 'canceled'
      ? 'Tu suscripción está cancelada'
      : status === 'paused'
        ? 'Tu suscripción está pausada'
        : 'Tu suscripción no está activa'

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-slate-50 px-4 py-10">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <div className="mb-4 text-5xl">💧</div>
        <h1 className="text-xl font-bold text-slate-900">{title}</h1>
        <p className="mt-2 text-sm text-slate-500">
          {companyName}
          {planName ? ` · Plan ${planName}` : ''}
          {status ? ` · ${SUBSCRIPTION_STATUS_LABELS[status]}` : ''}
        </p>

        <p className="mt-5 text-sm text-slate-600">
          Para volver a usar la aplicación, activa tu plan. Escríbenos y lo
          dejamos listo en minutos.
        </p>

        <div className="mt-5 space-y-2 text-sm">
          <a
            href="https://wa.me/56945652653?text=Hola,%20quiero%20activar%20mi%20plan"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 font-medium text-white transition-colors hover:bg-emerald-700"
          >
            Activar por WhatsApp
          </a>
          <a
            href="mailto:contacto@gestionaagua.cl?subject=Activar%20plan"
            className="flex items-center justify-center gap-2 rounded-lg border border-slate-300 px-4 py-2.5 font-medium text-slate-700 transition-colors hover:bg-slate-50"
          >
            Escribir un correo
          </a>
        </div>
      </div>

      <Button variant="ghost" onClick={onSignOut}>
        Cerrar sesión
      </Button>
    </div>
  )
}
