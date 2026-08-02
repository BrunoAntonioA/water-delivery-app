import type { OrderStatus, PaymentMethod } from '../types/db'

export const STATUS_LABELS: Record<OrderStatus, string> = {
  ordered: 'Sin entregar',
  delivered: 'Entregado',
}

export const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  transferencia: 'Transferencia',
  efectivo: 'Efectivo',
  tarjeta: 'Tarjeta',
}

const STATUS_CLASSES: Record<OrderStatus, string> = {
  ordered: 'bg-amber-100 text-amber-800',
  delivered: 'bg-sky-100 text-sky-800',
}

/** Badge del estado de ENTREGA. */
export function StatusBadge({ status }: { status: OrderStatus }) {
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_CLASSES[status]}`}
    >
      {STATUS_LABELS[status]}
    </span>
  )
}

/** Badge del estado de PAGO. */
export function PaidBadge({ paid }: { paid: boolean }) {
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${
        paid ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'
      }`}
    >
      {paid ? 'Pagado' : 'Pendiente de pago'}
    </span>
  )
}
