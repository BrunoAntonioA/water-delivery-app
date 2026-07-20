import type { OrderStatus, PaymentMethod } from '../types/db'

export const STATUS_LABELS: Record<OrderStatus, string> = {
  ordered: 'Pedido',
  delivered: 'Entregado',
  paid: 'Pagado',
}

export const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  transferencia: 'Transferencia',
  efectivo: 'Efectivo',
}

const STATUS_CLASSES: Record<OrderStatus, string> = {
  ordered: 'bg-amber-100 text-amber-800',
  delivered: 'bg-sky-100 text-sky-800',
  paid: 'bg-emerald-100 text-emerald-800',
}

export function StatusBadge({ status }: { status: OrderStatus }) {
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_CLASSES[status]}`}
    >
      {STATUS_LABELS[status]}
    </span>
  )
}
