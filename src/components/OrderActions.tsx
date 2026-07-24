import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import {
  markOrderDelivered,
  markOrderPaid,
  updateOrderStatus,
} from '../api/orders'
import type {
  OrderDetail,
  OrderStatus,
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
import { PAYMENT_LABELS, STATUS_LABELS } from './StatusBadge'
import { TemplatePicker } from './TemplatePicker'
import { Button, Label, TextInput } from './ui'

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
  const [deliverOpen, setDeliverOpen] = useState(false)
  const [payOpen, setPayOpen] = useState(false)
  const [alsoPaid, setAlsoPaid] = useState(false)
  const [payMethod, setPayMethod] = useState<PaymentMethod | ''>('')
  const [payAmount, setPayAmount] = useState('')
  const [returned, setReturned] = useState('0')
  const [chargeOpen, setChargeOpen] = useState(false)

  const statusMutation = useMutation({
    mutationFn: (status: OrderStatus) => updateOrderStatus(order.id, status),
    onSuccess: () => {
      onChanged()
      setDeliverOpen(false)
    },
    onError: (err) => {
      // Los botones "Deshacer" no tienen UI de error propia; avisamos aquí para
      // que un fallo no parezca "no pasó nada".
      alert(`No se pudo cambiar el estado: ${(err as Error).message}`)
    },
  })

  function revertTo(status: OrderStatus) {
    statusMutation.mutate(status)
  }

  const deliverMutation = useMutation({
    mutationFn: ({
      returnedBidones,
      method,
    }: {
      returnedBidones: number
      method: PaymentMethod
    }) => markOrderDelivered(order.id, returnedBidones, method),
    onSuccess: () => {
      onChanged()
      setDeliverOpen(false)
    },
  })

  const payMutation = useMutation({
    mutationFn: ({
      method,
      amount,
      returnedBidones,
    }: {
      method: PaymentMethod
      amount: number
      returnedBidones?: number
    }) => markOrderPaid(order.id, method, amount, returnedBidones),
    onSuccess: () => {
      onChanged()
      setPayOpen(false)
      setDeliverOpen(false)
    },
  })

  const busy =
    statusMutation.isPending ||
    deliverMutation.isPending ||
    payMutation.isPending
  const canCharge = order.status === 'ordered' || order.status === 'delivered'
  const amountMatches =
    payAmount.trim() !== '' && round2(Number(payAmount)) === round2(order.total)
  const canConfirmPayment = Boolean(payMethod) && amountMatches
  const returnedValid =
    returned.trim() !== '' &&
    Number.isInteger(Number(returned)) &&
    Number(returned) >= 0

  function resetPayFields() {
    setPayMethod('')
    setPayAmount('')
  }

  function openDeliver() {
    setAlsoPaid(false)
    setReturned('0')
    resetPayFields()
    setDeliverOpen(true)
  }

  function openPay() {
    // El método suele venir del momento de la entrega; lo prellenamos.
    setPayMethod(order.payment_method ?? '')
    setPayAmount('')
    setPayOpen(true)
  }

  return (
    <>
      <div className={className}>
        {canCharge && (
          <Button
            variant="success"
            onClick={() => setChargeOpen(true)}
            aria-label="Cobrar por WhatsApp"
            title="Cobrar por WhatsApp"
          >
            <WhatsAppIcon />
          </Button>
        )}

        {order.status === 'ordered' && (
          <Button onClick={openDeliver} disabled={busy}>
            Marcar {STATUS_LABELS.delivered}
          </Button>
        )}

        {order.status === 'delivered' && (
          <>
            <Button onClick={openPay} disabled={busy}>
              Marcar {STATUS_LABELS.paid}
            </Button>
            <Button
              variant="ghost"
              onClick={() => revertTo('ordered')}
              disabled={busy}
              title="Volver a Pedido"
            >
              <UndoIcon /> Deshacer
            </Button>
          </>
        )}

        {order.status === 'paid' && (
          <>
            <Button
              variant="ghost"
              onClick={() => revertTo('delivered')}
              disabled={busy}
              title="Marcar como no pagado (volver a Entregado)"
            >
              <UndoIcon /> Deshacer pago
            </Button>
            <Button
              variant="ghost"
              onClick={() => revertTo('ordered')}
              disabled={busy}
              title="Volver a Pedido (anula entrega y pago)"
            >
              <UndoIcon /> Volver a pedido
            </Button>
          </>
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
            if (!returnedValid || !payMethod) return
            const returnedBidones = Number(returned)
            if (alsoPaid) {
              if (!amountMatches) return
              payMutation.mutate({
                method: payMethod,
                amount: round2(Number(payAmount)),
                returnedBidones,
              })
            } else {
              deliverMutation.mutate({ returnedBidones, method: payMethod })
            }
          }}
          className="space-y-4"
        >
          <OrderSummary order={order} />

          <div>
            <Label>Bidones devueltos *</Label>
            <TextInput
              type="number"
              min="0"
              step="1"
              value={returned}
              onChange={(e) => setReturned(e.target.value)}
              placeholder="0"
            />
            {!returnedValid && (
              <p className="mt-1 text-sm text-red-600">
                Ingresa un número entero de bidones (0 o más).
              </p>
            )}
          </div>

          <MethodSelector method={payMethod} setMethod={setPayMethod} />

          <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-slate-200 px-4 py-3">
            <input
              type="checkbox"
              checked={alsoPaid}
              onChange={(e) => {
                setAlsoPaid(e.target.checked)
                if (!e.target.checked) setPayAmount('')
              }}
              className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
            />
            <span className="text-sm font-medium text-slate-700">
              El cliente ya pagó
            </span>
          </label>

          {alsoPaid && (
            <AmountField
              amount={payAmount}
              setAmount={setPayAmount}
              total={order.total}
              amountMatches={amountMatches}
            />
          )}

          {(deliverMutation.isError || payMutation.isError) && (
            <p className="text-sm text-red-600">
              Error al guardar:{' '}
              {
                ((deliverMutation.error ?? payMutation.error) as Error)
                  .message
              }
            </p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setDeliverOpen(false)}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={
                busy ||
                !returnedValid ||
                !payMethod ||
                (alsoPaid && !amountMatches)
              }
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
            if (!canConfirmPayment) return
            payMutation.mutate({
              method: payMethod as PaymentMethod,
              amount: round2(Number(payAmount)),
            })
          }}
          className="space-y-4"
        >
          <OrderSummary order={order} />

          <PaymentFields
            method={payMethod}
            setMethod={setPayMethod}
            amount={payAmount}
            setAmount={setPayAmount}
            total={order.total}
            amountMatches={amountMatches}
          />

          {payMutation.isError && (
            <p className="text-sm text-red-600">
              Error al guardar: {(payMutation.error as Error).message}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-2">
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
              disabled={!canConfirmPayment || payMutation.isPending}
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
}: {
  method: PaymentMethod | ''
  setMethod: (m: PaymentMethod) => void
}) {
  return (
    <div>
      <Label>Método de pago *</Label>
      <div className="grid grid-cols-2 gap-2">
        {(['transferencia', 'efectivo'] as PaymentMethod[]).map((m) => (
          <button
            type="button"
            key={m}
            onClick={() => setMethod(m)}
            className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
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

function AmountField({
  amount,
  setAmount,
  total,
  amountMatches,
}: {
  amount: string
  setAmount: (v: string) => void
  total: number
  amountMatches: boolean
}) {
  return (
    <div>
      <Label>Monto recibido *</Label>
      <TextInput
        type="number"
        min="0"
        step="0.01"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        placeholder={String(total)}
      />
      {amount.trim() !== '' && !amountMatches && (
        <p className="mt-1 text-sm text-red-600">
          El monto debe ser igual al total del pedido ({formatMoney(total)}).
        </p>
      )}
    </div>
  )
}

function PaymentFields(props: {
  method: PaymentMethod | ''
  setMethod: (m: PaymentMethod) => void
  amount: string
  setAmount: (v: string) => void
  total: number
  amountMatches: boolean
}) {
  return (
    <>
      <MethodSelector method={props.method} setMethod={props.setMethod} />
      <AmountField
        amount={props.amount}
        setAmount={props.setAmount}
        total={props.total}
        amountMatches={props.amountMatches}
      />
    </>
  )
}

function UndoIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
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

function WhatsAppIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91S17.5 2 12.04 2zm0 18.15h-.01a8.2 8.2 0 0 1-4.18-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.2 8.2 0 0 1-1.26-4.38c0-4.54 3.7-8.23 8.24-8.23 2.2 0 4.27.86 5.82 2.42a8.18 8.18 0 0 1 2.41 5.82c0 4.54-3.69 8.23-8.23 8.23zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.16.25-.64.8-.79.97-.14.16-.29.18-.54.06-.25-.12-1.05-.39-1.99-1.23-.74-.66-1.23-1.47-1.38-1.72-.14-.25-.01-.38.11-.5.11-.11.25-.29.37-.43.13-.14.17-.25.25-.41.08-.17.04-.31-.02-.43-.06-.12-.56-1.34-.76-1.84-.2-.48-.4-.42-.56-.42-.14 0-.31-.02-.47-.02-.16 0-.43.06-.65.31-.23.25-.86.85-.86 2.07 0 1.22.89 2.4 1.01 2.56.12.17 1.75 2.67 4.23 3.74.59.26 1.05.41 1.41.52.59.19 1.13.16 1.56.1.47-.07 1.47-.6 1.68-1.18.21-.58.21-1.07.14-1.18-.06-.11-.22-.17-.47-.29z" />
    </svg>
  )
}
