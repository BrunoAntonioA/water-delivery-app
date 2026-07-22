import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { markOrderPaid, updateOrderStatus } from '../api/orders'
import type { OrderDetail, PaymentMethod, WhatsappTemplate } from '../types/db'
import { useAuth } from '../lib/auth'
import { formatMoney } from '../lib/format'
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
 * Acciones de un pedido: cobrar por WhatsApp y avanzar el estado
 * (Pedido → Entregado → Pagado, con captura de método y monto al pagar).
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
  const [payOpen, setPayOpen] = useState(false)
  const [payMethod, setPayMethod] = useState<PaymentMethod | ''>('')
  const [payAmount, setPayAmount] = useState('')
  const [chargeOpen, setChargeOpen] = useState(false)

  const statusMutation = useMutation({
    mutationFn: (status: 'delivered') => updateOrderStatus(order.id, status),
    onSuccess: onChanged,
  })

  const payMutation = useMutation({
    mutationFn: ({
      method,
      amount,
    }: {
      method: PaymentMethod
      amount: number
    }) => markOrderPaid(order.id, method, amount),
    onSuccess: () => {
      onChanged()
      setPayOpen(false)
    },
  })

  const canCharge = order.status === 'ordered' || order.status === 'delivered'
  const amountMatches =
    payAmount.trim() !== '' && round2(Number(payAmount)) === round2(order.total)
  const canConfirmPayment = Boolean(payMethod) && amountMatches

  function openPay() {
    setPayMethod('')
    setPayAmount('')
    setPayOpen(true)
  }

  return (
    <>
      <div className={className}>
        {canCharge && (
          <Button variant="success" onClick={() => setChargeOpen(true)}>
            <WhatsAppIcon /> Cobrar
          </Button>
        )}
        {order.status === 'ordered' && (
          <Button
            onClick={() => statusMutation.mutate('delivered')}
            disabled={statusMutation.isPending}
          >
            Marcar {STATUS_LABELS.delivered}
          </Button>
        )}
        {order.status === 'delivered' && (
          <Button onClick={openPay}>Marcar {STATUS_LABELS.paid}</Button>
        )}
      </div>

      <Modal
        open={payOpen}
        onClose={() => setPayOpen(false)}
        title="Registrar pago"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (!payMethod || !canConfirmPayment) return
            payMutation.mutate({
              method: payMethod,
              amount: round2(Number(payAmount)),
            })
          }}
          className="space-y-4"
        >
          <div className="rounded-lg bg-slate-50 px-4 py-3 text-sm">
            <p className="font-medium text-slate-700">
              {order.client
                ? `${order.client.name} ${order.client.surname}`
                : 'Cliente'}
            </p>
            <p className="text-slate-500">
              Total del pedido:{' '}
              <span className="font-bold text-slate-900">
                {formatMoney(order.total)}
              </span>
            </p>
          </div>

          <div>
            <Label>Método de pago *</Label>
            <div className="grid grid-cols-2 gap-2">
              {(['transferencia', 'efectivo'] as PaymentMethod[]).map((m) => (
                <button
                  type="button"
                  key={m}
                  onClick={() => setPayMethod(m)}
                  className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                    payMethod === m
                      ? 'border-sky-500 bg-sky-50 text-sky-700'
                      : 'border-slate-300 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {PAYMENT_LABELS[m]}
                </button>
              ))}
            </div>
          </div>

          <div>
            <Label>Monto recibido *</Label>
            <TextInput
              type="number"
              min="0"
              step="0.01"
              value={payAmount}
              onChange={(e) => setPayAmount(e.target.value)}
              placeholder={String(order.total)}
            />
            {payAmount.trim() !== '' && !amountMatches && (
              <p className="mt-1 text-sm text-red-600">
                El monto debe ser igual al total del pedido (
                {formatMoney(order.total)}).
              </p>
            )}
          </div>

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

function WhatsAppIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91S17.5 2 12.04 2zm0 18.15h-.01a8.2 8.2 0 0 1-4.18-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.2 8.2 0 0 1-1.26-4.38c0-4.54 3.7-8.23 8.24-8.23 2.2 0 4.27.86 5.82 2.42a8.18 8.18 0 0 1 2.41 5.82c0 4.54-3.69 8.23-8.23 8.23zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.16.25-.64.8-.79.97-.14.16-.29.18-.54.06-.25-.12-1.05-.39-1.99-1.23-.74-.66-1.23-1.47-1.38-1.72-.14-.25-.01-.38.11-.5.11-.11.25-.29.37-.43.13-.14.17-.25.25-.41.08-.17.04-.31-.02-.43-.06-.12-.56-1.34-.76-1.84-.2-.48-.4-.42-.56-.42-.14 0-.31-.02-.47-.02-.16 0-.43.06-.65.31-.23.25-.86.85-.86 2.07 0 1.22.89 2.4 1.01 2.56.12.17 1.75 2.67 4.23 3.74.59.26 1.05.41 1.41.52.59.19 1.13.16 1.56.1.47-.07 1.47-.6 1.68-1.18.21-.58.21-1.07.14-1.18-.06-.11-.22-.17-.47-.29z" />
    </svg>
  )
}
