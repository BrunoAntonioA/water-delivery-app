import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { patchOrderInCaches } from '../lib/queryInvalidation'
import {
  markOrderDelivered,
  markOrderPaid,
  undeliverOrder,
  unmarkOrderPaid,
  type ReturnedSupply,
} from '../api/orders'
import { listSupplies } from '../api/supplies'
import type {
  OrderDetail,
  OrderPayment,
  PaymentMethod,
  WhatsappTemplate,
} from '../types/db'
import { useAuth } from '../lib/auth'
import { formatMoney } from '../lib/format'
import { orderClientName } from '../lib/order'
import {
  buildChargeMessage,
  orderTemplateContext,
  renderTemplate,
} from '../lib/whatsapp'
import { Modal } from './Modal'
import { PAYMENT_LABELS } from './StatusBadge'
import { TemplatePicker } from './TemplatePicker'
import { Button, Label, NumberInput, TextInput } from './ui'

// Redondea a 2 decimales para comparar montos sin errores de punto flotante.
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

/**
 * Acciones de un pedido: cobrar por WhatsApp y cambiar el estado.
 *
 * - Pedido → al marcar Entregado se puede indicar en el mismo paso si ya pagó
 *   (método + monto).
 * - Entregado → Marcar Pagado (método + monto).
 * - Entregado / Pagado → Deshacer: vuelve un paso atrás por si fue un error
 *   (al salir de "Pagado" se limpian método y monto).
 *
 * Se usa tanto en la lista de Pedidos como en la tabla de una Ruta.
 */
export function OrderActions({
  order,
  onChanged,
  className = '',
}: {
  order: OrderDetail
  onChanged: () => void
  className?: string
}) {
  const { company } = useAuth()
  const qc = useQueryClient()
  const [deliverOpen, setDeliverOpen] = useState(false)
  const [payOpen, setPayOpen] = useState(false)
  const [alsoPaid, setAlsoPaid] = useState(false)
  const [payMethod, setPayMethod] = useState<PaymentMethod | ''>('')
  const [payAmount, setPayAmount] = useState('')
  // Segundo método (pago dividido).
  const [splitPay, setSplitPay] = useState(false)
  const [payMethod2, setPayMethod2] = useState<PaymentMethod | ''>('')
  const [payAmount2, setPayAmount2] = useState('')
  // Insumos devueltos por el cliente (tipo + cantidad; se pueden agregar varios).
  const [returnedItems, setReturnedItems] = useState<ReturnedSupply[]>([
    { supply_id: '', quantity: 1 },
  ])
  const { data: supplies } = useQuery({
    queryKey: ['supplies'],
    queryFn: listSupplies,
  })
  const [chargeOpen, setChargeOpen] = useState(false)

  // Ante un error: avisa y reconcilia (onChanged refetchea el estado real, lo
  // que revierte el cambio optimista si la escritura falló).
  const onUndoError = (err: unknown) => {
    alert(`No se pudo actualizar: ${(err as Error).message}`)
    onChanged()
  }

  const deliverMutation = useMutation({
    mutationFn: ({
      returnedSupplies,
      method,
      payments,
    }: {
      returnedSupplies: ReturnedSupply[]
      method: PaymentMethod
      payments?: OrderPayment[] | null
    }) => markOrderDelivered(order.id, returnedSupplies, method, payments),
    // Optimista: el pedido se ve "Entregado" (y pagado si corresponde) al toque.
    onMutate: (vars) => {
      setDeliverOpen(false)
      patchOrderInCaches(qc, order.id, {
        status: 'delivered',
        ...(vars.payments?.length ? { paid: true } : {}),
      })
    },
    onSuccess: onChanged,
    onError: onUndoError,
  })

  const payMutation = useMutation({
    mutationFn: (payments: OrderPayment[]) => markOrderPaid(order.id, payments),
    onMutate: () => {
      setPayOpen(false)
      patchOrderInCaches(qc, order.id, { paid: true })
    },
    onSuccess: onChanged,
    onError: onUndoError,
  })

  const undeliverMutation = useMutation({
    mutationFn: () => undeliverOrder(order.id),
    onMutate: () => patchOrderInCaches(qc, order.id, { status: 'ordered' }),
    onSuccess: onChanged,
    onError: onUndoError,
  })

  const unpayMutation = useMutation({
    mutationFn: () => unmarkOrderPaid(order.id),
    onMutate: () => patchOrderInCaches(qc, order.id, { paid: false }),
    onSuccess: onChanged,
    onError: onUndoError,
  })

  const busy =
    deliverMutation.isPending ||
    payMutation.isPending ||
    undeliverMutation.isPending ||
    unpayMutation.isPending
  const canCharge = !order.paid
  const total = order.total

  // Pago dividido: dos métodos distintos, montos > 0 y suma igual al total.
  const splitSum = round2((Number(payAmount) || 0) + (Number(payAmount2) || 0))
  const splitValid =
    Boolean(payMethod) &&
    Boolean(payMethod2) &&
    payMethod !== payMethod2 &&
    payAmount.trim() !== '' &&
    payAmount2.trim() !== '' &&
    Number(payAmount) > 0 &&
    Number(payAmount2) > 0 &&
    splitSum === round2(total)
  // ¿El pago está listo? Con un solo método basta con elegir el método: el monto
  // es automáticamente el total (no se pide). Con dos métodos, la suma debe dar
  // el total.
  const paymentReady = splitPay ? splitValid : Boolean(payMethod)

  // Insumos devueltos válidos (con insumo elegido y cantidad > 0). Devolver algo
  // es OPCIONAL: si no eligen nada, se entrega sin devoluciones.
  const returnedSupplies: ReturnedSupply[] = returnedItems.filter(
    (it) => it.supply_id && it.quantity > 0
  )

  function setReturnedItem(i: number, patch: Partial<ReturnedSupply>) {
    setReturnedItems((l) =>
      l.map((it, idx) => (idx === i ? { ...it, ...patch } : it))
    )
  }
  function addReturnedRow() {
    setReturnedItems((l) => [...l, { supply_id: '', quantity: 1 }])
  }
  function removeReturnedRow(i: number) {
    setReturnedItems((l) => l.filter((_, idx) => idx !== i))
  }

  // Sólo insumos retornables aparecen como opción de devolución.
  const returnableSupplies = (supplies ?? []).filter((s) => s.returnable)

  /** Arma el desglose de pago a partir del estado del formulario. */
  function buildPayments(): OrderPayment[] {
    if (splitPay) {
      return [
        { method: payMethod as PaymentMethod, amount: round2(Number(payAmount)) },
        {
          method: payMethod2 as PaymentMethod,
          amount: round2(Number(payAmount2)),
        },
      ]
    }
    return [{ method: payMethod as PaymentMethod, amount: round2(total) }]
  }

  function resetPayFields() {
    setPayMethod('')
    setPayAmount('')
    setSplitPay(false)
    setPayMethod2('')
    setPayAmount2('')
  }

  function openDeliver() {
    setAlsoPaid(false)
    // Empieza SIN devoluciones: el usuario agrega sólo si el cliente devolvió algo.
    setReturnedItems([])
    resetPayFields()
    setDeliverOpen(true)
  }

  function openPay() {
    // El método suele venir del momento de la entrega; lo prellenamos.
    resetPayFields()
    setPayMethod(order.payment_method ?? '')
    setPayOpen(true)
  }

  return (
    <>
      <div className={className}>
        {/* Entrega (acción principal) */}
        {order.status === 'ordered' ? (
          <Button onClick={openDeliver} disabled={busy}>
            <CheckIcon /> Marcar Entregado
          </Button>
        ) : (
          <Button
            variant="secondary"
            onClick={() => undeliverMutation.mutate()}
            disabled={busy}
            title="Deshacer entrega (volver a Pedido)"
          >
            <UndoIcon /> Deshacer entrega
          </Button>
        )}

        {/* Pago (independiente de la entrega) */}
        {!order.paid ? (
          <Button variant="success" onClick={openPay} disabled={busy}>
            <CashIcon /> Marcar Pagado
          </Button>
        ) : (
          <Button
            variant="secondary"
            onClick={() => unpayMutation.mutate()}
            disabled={busy}
            title="Marcar como no pagado"
          >
            <UndoIcon /> Deshacer pago
          </Button>
        )}

        {/* Cobrar por WhatsApp: acción secundaria (sólo si aún no ha pagado) */}
        {canCharge && (
          <button
            type="button"
            onClick={() => setChargeOpen(true)}
            aria-label="Cobrar por WhatsApp"
            title="Cobrar por WhatsApp"
            className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-emerald-500 px-3.5 py-2 text-sm font-medium text-emerald-700 transition-colors hover:bg-emerald-50"
          >
            <WhatsAppIcon /> Cobrar
          </button>
        )}
      </div>

      {/* Marcar como entregado (con opción de registrar el pago en el mismo paso) */}
      <Modal
        open={deliverOpen}
        onClose={() => setDeliverOpen(false)}
        title="Marcar como entregado"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (!payMethod) return
            if (alsoPaid) {
              if (!paymentReady) return
              deliverMutation.mutate({
                returnedSupplies,
                method: payMethod,
                payments: buildPayments(),
              })
            } else {
              deliverMutation.mutate({ returnedSupplies, method: payMethod })
            }
          }}
          className="space-y-4"
        >
          <OrderSummary order={order} />

          <div>
            <div className="mb-1 flex items-center justify-between">
              <Label>Insumos devueltos (opcional)</Label>
              <button
                type="button"
                onClick={addReturnedRow}
                disabled={returnableSupplies.length === 0}
                className="text-sm font-medium text-sky-600 hover:text-sky-700 disabled:text-slate-300"
              >
                + Agregar devolución
              </button>
            </div>
            {returnedItems.length === 0 ? (
              <p className="text-sm text-slate-400">
                {returnableSupplies.length === 0
                  ? 'No hay insumos retornables. Márcalos en Productos → Insumos.'
                  : 'Sin devoluciones. Agrega una sólo si el cliente devolvió algo.'}
              </p>
            ) : (
              <div className="space-y-2">
                {returnedItems.map((it, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <select
                      value={it.supply_id}
                      onChange={(e) =>
                        setReturnedItem(i, { supply_id: e.target.value })
                      }
                      className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
                    >
                      <option value="">Insumo…</option>
                      {returnableSupplies.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                    <div className="w-16 shrink-0">
                      <NumberInput
                        min={1}
                        value={it.quantity}
                        onValueChange={(n) => setReturnedItem(i, { quantity: n })}
                        className="text-center"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => removeReturnedRow(i)}
                      className="shrink-0 rounded-lg px-2 py-2 text-slate-400 hover:bg-slate-100 hover:text-red-600"
                      aria-label="Quitar devolución"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <MethodSelector
            method={payMethod}
            setMethod={setPayMethod}
            label={splitPay ? 'Método del pago 1 *' : 'Método de pago *'}
          />

          <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-slate-200 px-4 py-3">
            <input
              type="checkbox"
              checked={alsoPaid}
              onChange={(e) => {
                setAlsoPaid(e.target.checked)
                if (!e.target.checked) {
                  setPayAmount('')
                  setSplitPay(false)
                  setPayMethod2('')
                  setPayAmount2('')
                }
              }}
              className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
            />
            <span className="text-sm font-medium text-slate-700">
              El cliente ya pagó
            </span>
          </label>

          {alsoPaid && (
            <SplitPaymentSection
              total={total}
              amount={payAmount}
              setAmount={setPayAmount}
              split={splitPay}
              setSplit={setSplitPay}
              method2={payMethod2}
              setMethod2={setPayMethod2}
              amount2={payAmount2}
              setAmount2={setPayAmount2}
              splitSum={splitSum}
              method1={payMethod}
            />
          )}

          {deliverMutation.isError && (
            <p className="text-sm text-red-600">
              Error al guardar: {(deliverMutation.error as Error).message}
            </p>
          )}

          <div className="sticky bottom-0 -mx-5 -mb-4 mt-2 flex flex-wrap justify-end gap-2 border-t border-slate-100 bg-white px-5 py-3">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setDeliverOpen(false)}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={busy || !payMethod || (alsoPaid && !paymentReady)}
            >
              {busy
                ? 'Guardando…'
                : alsoPaid
                  ? 'Entregar y cobrar'
                  : 'Marcar entregado'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Registrar pago (desde estado Entregado) */}
      <Modal open={payOpen} onClose={() => setPayOpen(false)} title="Registrar pago">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (!paymentReady) return
            payMutation.mutate(buildPayments())
          }}
          className="space-y-4"
        >
          <OrderSummary order={order} />

          <MethodSelector
            method={payMethod}
            setMethod={setPayMethod}
            label={splitPay ? 'Método del pago 1 *' : 'Método de pago *'}
          />

          <SplitPaymentSection
            total={total}
            amount={payAmount}
            setAmount={setPayAmount}
            split={splitPay}
            setSplit={setSplitPay}
            method2={payMethod2}
            setMethod2={setPayMethod2}
            amount2={payAmount2}
            setAmount2={setPayAmount2}
            splitSum={splitSum}
            method1={payMethod}
          />

          {payMutation.isError && (
            <p className="text-sm text-red-600">
              Error al guardar: {(payMutation.error as Error).message}
            </p>
          )}

          <div className="sticky bottom-0 -mx-5 -mb-4 mt-2 flex flex-wrap justify-end gap-2 border-t border-slate-100 bg-white px-5 py-3">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setPayOpen(false)}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              variant="success"
              disabled={!paymentReady || payMutation.isPending}
            >
              {payMutation.isPending ? 'Guardando…' : 'Confirmar pago'}
            </Button>
          </div>
        </form>
      </Modal>

      <TemplatePicker
        open={chargeOpen}
        onClose={() => setChargeOpen(false)}
        phone={order.client?.phone ?? ''}
        title="Cobrar por WhatsApp"
        buildMessage={(t: WhatsappTemplate | null) =>
          t
            ? renderTemplate(t.content, orderTemplateContext(order, company?.name))
            : buildChargeMessage(order, company?.name)
        }
      />
    </>
  )
}

function OrderSummary({ order }: { order: OrderDetail }) {
  return (
    <div className="rounded-lg bg-slate-50 px-4 py-3 text-sm">
      <p className="font-medium text-slate-700">{orderClientName(order)}</p>
      <p className="text-slate-500">
        Total del pedido:{' '}
        <span className="font-bold text-slate-900">
          {formatMoney(order.total)}
        </span>
      </p>
    </div>
  )
}

function MethodSelector({
  method,
  setMethod,
  label = 'Método de pago *',
}: {
  method: PaymentMethod | ''
  setMethod: (m: PaymentMethod) => void
  label?: string
}) {
  return (
    <div>
      <Label>{label}</Label>
      <div className="grid grid-cols-3 gap-2">
        {(['efectivo', 'transferencia', 'tarjeta'] as PaymentMethod[]).map(
          (m) => (
          <button
            type="button"
            key={m}
            onClick={() => setMethod(m)}
            className={`rounded-lg border px-2 py-2 text-xs font-medium leading-tight break-words transition-colors sm:px-3 sm:text-sm ${
              method === m
                ? 'border-sky-500 bg-sky-50 text-sky-700'
                : 'border-slate-300 text-slate-600 hover:bg-slate-50'
            }`}
          >
            {PAYMENT_LABELS[m]}
          </button>
        ))}
      </div>
    </div>
  )
}

function MoneyField({
  label,
  amount,
  setAmount,
  placeholder,
}: {
  label: string
  amount: string
  setAmount: (v: string) => void
  placeholder?: string
}) {
  return (
    <div>
      <Label>{label}</Label>
      <TextInput
        type="number"
        min="0"
        step="0.01"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  )
}

/**
 * Monto(s) del pago. Con UN método el monto es automáticamente el total del
 * pedido: no se pide, sólo se muestra "Pago: $total" (más rápido). Al activar
 * "Pagó con dos métodos" aparecen dos montos editables y la suma debe dar el
 * total del pedido.
 */
function SplitPaymentSection({
  total,
  amount,
  setAmount,
  split,
  setSplit,
  method1,
  method2,
  setMethod2,
  amount2,
  setAmount2,
  splitSum,
}: {
  total: number
  amount: string
  setAmount: (v: string) => void
  split: boolean
  setSplit: (b: boolean) => void
  method1: PaymentMethod | ''
  method2: PaymentMethod | ''
  setMethod2: (m: PaymentMethod) => void
  amount2: string
  setAmount2: (v: string) => void
  splitSum: number
}) {
  const sumMatches = round2(splitSum) === round2(total)
  const sameMethod = split && Boolean(method2) && method1 === method2

  // Un solo método: el monto es el total, no editable.
  if (!split) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <span className="font-medium">Pago</span>
          <span className="font-bold tabular-nums">{formatMoney(total)}</span>
        </div>
        <button
          type="button"
          onClick={() => setSplit(true)}
          className="text-sm font-medium text-sky-600 hover:text-sky-700"
        >
          + Pagó con dos métodos
        </button>
      </div>
    )
  }

  // Dos métodos: montos editables y la suma debe cuadrar con el total.
  return (
    <div className="space-y-3">
      <MoneyField
        label="Monto del pago 1 *"
        amount={amount}
        setAmount={setAmount}
      />
      <div className="space-y-3 rounded-lg border border-slate-200 p-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-slate-700">Pago 2</span>
          <button
            type="button"
            onClick={() => {
              setSplit(false)
              setMethod2('' as PaymentMethod)
              setAmount2('')
            }}
            className="text-sm font-medium text-red-600 hover:text-red-700"
          >
            Quitar
          </button>
        </div>
        <MethodSelector
          method={method2}
          setMethod={setMethod2}
          label="Método del pago 2 *"
        />
        <MoneyField
          label="Monto del pago 2 *"
          amount={amount2}
          setAmount={setAmount2}
        />
        {sameMethod && (
          <p className="text-sm text-red-600">
            Usa un método distinto al del pago 1.
          </p>
        )}
        <div
          className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm ${
            sumMatches
              ? 'bg-emerald-50 text-emerald-700'
              : 'bg-amber-50 text-amber-700'
          }`}
        >
          <span>Suma de los pagos</span>
          <span className="font-semibold tabular-nums">
            {formatMoney(splitSum)} / {formatMoney(total)}
          </span>
        </div>
      </div>
    </div>
  )
}

function UndoIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      className="shrink-0"
    >
      <path
        d="M9 14 4 9l5-5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M4 9h11a5 5 0 0 1 5 5v1"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      className="shrink-0"
      aria-hidden
    >
      <path
        d="M5 13l4 4L19 7"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function CashIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      className="shrink-0"
      aria-hidden
    >
      <rect
        x="2.5"
        y="6"
        width="19"
        height="12"
        rx="2"
        stroke="currentColor"
        strokeWidth="2"
      />
      <circle cx="12" cy="12" r="2.4" stroke="currentColor" strokeWidth="2" />
    </svg>
  )
}

function WhatsAppIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="currentColor"
      className="shrink-0"
    >
      <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91S17.5 2 12.04 2zm0 18.15h-.01a8.2 8.2 0 0 1-4.18-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.2 8.2 0 0 1-1.26-4.38c0-4.54 3.7-8.23 8.24-8.23 2.2 0 4.27.86 5.82 2.42a8.18 8.18 0 0 1 2.41 5.82c0 4.54-3.69 8.23-8.23 8.23zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.16.25-.64.8-.79.97-.14.16-.29.18-.54.06-.25-.12-1.05-.39-1.99-1.23-.74-.66-1.23-1.47-1.38-1.72-.14-.25-.01-.38.11-.5.11-.11.25-.29.37-.43.13-.14.17-.25.25-.41.08-.17.04-.31-.02-.43-.06-.12-.56-1.34-.76-1.84-.2-.48-.4-.42-.56-.42-.14 0-.31-.02-.47-.02-.16 0-.43.06-.65.31-.23.25-.86.85-.86 2.07 0 1.22.89 2.4 1.01 2.56.12.17 1.75 2.67 4.23 3.74.59.26 1.05.41 1.41.52.59.19 1.13.16 1.56.1.47-.07 1.47-.6 1.68-1.18.21-.58.21-1.07.14-1.18-.06-.11-.22-.17-.47-.29z" />
    </svg>
  )
}
