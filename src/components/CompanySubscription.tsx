import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import {
  addSubscriptionPayment,
  deleteSubscriptionPayment,
  getCompanySubscription,
  listPlans,
  listSubscriptionPayments,
  saveSubscription,
  type SubscriptionPatch,
} from '../api/billing'
import { SUBSCRIPTION_STATUS_LABELS } from '../types/billing'
import { formatMoney } from '../lib/format'
import { Button, CollapsibleCard, Label, Spinner, TextInput } from './ui'

const DAY_MS = 24 * 60 * 60 * 1000

function fmtDate(iso: string | null): string {
  if (!iso) return 'sin vencimiento'
  return new Date(iso).toLocaleDateString('es-CL')
}

// Color del badge según el estado de la suscripción.
const STATUS_CLASS: Record<string, string> = {
  trialing: 'bg-amber-100 text-amber-800',
  active: 'bg-emerald-100 text-emerald-800',
  manual: 'bg-emerald-100 text-emerald-800',
  past_due: 'bg-red-100 text-red-800',
  paused: 'bg-slate-200 text-slate-600',
  canceled: 'bg-red-100 text-red-800',
}

/**
 * Gestión manual de la suscripción de una empresa (sólo superadmin). Permite
 * asignar plan, iniciar prueba, activar (manual), pausar o cancelar. El pago
 * automático (Flow) llega en una fase posterior.
 */
export function CompanySubscription({ companyId }: { companyId: string }) {
  const qc = useQueryClient()
  const { data: plans } = useQuery({ queryKey: ['plans'], queryFn: listPlans })
  const { data: sub, isLoading } = useQuery({
    queryKey: ['subscription', companyId],
    queryFn: () => getCompanySubscription(companyId),
  })

  const save = useMutation({
    mutationFn: (patch: SubscriptionPatch) => saveSubscription(companyId, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['subscription', companyId] })
      qc.invalidateQueries({ queryKey: ['company', companyId] })
    },
  })

  const [until, setUntil] = useState('')

  // Precio especial de la empresa (se sincroniza al cargar la suscripción).
  const [customPrice, setCustomPrice] = useState('')
  useEffect(() => {
    setCustomPrice(sub?.custom_price != null ? String(sub.custom_price) : '')
  }, [sub?.custom_price])

  // --- Pagos registrados ---
  const { data: payments } = useQuery({
    queryKey: ['subscription-payments', companyId],
    queryFn: () => listSubscriptionPayments(companyId),
  })
  const [payAmount, setPayAmount] = useState('')
  const [payDate, setPayDate] = useState('')
  const [payMethod, setPayMethod] = useState('transferencia')
  const [payNotes, setPayNotes] = useState('')

  const addPayment = useMutation({
    mutationFn: () =>
      addSubscriptionPayment({
        company_id: companyId,
        amount: Number(payAmount),
        paid_at: payDate || new Date().toISOString().slice(0, 10),
        method: payMethod,
        notes: payNotes.trim() || null,
      }),
    onSuccess: () => {
      setPayAmount('')
      setPayDate('')
      setPayNotes('')
      qc.invalidateQueries({ queryKey: ['subscription-payments', companyId] })
    },
  })

  const delPayment = useMutation({
    mutationFn: (id: string) => deleteSubscriptionPayment(id),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['subscription-payments', companyId] }),
  })

  if (isLoading) return <Spinner />

  const planId = sub?.plan_id ?? ''
  const selectedPlan = plans?.find((p) => p.id === planId) ?? sub?.plan ?? null

  function startTrial() {
    const days = selectedPlan?.trial_days ?? 10
    const iso = new Date(Date.now() + days * DAY_MS).toISOString()
    save.mutate({
      status: 'trialing',
      access_until: iso,
      trial_end: iso,
      canceled_at: null,
    })
  }

  function activate() {
    const iso = until ? new Date(`${until}T23:59:59`).toISOString() : null
    save.mutate({
      status: 'manual',
      access_until: iso,
      activated_at: new Date().toISOString(),
      canceled_at: null,
    })
  }

  const busy = save.isPending
  const canAddPayment = Number(payAmount) > 0

  return (
    <>
    <CollapsibleCard
      title="Plan y suscripción"
      subtitle="Asigna el plan y administra el acceso de la empresa (activación manual)."
      right={
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
            sub ? STATUS_CLASS[sub.status] : 'bg-slate-200 text-slate-600'
          }`}
        >
          {sub ? SUBSCRIPTION_STATUS_LABELS[sub.status] : 'Sin suscripción'}
        </span>
      }
    >

      {/* Estado actual */}
      <div className="mb-5 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg bg-slate-50 px-4 py-3 text-sm">
        <span className="flex items-center gap-2">
          <span className="text-slate-500">Estado:</span>
          <span
            className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
              sub ? STATUS_CLASS[sub.status] : 'bg-slate-200 text-slate-600'
            }`}
          >
            {sub ? SUBSCRIPTION_STATUS_LABELS[sub.status] : 'Sin suscripción'}
          </span>
        </span>
        {sub ? (
          <span className="text-slate-500">
            Acceso hasta:{' '}
            <span className="font-medium text-slate-700">
              {fmtDate(sub.access_until)}
            </span>
          </span>
        ) : (
          <span className="text-slate-400">Acceso libre (legado).</span>
        )}
      </div>

      {/* Plan y precio especial */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label>Plan</Label>
          <select
            value={planId}
            disabled={busy}
            onChange={(e) => save.mutate({ plan_id: e.target.value || null })}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
          >
            <option value="">Sin plan</option>
            {(plans ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} — {formatMoney(p.price)}/mes
              </option>
            ))}
          </select>
        </div>

        <div>
          <Label>Precio especial (opcional)</Label>
          <div className="flex items-center gap-2">
            <TextInput
              type="number"
              min="0"
              step="1"
              value={customPrice}
              onChange={(e) => setCustomPrice(e.target.value)}
              placeholder={
                selectedPlan ? String(selectedPlan.price) : 'Precio del plan'
              }
              className="min-w-0 flex-1"
            />
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() =>
                save.mutate({
                  custom_price:
                    customPrice.trim() === '' ? null : Number(customPrice),
                })
              }
            >
              Guardar
            </Button>
            {sub?.custom_price != null && (
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  setCustomPrice('')
                  save.mutate({ custom_price: null })
                }}
              >
                Quitar
              </Button>
            )}
          </div>
          <p className="mt-1 text-xs text-slate-400">
            Se cobra este monto (en vez del precio del plan) al pagar con Flow.
            Requiere un plan asignado.
          </p>
        </div>
      </div>

      <div className="my-5 border-t border-slate-100" />

      {/* Acciones de acceso, agrupadas */}
      <p className="mb-3 text-sm font-medium text-slate-700">
        Acciones de acceso
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        {/* Prueba */}
        <div className="rounded-lg border border-slate-200 p-3">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">
            Prueba
          </p>
          <Button
            type="button"
            variant="secondary"
            className="w-full"
            disabled={busy}
            onClick={startTrial}
          >
            🎁 Iniciar prueba ({selectedPlan?.trial_days ?? 10} días)
          </Button>
        </div>

        {/* Activación manual */}
        <div className="rounded-lg border border-slate-200 p-3">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">
            Activar (manual)
          </p>
          <label className="mb-1 block text-xs text-slate-500">
            Acceso hasta (opcional)
          </label>
          <input
            type="date"
            value={until}
            onChange={(e) => setUntil(e.target.value)}
            className="mb-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
          />
          <Button
            type="button"
            className="w-full"
            disabled={busy}
            onClick={activate}
          >
            ✓ Activar
          </Button>
        </div>

        {/* Suspender */}
        <div className="rounded-lg border border-slate-200 p-3">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">
            Suspender acceso
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="secondary"
              className="flex-1"
              disabled={busy || !sub}
              onClick={() => save.mutate({ status: 'paused' })}
            >
              Pausar
            </Button>
            <Button
              type="button"
              variant="danger"
              className="flex-1"
              disabled={busy || !sub}
              onClick={() =>
                save.mutate({
                  status: 'canceled',
                  canceled_at: new Date().toISOString(),
                })
              }
            >
              Cancelar
            </Button>
          </div>
        </div>
      </div>

      {save.isError && (
        <p className="mt-3 text-sm text-red-600">
          Error al guardar: {(save.error as Error).message}
        </p>
      )}
    </CollapsibleCard>

    {/* Pagos registrados (los ve la empresa en su módulo Suscripción) */}
    <CollapsibleCard
      title="Pagos registrados"
      subtitle="Registra manualmente los pagos recibidos. La empresa los ve en su módulo de Suscripción."
    >

      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (canAddPayment) addPayment.mutate()
        }}
        className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
      >
        <div>
          <Label>Monto *</Label>
          <TextInput
            type="number"
            min="0"
            step="1"
            value={payAmount}
            onChange={(e) => setPayAmount(e.target.value)}
            placeholder="40000"
          />
        </div>
        <div>
          <Label>Fecha</Label>
          <TextInput
            type="date"
            value={payDate}
            onChange={(e) => setPayDate(e.target.value)}
          />
        </div>
        <div>
          <Label>Método</Label>
          <select
            value={payMethod}
            onChange={(e) => setPayMethod(e.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
          >
            <option value="transferencia">Transferencia</option>
            <option value="efectivo">Efectivo</option>
            <option value="tarjeta">Tarjeta</option>
            <option value="flow">Flow</option>
          </select>
        </div>
        <div>
          <Label>Nota</Label>
          <TextInput
            value={payNotes}
            onChange={(e) => setPayNotes(e.target.value)}
            placeholder="Opcional"
          />
        </div>
        <div className="sm:col-span-2 lg:col-span-4">
          <Button type="submit" disabled={!canAddPayment || addPayment.isPending}>
            {addPayment.isPending ? 'Guardando…' : '+ Registrar pago'}
          </Button>
          {addPayment.isError && (
            <span className="ml-3 text-sm text-red-600">
              {(addPayment.error as Error).message}
            </span>
          )}
        </div>
      </form>

      {!payments || payments.length === 0 ? (
        <p className="text-sm text-slate-400">Sin pagos registrados.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
                <th className="px-3 py-2">Fecha</th>
                <th className="px-3 py-2 text-right">Monto</th>
                <th className="px-3 py-2">Método</th>
                <th className="px-3 py-2">Nota</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id} className="border-b border-slate-100 last:border-0">
                  <td className="whitespace-nowrap px-3 py-2 text-slate-700">
                    {new Date(p.paid_at).toLocaleDateString('es-CL')}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-medium tabular-nums text-slate-900">
                    {formatMoney(p.amount)}
                  </td>
                  <td className="px-3 py-2 text-slate-600">{p.method ?? '—'}</td>
                  <td className="px-3 py-2 text-slate-500">{p.notes ?? '—'}</td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => {
                        if (confirm('¿Eliminar este pago?')) delPayment.mutate(p.id)
                      }}
                      className="rounded-lg px-2 py-1 text-slate-400 hover:bg-slate-100 hover:text-red-600"
                      aria-label="Eliminar pago"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </CollapsibleCard>
    </>
  )
}
