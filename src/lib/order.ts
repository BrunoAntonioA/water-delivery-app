import type {
  Client,
  OrderPayment,
  OrderStatus,
  PaymentMethod,
} from '../types/db'

type PaymentSource = {
  payments: OrderPayment[] | null
  payment_method: PaymentMethod | null
  paid_amount: number | null
  total: number
}

/**
 * Desglose de pago normalizado. Usa `payments` cuando existe; para pedidos
 * antiguos (sin desglose) reconstruye un único tramo con el método y el monto
 * guardados. Devuelve [] si no hay método de pago.
 */
export function orderPaymentList(order: PaymentSource): OrderPayment[] {
  if (order.payments && order.payments.length > 0) return order.payments
  if (order.payment_method) {
    return [
      { method: order.payment_method, amount: order.paid_amount ?? order.total },
    ]
  }
  return []
}

/** Monto pagado con un método específico (0 si el pedido no está pagado). */
export function paidWithMethod(
  order: PaymentSource & { paid: boolean },
  method: PaymentMethod
): number {
  if (!order.paid) return 0
  return orderPaymentList(order)
    .filter((p) => p.method === method)
    .reduce((sum, p) => sum + Number(p.amount), 0)
}

/**
 * Texto de los bidones devueltos por el cliente en la entrega. Sólo aplica una
 * vez entregado; en pedidos pendientes o sin dato devuelve "—".
 */
export function returnedBidonesText(order: {
  status: OrderStatus
  returned_bidones: number | null
}): string {
  if (order.status === 'ordered' || order.returned_bidones == null) return '—'
  return String(order.returned_bidones)
}

/**
 * Nombre a mostrar de un pedido: el del cliente registrado, o el nombre libre
 * de una venta rápida (sin cliente), o un texto por defecto.
 */
export function orderClientName(order: {
  client: Client | null
  customer_name: string | null
}): string {
  if (order.client) {
    return `${order.client.name} ${order.client.surname}`.trim()
  }
  return order.customer_name?.trim() || 'Venta rápida'
}
