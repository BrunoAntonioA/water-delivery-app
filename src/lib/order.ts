import type {
  Client,
  OrderPayment,
  OrderStatus,
  PaymentMethod,
  ProductSupplyLink,
  RouteStopWithOrder,
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
 * Texto de los INSUMOS devueltos por el cliente ("2× Bidón 20L, 1× ..."). Si el
 * pedido es antiguo (sólo tenía el conteo) cae al número. "—" si no aplica.
 */
export function returnedSuppliesText(
  order: {
    status: OrderStatus
    returned_bidones: number | null
    returned_supplies: { supply_id: string; quantity: number }[] | null
  },
  supplyName: Map<string, string>
): string {
  if (order.status === 'ordered') return '—'
  const list = order.returned_supplies
  if (list && list.length > 0) {
    return list
      .map((r) => `${r.quantity}× ${supplyName.get(r.supply_id) ?? 'Insumo'}`)
      .join(', ')
  }
  if (order.returned_bidones != null && order.returned_bidones > 0) {
    return String(order.returned_bidones)
  }
  return '—'
}

/** Insumo requerido por una ruta: total y lo que falta por entregar. */
export interface RouteSupplyNeed {
  supply_id: string
  total: number // insumos de TODOS los pedidos de la ruta
  remaining: number // insumos de los pedidos aún no entregados (total − entregados)
}

/**
 * Suma los insumos (BOM de cada producto) que necesita una ruta a partir de sus
 * paradas. `productSupplies` mapea product_id → sus insumos (viene de la lista de
 * productos, que ya trae el desglose). Devuelve, por insumo: el total de la ruta
 * y el restante (solo pedidos aún NO entregados). Ignora retiros (paradas sin
 * pedido) y productos sin desglose de insumos.
 */
export function routeSupplyNeeds(
  stops: RouteStopWithOrder[],
  productSupplies: Map<string, ProductSupplyLink[]>
): RouteSupplyNeed[] {
  const total = new Map<string, number>()
  const remaining = new Map<string, number>()
  for (const stop of stops) {
    const order = stop.order
    if (!order) continue
    const pending = order.status !== 'delivered'
    for (const item of order.items) {
      const bom = productSupplies.get(item.product_id)
      if (!bom) continue
      for (const link of bom) {
        const qty = item.quantity * link.quantity
        total.set(link.supply_id, (total.get(link.supply_id) ?? 0) + qty)
        if (pending) {
          remaining.set(
            link.supply_id,
            (remaining.get(link.supply_id) ?? 0) + qty
          )
        }
      }
    }
  }
  return Array.from(total, ([supply_id, totalQty]) => ({
    supply_id,
    total: totalQty,
    remaining: remaining.get(supply_id) ?? 0,
  }))
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
