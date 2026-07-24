import type { Client, OrderStatus } from '../types/db'

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
