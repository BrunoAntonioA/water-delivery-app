import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { listPlans, startFlowPayment } from '../api/billing'
import { useAuth } from '../lib/auth'
import { formatMoney } from '../lib/format'
import { Button, Spinner } from './ui'

/**
 * Selector de plan + botón "Pagar con Flow". Al pagar, se pide a la Edge Function
 * la URL de Flow y se redirige el navegador. Sólo el administrador puede pagar.
 * Se usa en la página de Suscripción y en el muro de pago (BillingWall).
 */
export function FlowCheckout({
  currentPlanKey,
}: {
  currentPlanKey?: string | null
}) {
  const { profile, subscription } = useAuth()
  const canPay = profile?.role === 'admin' || profile?.role === 'superadmin'
  // Precio especial negociado (lo fija el superadmin). Si existe (y hay un plan
  // asignado), la empresa paga ese monto por su plan actual.
  const customPrice = subscription?.custom_price ?? null
  const currentPlan = subscription?.plan ?? null

  const { data: plans, isLoading } = useQuery({
    queryKey: ['plans'],
    queryFn: listPlans,
  })

  const [payingKey, setPayingKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function pay(planKey: string) {
    setError(null)
    setPayingKey(planKey)
    try {
      const url = await startFlowPayment(planKey)
      window.location.href = url
    } catch (e) {
      setError((e as Error).message)
      setPayingKey(null)
    }
  }

  if (!canPay) {
    return (
      <p className="text-sm text-slate-500">
        Pídele a un administrador de la empresa que realice el pago.
      </p>
    )
  }

  // Precio especial: se paga el plan actual al monto negociado (una sola opción).
  if (customPrice != null && currentPlan) {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3 rounded-lg border border-sky-200 bg-sky-50 px-4 py-3">
          <div className="min-w-0">
            <p className="font-medium text-slate-800">
              Plan {currentPlan.name}
              <span className="ml-2 rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-700">
                Precio especial
              </span>
            </p>
            <p className="text-sm text-slate-500">
              {formatMoney(customPrice)} / mes
            </p>
          </div>
          <Button
            onClick={() => pay(currentPlan.key)}
            disabled={payingKey !== null}
          >
            {payingKey !== null ? 'Redirigiendo…' : 'Pagar con Flow'}
          </Button>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <p className="text-xs text-slate-400">
          Pago seguro procesado por Flow. Te redirigiremos para completarlo y tu
          acceso se renueva al confirmarse.
        </p>
      </div>
    )
  }

  if (isLoading) return <Spinner />
  if (!plans || plans.length === 0) {
    return <p className="text-sm text-slate-500">No hay planes disponibles.</p>
  }

  return (
    <div className="space-y-2">
      {plans.map((p) => (
        <div
          key={p.id}
          className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-4 py-3"
        >
          <div className="min-w-0">
            <p className="font-medium text-slate-800">
              {p.name}
              {currentPlanKey === p.key && (
                <span className="ml-2 rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-700">
                  Tu plan
                </span>
              )}
            </p>
            <p className="text-sm text-slate-500">{formatMoney(p.price)} / mes</p>
          </div>
          <Button onClick={() => pay(p.key)} disabled={payingKey !== null}>
            {payingKey === p.key ? 'Redirigiendo…' : 'Pagar con Flow'}
          </Button>
        </div>
      ))}
      {error && <p className="text-sm text-red-600">{error}</p>}
      <p className="text-xs text-slate-400">
        Pago seguro procesado por Flow. Te redirigiremos para completarlo y tu
        acceso se renueva al confirmarse.
      </p>
    </div>
  )
}
