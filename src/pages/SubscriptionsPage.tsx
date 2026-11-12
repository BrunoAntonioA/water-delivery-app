import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  listAllSubscriptions,
  monthlyCharge,
  type SubscriptionOverview,
} from '../api/billing'
import { formatMoney } from '../lib/format'
import {
  SUBSCRIPTION_STATUS_LABELS,
  accessDaysLeft,
  subscriptionActive,
  type Subscription,
  type SubscriptionStatus,
} from '../types/billing'
import {
  Card,
  EmptyState,
  PageHeader,
  Spinner,
  TextInput,
} from '../components/ui'

const STATUS_CLASSES: Record<SubscriptionStatus, string> = {
  trialing: 'bg-amber-100 text-amber-800',
  active: 'bg-emerald-100 text-emerald-800',
  manual: 'bg-emerald-100 text-emerald-800',
  past_due: 'bg-red-100 text-red-800',
  paused: 'bg-slate-200 text-slate-600',
  canceled: 'bg-red-100 text-red-800',
}

// Estados que se cobran (las pruebas aún no pagan).
const PAID_STATUSES: SubscriptionStatus[] = ['active', 'manual']

type Filter = 'vigentes' | 'pagadas' | 'prueba' | 'todas'

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'vigentes', label: 'Vigentes' },
  { key: 'pagadas', label: 'Pagadas' },
  { key: 'prueba', label: 'En prueba' },
  { key: 'todas', label: 'Todas' },
]

function fmtDate(iso: string | null): string {
  if (!iso) return 'Sin vencimiento'
  return new Date(iso).toLocaleDateString('es-CL')
}

// subscriptionActive/accessDaysLeft sólo leen status y access_until.
const asSub = (s: SubscriptionOverview) => s as unknown as Subscription

/**
 * Suscripciones de todas las empresas (sólo superadmin): quién tiene plan, cuánto
 * se le cobra al mes y hasta cuándo tiene acceso. Al hacer clic en una fila se
 * abre el detalle de la empresa (plan, pagos registrados, usuarios, etc.).
 */
export default function SubscriptionsPage() {
  const navigate = useNavigate()
  const { data: subs, isLoading } = useQuery({
    queryKey: ['subscriptions-overview'],
    queryFn: listAllSubscriptions,
  })

  const [filter, setFilter] = useState<Filter>('vigentes')
  const [search, setSearch] = useState('')

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (subs ?? [])
      .filter((s) => {
        const vigente = subscriptionActive(asSub(s))
        if (filter === 'vigentes' && !vigente) return false
        if (filter === 'pagadas' && !(vigente && PAID_STATUSES.includes(s.status)))
          return false
        if (filter === 'prueba' && !(vigente && s.status === 'trialing'))
          return false
        if (q && !(s.company?.name ?? '').toLowerCase().includes(q)) return false
        return true
      })
      .sort((a, b) => {
        // Las que vencen antes, primero; las sin vencimiento, al final.
        const ta = a.access_until ? new Date(a.access_until).getTime() : Infinity
        const tb = b.access_until ? new Date(b.access_until).getTime() : Infinity
        if (ta !== tb) return ta - tb
        return (a.company?.name ?? '').localeCompare(b.company?.name ?? '')
      })
  }, [subs, filter, search])

  // Resumen: sólo cuenta lo que efectivamente se cobra (pagadas y vigentes).
  const summary = useMemo(() => {
    const all = subs ?? []
    const paid = all.filter(
      (s) => subscriptionActive(asSub(s)) && PAID_STATUSES.includes(s.status)
    )
    const trials = all.filter(
      (s) => subscriptionActive(asSub(s)) && s.status === 'trialing'
    )
    const mrr = paid.reduce((sum, s) => sum + (monthlyCharge(s) ?? 0), 0)
    return { paid: paid.length, trials: trials.length, mrr }
  }, [subs])

  const openCompany = (s: SubscriptionOverview) =>
    navigate(`/empresas/${s.company_id}`, { state: { from: 'suscripciones' } })

  return (
    <div>
      <PageHeader
        title="Suscripciones"
        subtitle="Planes de cada empresa, cuánto se les cobra y hasta cuándo tienen acceso."
      />

      {/* Resumen */}
      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <Card className="p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
            Pagadas vigentes
          </p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-slate-900">
            {summary.paid}
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
            Ingreso mensual
          </p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-slate-900">
            {formatMoney(summary.mrr)}
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
            En prueba
          </p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-slate-900">
            {summary.trials}
          </p>
        </Card>
      </div>

      {/* Filtros */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                filter === f.key
                  ? 'bg-sky-600 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <TextInput
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar empresa…"
          className="sm:max-w-xs"
        />
      </div>

      {isLoading ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <EmptyState>No hay suscripciones con este filtro.</EmptyState>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
                <th className="px-4 py-3">Empresa</th>
                <th className="px-4 py-3">Plan</th>
                <th className="px-4 py-3">Estado</th>
                <th className="px-4 py-3 text-right">Cobro mensual</th>
                <th className="px-4 py-3">Acceso hasta</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => {
                const charge = monthlyCharge(s)
                const vigente = subscriptionActive(asSub(s))
                const daysLeft = accessDaysLeft(asSub(s))
                return (
                  <tr
                    key={s.id}
                    onClick={() => openCompany(s)}
                    className="cursor-pointer border-b border-slate-100 last:border-0 hover:bg-slate-50"
                  >
                    <td className="px-4 py-3">
                      <Link
                        to={`/empresas/${s.company_id}`}
                        state={{ from: 'suscripciones' }}
                        onClick={(e) => e.stopPropagation()}
                        className="font-medium text-slate-900 hover:text-sky-700"
                      >
                        {s.company?.name ?? '—'}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                      {s.plan?.name ?? 'Sin plan'}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_CLASSES[s.status]}`}
                      >
                        {SUBSCRIPTION_STATUS_LABELS[s.status]}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                      {charge != null ? (
                        <>
                          <span className="font-medium text-slate-900">
                            {formatMoney(charge)}
                          </span>
                          {s.custom_price != null && (
                            <span className="ml-1.5 rounded-full bg-sky-100 px-1.5 py-0.5 text-[10px] font-medium text-sky-700">
                              Especial
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <span className="text-slate-700">
                        {fmtDate(s.access_until)}
                      </span>
                      {daysLeft != null && (
                        <span
                          className={`ml-2 text-xs ${
                            !vigente || daysLeft === 0
                              ? 'text-red-600'
                              : daysLeft <= 7
                                ? 'font-medium text-amber-600'
                                : 'text-slate-400'
                          }`}
                        >
                          {daysLeft === 0
                            ? 'vencida'
                            : `${daysLeft} ${daysLeft === 1 ? 'día' : 'días'}`}
                        </span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  )
}
