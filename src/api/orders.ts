import { supabase } from '../lib/supabase'
import type { OrderDetail, OrderPayment, PaymentMethod } from '../types/db'

// Redondea a 2 decimales (evita errores de punto flotante al sumar montos).
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

const paymentsTotal = (payments: OrderPayment[]) =>
  round2(payments.reduce((sum, p) => sum + Number(p.amount), 0))

export interface OrderItemInput {
  product_id: string
  quantity: number
  unit_price: number
}

export interface OrderInput {
  client_id: string
  address_id: string | null
  notes: string
  items: OrderItemInput[]
  // Pago al crear/editar (opcional). Si paid, se guarda método y monto = total.
  paid?: boolean
  payment_method?: PaymentMethod | null
}

export async function listOrders(): Promise<OrderDetail[]> {
  const { data, error } = await supabase
    .from('orders')
    .select(
      '*, client:clients(*), address:addresses(*), items:order_items(*, product:products(*)), stops:route_stops(route:routes(driver_id, driver_profile:profiles!driver_id(full_name, email)))'
    )
    .order('created_at', { ascending: false })
  if (error) throw error
  type Stop = {
    route: {
      driver_id: string | null
      driver_profile: { full_name: string | null; email: string | null } | null
    } | null
  }
  // PostgREST devuelve el embed como OBJETO (relación 1-a-1 por el unique de
  // route_stops.order_id) o como arreglo según el caso: soportamos ambos.
  type Row = OrderDetail & { stops?: Stop | Stop[] | null }
  return ((data ?? []) as Row[]).map(({ stops, ...o }) => {
    const stop = Array.isArray(stops) ? stops[0] : stops
    const route = stop?.route
    const dp = route?.driver_profile
    return {
      ...o,
      driverId: route?.driver_id ?? null,
      driverName: dp?.full_name || dp?.email || null,
    }
  })
}

export async function getOrder(id: string): Promise<OrderDetail> {
  const { data, error } = await supabase
    .from('orders')
    .select(
      '*, client:clients(*), address:addresses(*), items:order_items(*, product:products(*))'
    )
    .eq('id', id)
    .single()
  if (error) throw error
  return data as OrderDetail
}

export async function createOrder(input: OrderInput): Promise<string> {
  const total = input.items.reduce(
    (sum, it) => sum + it.quantity * it.unit_price,
    0
  )

  const paid = Boolean(input.paid)
  const { data: order, error } = await supabase
    .from('orders')
    .insert({
      client_id: input.client_id,
      address_id: input.address_id,
      notes: input.notes || null,
      status: 'ordered',
      total,
      paid,
      payment_method: input.payment_method ?? null,
      paid_amount: paid ? total : null,
      payments:
        paid && input.payment_method
          ? [{ method: input.payment_method, amount: total }]
          : null,
    })
    .select()
    .single()
  if (error) throw error

  const items = input.items.map((it) => ({
    order_id: order.id,
    product_id: it.product_id,
    quantity: it.quantity,
    unit_price: it.unit_price,
  }))

  const { error: itemsError } = await supabase
    .from('order_items')
    .insert(items)
  if (itemsError) throw itemsError

  return order.id as string
}

/** Edita un pedido: cliente, dirección, notas y productos (reemplaza los ítems). */
export async function updateOrder(
  id: string,
  input: OrderInput
): Promise<void> {
  const total = input.items.reduce(
    (sum, it) => sum + it.quantity * it.unit_price,
    0
  )

  const paid = Boolean(input.paid)
  const { error } = await supabase
    .from('orders')
    .update({
      client_id: input.client_id,
      address_id: input.address_id,
      notes: input.notes || null,
      total,
      paid,
      payment_method: input.payment_method ?? null,
      paid_amount: paid ? total : null,
      payments:
        paid && input.payment_method
          ? [{ method: input.payment_method, amount: total }]
          : null,
    })
    .eq('id', id)
  if (error) throw error

  // Reemplazo total de los ítems.
  const { error: delErr } = await supabase
    .from('order_items')
    .delete()
    .eq('order_id', id)
  if (delErr) throw delErr

  const items = input.items.map((it) => ({
    order_id: id,
    product_id: it.product_id,
    quantity: it.quantity,
    unit_price: it.unit_price,
  }))
  if (items.length > 0) {
    const { error: insErr } = await supabase.from('order_items').insert(items)
    if (insErr) throw insErr
  }
}

/**
 * Marca el pedido como ENTREGADO, guardando los bidones devueltos y el método de
 * pago acordado. Opcionalmente lo marca pagado en el mismo paso (payments).
 */
export async function markOrderDelivered(
  id: string,
  returnedBidones: number,
  paymentMethod: PaymentMethod,
  payments?: OrderPayment[] | null
): Promise<void> {
  const patch: Record<string, unknown> = {
    status: 'delivered',
    returned_bidones: returnedBidones,
    delivered_at: new Date().toISOString(),
    // Método acordado (o principal si ya pagó con el desglose).
    payment_method: payments?.length ? payments[0].method : paymentMethod,
  }
  if (payments?.length) {
    patch.paid = true
    patch.paid_amount = paymentsTotal(payments)
    patch.payments = payments
  }
  const { error } = await supabase.from('orders').update(patch).eq('id', id)
  if (error) throw error
}

/** Deshace la entrega: vuelve a 'ordered' y limpia los bidones devueltos. */
export async function undeliverOrder(id: string): Promise<void> {
  const { error } = await supabase
    .from('orders')
    .update({ status: 'ordered', returned_bidones: null, delivered_at: null })
    .eq('id', id)
  if (error) throw error
}

/**
 * Marca el pedido como PAGADO (independiente de la entrega). `payments` lleva
 * uno o dos tramos (método + monto); la suma debe ser igual al total del pedido.
 */
export async function markOrderPaid(
  id: string,
  payments: OrderPayment[]
): Promise<void> {
  const { error } = await supabase
    .from('orders')
    .update({
      paid: true,
      payment_method: payments[0]?.method ?? null,
      paid_amount: paymentsTotal(payments),
      payments,
    })
    .eq('id', id)
  if (error) throw error
}

/** Deshace el pago: paid=false y limpia monto y desglose (conserva el método). */
export async function unmarkOrderPaid(id: string): Promise<void> {
  const { error } = await supabase
    .from('orders')
    .update({ paid: false, paid_amount: null, payments: null })
    .eq('id', id)
  if (error) throw error
}

export async function deleteOrder(id: string): Promise<void> {
  const { error } = await supabase.from('orders').delete().eq('id', id)
  if (error) throw error
}
