import { supabase } from '../lib/supabase'
import type {
  OrderPayment,
  Prepayment,
  PrepaymentUsage,
} from '../types/db'

// Prepagos: el cliente paga productos por adelantado y se le entregan de a poco.
// El ingreso queda en el prepago; cada entrega es un pedido normal cuyas líneas
// de prepago valen $0 (ver create_order en schema.sql).

const PREPAYMENT_SELECT =
  '*, client:clients(id, name, surname, phone), items:prepayment_items(id, prepayment_id, product_id, quantity, unit_price, product:products(id, name))'

/** Todos los prepagos de la empresa (vigentes y anulados), más nuevos primero. */
export async function listPrepayments(): Promise<Prepayment[]> {
  // Paginado: Supabase corta en 1000 filas por consulta.
  const PAGE = 1000
  const all: Prepayment[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('prepayments')
      .select(PREPAYMENT_SELECT)
      .order('paid_at', { ascending: false })
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw error
    const batch = (data ?? []) as Prepayment[]
    all.push(...batch)
    if (batch.length < PAGE) break
  }
  return all
}

/** Entregado / programado por prepago y producto (lo calcula el servidor). */
export async function listPrepaymentUsage(): Promise<PrepaymentUsage[]> {
  const { data, error } = await supabase.rpc('prepayment_usage')
  if (error) throw error
  return ((data ?? []) as PrepaymentUsage[]).map((u) => ({
    ...u,
    delivered: Number(u.delivered),
    scheduled: Number(u.scheduled),
  }))
}

export interface PrepaymentInput {
  client_id: string
  items: { product_id: string; quantity: number }[]
  total: number // monto pagado (puede llevar descuento)
  payments: OrderPayment[] // 1 o 2 tramos; la suma = total
  notes: string
}

/** Registra el prepago (ingreso de hoy). Valida y guarda en una transacción. */
export async function createPrepayment(input: PrepaymentInput): Promise<string> {
  const { data, error } = await supabase.rpc('create_prepayment', {
    p_client_id: input.client_id,
    p_items: input.items,
    p_total: input.total,
    p_payments: input.payments,
    p_notes: input.notes || null,
  })
  if (error) throw error
  return data as string
}

/**
 * Edita un prepago vigente. La BD valida que ningún producto quede por debajo
 * de lo ya entregado/programado y que el cliente sólo cambie si no hay entregas.
 */
export async function updatePrepayment(
  id: string,
  input: PrepaymentInput
): Promise<void> {
  const { error } = await supabase.rpc('update_prepayment', {
    p_id: id,
    p_client_id: input.client_id,
    p_items: input.items,
    p_total: input.total,
    p_payments: input.payments,
    p_notes: input.notes || null,
  })
  if (error) throw error
}

/**
 * Cancela las entregas PENDIENTES del prepago (no toca lo entregado ni el
 * dinero). Devuelve cuántos pedidos se afectaron.
 */
export async function cancelPrepaymentPending(id: string): Promise<number> {
  const { data, error } = await supabase.rpc('cancel_prepayment_pending', {
    p_id: id,
  })
  if (error) throw error
  return Number(data ?? 0)
}

/**
 * Anula el prepago completo: elimina sus entregas (también las entregadas) y
 * registra la devolución del total con fecha de hoy.
 */
export async function refundPrepayment(id: string): Promise<void> {
  const { error } = await supabase.rpc('refund_prepayment', { p_id: id })
  if (error) throw error
}

/** Saldo de un producto dentro de un prepago. */
export interface PrepaymentLine {
  prepayment_id: string
  product_id: string
  productName: string
  purchased: number
  delivered: number
  scheduled: number
  available: number
}

/** Saldo por producto de un prepago, a partir de su uso. */
export function prepaymentLines(
  p: Prepayment,
  usage: PrepaymentUsage[]
): PrepaymentLine[] {
  return p.items.map((it) => {
    const u = usage.find(
      (x) => x.prepayment_id === p.id && x.product_id === it.product_id
    )
    const delivered = u?.delivered ?? 0
    const scheduled = u?.scheduled ?? 0
    return {
      prepayment_id: p.id,
      product_id: it.product_id,
      productName: it.product?.name ?? 'Producto',
      purchased: it.quantity,
      delivered,
      scheduled,
      // Un prepago anulado ya no tiene saldo para usar.
      available: p.refunded_at
        ? 0
        : Math.max(0, it.quantity - delivered - scheduled),
    }
  })
}
