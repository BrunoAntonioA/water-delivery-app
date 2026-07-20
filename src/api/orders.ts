import { supabase } from '../lib/supabase'
import type { OrderDetail, OrderStatus, PaymentMethod } from '../types/db'

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
}

export async function listOrders(): Promise<OrderDetail[]> {
  const { data, error } = await supabase
    .from('orders')
    .select(
      '*, client:clients(*), address:addresses(*), items:order_items(*, product:products(*))'
    )
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as OrderDetail[]
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

  const { data: order, error } = await supabase
    .from('orders')
    .insert({
      client_id: input.client_id,
      address_id: input.address_id,
      notes: input.notes || null,
      status: 'ordered',
      total,
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

export async function updateOrderStatus(
  id: string,
  status: OrderStatus
): Promise<void> {
  const { error } = await supabase
    .from('orders')
    .update({ status })
    .eq('id', id)
  if (error) throw error
}

/** Marca el pedido como pagado registrando el método y el monto recibido. */
export async function markOrderPaid(
  id: string,
  paymentMethod: PaymentMethod,
  paidAmount: number
): Promise<void> {
  const { error } = await supabase
    .from('orders')
    .update({
      status: 'paid',
      payment_method: paymentMethod,
      paid_amount: paidAmount,
    })
    .eq('id', id)
  if (error) throw error
}

export async function deleteOrder(id: string): Promise<void> {
  const { error } = await supabase.from('orders').delete().eq('id', id)
  if (error) throw error
}
