import { useQuery } from '@tanstack/react-query'
import { listSubscriptionPayments } from '../api/billing'
import { useAuth } from '../lib/auth'
import { formatMoney } from '../lib/format'
import {
  SUBSCRIPTION_STATUS_LABELS,
  accessDaysLeft,
  type SubscriptionStatus,
} from '../types/billing'
import { Card, EmptyState, PageHeader, Spinner } from '../components/ui'
import { FlowCheckout } from '../components/FlowCheckout'

// Número de contacto (WhatsApp) para solicitudes de pago/activación.
const CONTACT_WHATSAPP = '56945652653'

const STATUS_CLASSES: Record<SubscriptionStatus, string> = {
  trialing: 'bg-amber-100 text-amber-800',
  active: 'bg-emerald-100 text-emerald-800',
  manual: 'bg-emerald-100 text-emerald-800',
  past_due: 'bg-red-100 text-red-800',
  paused: 'bg-slate-100 text-slate-600',
  canceled: 'bg-red-100 text-red-800',
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('es-CL', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  })
}

export default function SubscriptionPage() {
  const { company, subscription } = useAuth()

  const { data: payments, isLoading } = useQuery({
    queryKey: ['subscription-payments', company?.id],
    queryFn: () => listSubscriptionPayments(company!.id),
    enabled: Boolean(company?.id),
  })

  const plan = subscription?.plan ?? null
  const status = subscription?.status ?? null
  const daysLeft = accessDaysLeft(subscription)

  const waMessage = encodeURIComponent(
    `Hola, quiero pagar mi plan${plan ? ` ${plan.name}` : ''} en Gestiona Agua.`
  )
  const waHref = `https://wa.me/${CONTACT_WHATSAPP}?text=${waMessage}`

  return (
    <div>
      <PageHeader
        title="Suscripción"
        subtitle="Tu plan, su vigencia y los pagos registrados."
      />

      {/* Resumen del plan */}
      <Card className="mb-6 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm text-slate-500">Plan actual</p>
            <p className="text-2xl font-bold text-slate-900">
              {plan?.name ?? 'Sin plan asignado'}
            </p>
            {plan && (
              <p className="mt-0.5 text-sm text-slate-500">
                {formatMoney(subscription?.custom_price ?? plan.price)} / mes
                {subscription?.custom_price != null && (
                  <span className="ml-1 text-sky-600">(precio especial)</span>
                )}
              </p>
            )}
          </div>
          {status && (
            <span
              className={`inline-flex rounded-full px-3 py-1 text-sm font-semibold ${STATUS_CLASSES[status]}`}
            >
              {SUBSCRIPTION_STATUS_LABELS[status]}
            </span>
          )}
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl bg-slate-50 px-4 py-3">
            <p className="text-xs uppercase tracking-wide text-slate-400">
              {status === 'trialing' ? 'La prueba termina' : 'Acceso hasta'}
            </p>
            <p className="mt-0.5 font-semibold text-slate-800">
              {subscription?.access_until
                ? fmtDate(subscription.access_until)
                : 'Sin vencimiento'}
            </p>
            {daysLeft != null && (
              <p className="mt-0.5 text-sm text-slate-500">
                {daysLeft === 0
                  ? 'Vence hoy'
                  : `Quedan ${daysLeft} ${daysLeft === 1 ? 'día' : 'días'}`}
              </p>
            )}
          </div>

          <div className="rounded-xl bg-slate-50 px-4 py-3">
            <p className="text-xs uppercase tracking-wide text-slate-400">
              Empresa
            </p>
            <p className="mt-0.5 font-semibold text-slate-800">
              {company?.name ?? '—'}
            </p>
          </div>
        </div>

        <a
          href={waHref}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-5 inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-emerald-700"
        >
          💬 Solicitar el pago por WhatsApp
        </a>
        <p className="mt-2 text-xs text-slate-400">
          Escríbenos y coordinamos el pago para renovar o activar tu plan.
        </p>
      </Card>

      {/* Pagar / renovar en línea con Flow */}
      <Card className="mb-6 p-5">
        <h2 className="font-semibold text-slate-900">Pagar o renovar</h2>
        <p className="mb-3 mt-0.5 text-sm text-slate-500">
          Paga en línea con Flow y tu acceso se renueva al confirmarse el pago.
        </p>
        <FlowCheckout currentPlanKey={plan?.key ?? null} />
      </Card>

      {/* Pagos registrados */}
      <h2 className="mb-3 font-semibold text-slate-900">Pagos registrados</h2>
      {isLoading ? (
        <Spinner />
      ) : !payments || payments.length === 0 ? (
        <EmptyState>Aún no hay pagos registrados.</EmptyState>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase text-slate-500">
                  <th className="px-4 py-2">Fecha</th>
                  <th className="px-4 py-2 text-right">Monto</th>
                  <th className="px-4 py-2">Método</th>
                  <th className="px-4 py-2">Período</th>
                  <th className="px-4 py-2">Nota</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr
                    key={p.id}
                    className="border-b border-slate-100 last:border-0"
                  >
                    <td className="whitespace-nowrap px-4 py-2 text-slate-700">
                      {fmtDate(p.paid_at)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-right font-medium tabular-nums text-slate-900">
                      {formatMoney(p.amount)}
                    </td>
                    <td className="px-4 py-2 text-slate-600">
                      {p.method ?? '—'}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-slate-600">
                      {p.period_start || p.period_end
                        ? `${fmtDate(p.period_start)} → ${fmtDate(p.period_end)}`
                        : '—'}
                    </td>
                    <td className="px-4 py-2 text-slate-500">{p.notes ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  )
}
