import { supabase } from '../lib/supabase'
import {
  ALL_TIME,
  localDayStartISO,
  localNextDayStartISO,
  type DateRange,
} from '../lib/dateRange'
import { chunks, routeIdsInRange } from './routeRange'
import type {
  OrderDetail,
  OrderPayment,
  OrderStatus,
  PaymentMethod,
} from '../types/db'

// Redondea a 2 decimales (evita errores de punto flotante al sumar montos).
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

const paymentsTotal = (payments: OrderPayment[]) =>
  round2(payments.reduce((sum, p) => sum + Number(p.amount), 0))

export interface OrderItemInput {
  product_id: string
  quantity: number
  unit_price: number
  // Si sale de un prepago: vale $0 y descuenta del saldo (lo valida la BD).
  prepayment_id?: string | null
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

// Sólo las columnas que consume la UI (ahorro de egress): de los embeds no se
// traen imágenes/descripciones de producto ni datos del cliente que no se
// muestran. Incluye la ruta (para la fecha de entrega y el repartidor).
const ORDER_LIST_SELECT =
  '*, client:clients(id, name, surname, phone), address:addresses(id, address, comuna, observation), items:order_items(id, product_id, quantity, unit_price, prepayment_id, product:products(id, name)), stops:route_stops(route:routes(driver_id, route_date, driver_profile:profiles!driver_id(full_name, email)))'

type Stop = {
  route: {
    driver_id: string | null
    route_date: string | null
    driver_profile: { full_name: string | null; email: string | null } | null
  } | null
}
// PostgREST devuelve el embed como OBJETO (relación 1-a-1 por el unique de
// route_stops.order_id) o como arreglo según el caso: soportamos ambos.
type OrderRow = OrderDetail & { stops?: Stop | Stop[] | null }

/** Aplana el embed de ruta a driverId/driverName/routeDate en el pedido. */
function mapOrderRow({ stops, ...o }: OrderRow): OrderDetail {
  const stop = Array.isArray(stops) ? stops[0] : stops
  const route = stop?.route
  const dp = route?.driver_profile
  return {
    ...o,
    driverId: route?.driver_id ?? null,
    driverName: dp?.full_name || dp?.email || null,
    routeDate: route?.route_date ?? null,
  }
}

// Columnas que usan Reportes y Entregas (ahorro de egress): sin notas, ids
// internos ni observaciones de dirección, que esas pantallas no muestran.
const REPORT_ORDER_FIELDS =
  'id, client_id, customer_name, status, total, paid, payment_method, paid_amount, payments, returned_supplies, created_at, client:clients(name, surname, phone), address:addresses(address, comuna), items:order_items(id, product_id, quantity, unit_price, prepayment_id, product:products(name))'
const REPORT_ROUTE =
  'route:routes(driver_id, route_date, driver_profile:profiles!driver_id(full_name, email))'

/**
 * Pedidos para reportes, filtrados EN EL SERVIDOR por fecha de CREACIÓN (día
 * local, igual que en pantalla). Sin rango ('' / '') trae todo el historial.
 * Supabase corta en 1000 filas por consulta: se pagina con .range() (orden
 * estable con id de desempate).
 */
export async function listOrders(range: DateRange = ALL_TIME): Promise<OrderDetail[]> {
  const PAGE = 1000
  const all: OrderDetail[] = []
  for (let from = 0; ; from += PAGE) {
    let q = supabase
      .from('orders')
      .select(`${REPORT_ORDER_FIELDS}, stops:route_stops(${REPORT_ROUTE})`)
    if (range.from) q = q.gte('created_at', localDayStartISO(range.from))
    if (range.to) q = q.lt('created_at', localNextDayStartISO(range.to))
    const { data, error } = await q
      .order('created_at', { ascending: false })
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw error
    const batch = ((data ?? []) as unknown as OrderRow[]).map(mapOrderRow)
    all.push(...batch)
    if (batch.length < PAGE) break
  }
  return all
}

/**
 * Pedidos de las rutas cuya FECHA DE RUTA cae en el rango (Entregas y reporte
 * de Repartidores filtran así). Se resuelven las rutas del rango y luego sus
 * paradas con pedido. Con rango vacío conviene usar listOrders(), que también
 * incluye los pedidos que aún no están en una ruta.
 */
export async function listOrdersByRouteDate(range: DateRange): Promise<OrderDetail[]> {
  type StopRow = {
    order: OrderDetail | null
    route: Stop['route'] | Stop['route'][]
  }
  const PAGE = 1000
  const routeIds = await routeIdsInRange(range)
  const all: OrderDetail[] = []
  for (const ids of chunks(routeIds)) {
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from('route_stops')
        .select(`order:orders(${REPORT_ORDER_FIELDS}), ${REPORT_ROUTE}`)
        .in('route_id', ids)
        .not('order_id', 'is', null)
        .order('id', { ascending: true })
        .range(from, from + PAGE - 1)
      if (error) throw error
      const batch = (data ?? []) as unknown as StopRow[]
      for (const r of batch) {
        if (!r.order) continue
        const route = Array.isArray(r.route) ? r.route[0] : r.route
        all.push(mapOrderRow({ ...r.order, stops: { route } }))
      }
      if (batch.length < PAGE) break
    }
  }
  return all
}

/**
 * Pedidos AÚN NO PAGADOS de todo el historial ("Por cobrar"): las deudas viejas
 * no deben desaparecer por el rango de fechas. Son pocos y con columnas mínimas.
 */
export async function listUnpaidOrders(): Promise<OrderDetail[]> {
  const PAGE = 1000
  const all: OrderDetail[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('orders')
      .select('id, created_at, total, paid, customer_name, client:clients(name, surname)')
      .eq('paid', false)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw error
    const batch = (data ?? []) as unknown as OrderDetail[]
    all.push(...batch)
    if (batch.length < PAGE) break
  }
  return all
}

export interface OrdersPageFilters {
  query?: string
  clientId?: string
  from?: string
  to?: string
  status?: OrderStatus
  paid?: boolean
  method?: PaymentMethod
  // Período de cobro del cliente: '__none__' = sin período; o el valor concreto.
  period?: string
  limit: number
  offset: number
}

export interface OrdersPageResult {
  rows: OrderDetail[]
  total: number
}

/**
 * Página de pedidos filtrada y paginada EN EL SERVIDOR (lista de Pedidos). El
 * filtrado —incluida la búsqueda por nombre, que cruza clientes + venta rápida—
 * lo hace la función SQL search_order_ids; aquí sólo se traen los pedidos de esa
 * página con sus columnas mínimas, preservando el orden devuelto por la BD.
 */
export async function listOrdersPage(
  opts: OrdersPageFilters
): Promise<OrdersPageResult> {
  const { data: idRows, error } = await supabase.rpc('search_order_ids', {
    p_query: opts.query?.trim() || null,
    p_client: opts.clientId ?? null,
    p_from: opts.from ?? null,
    p_to: opts.to ?? null,
    p_status: opts.status ?? null,
    p_paid: opts.paid ?? null,
    p_method: opts.method ?? null,
    p_period: opts.period ?? null,
    p_limit: opts.limit,
    p_offset: opts.offset,
  })
  if (error) throw error
  const rows = (idRows ?? []) as { id: string; total: number }[]
  const ids = rows.map((r) => r.id)
  const total = rows.length > 0 ? Number(rows[0].total) : 0
  if (ids.length === 0) return { rows: [], total: 0 }

  const { data, error: e2 } = await supabase
    .from('orders')
    .select(ORDER_LIST_SELECT)
    .in('id', ids)
  if (e2) throw e2

  // `in` no conserva el orden: se reordena según los ids que devolvió la BD.
  const byId = new Map(
    ((data ?? []) as OrderRow[]).map((o) => [o.id, mapOrderRow(o)])
  )
  return {
    rows: ids.map((id) => byId.get(id)).filter(Boolean) as OrderDetail[],
    total,
  }
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

// Crea el pedido + sus ítems de forma ATÓMICA (función Postgres create_order):
// todo-o-nada, sin dejar un pedido sin ítems si algo falla a mitad.
export async function createOrder(input: OrderInput): Promise<string> {
  const { data, error } = await supabase.rpc('create_order', {
    p_client_id: input.client_id,
    p_address_id: input.address_id,
    p_notes: input.notes || null,
    p_items: input.items,
    p_paid: Boolean(input.paid),
    p_payment_method: input.payment_method ?? null,
  })
  if (error) throw error
  return data as string
}

/**
 * Edita un pedido y reemplaza sus ítems de forma ATÓMICA (función Postgres
 * update_order): el update + el borrado/inserción de ítems ocurren en una sola
 * transacción, así no queda un pedido sin ítems ni se pisan ediciones concurrentes.
 */
export async function updateOrder(
  id: string,
  input: OrderInput
): Promise<void> {
  const { error } = await supabase.rpc('update_order', {
    p_id: id,
    p_client_id: input.client_id,
    p_address_id: input.address_id,
    p_notes: input.notes || null,
    p_items: input.items,
    p_paid: Boolean(input.paid),
    p_payment_method: input.payment_method ?? null,
  })
  if (error) throw error
}

export interface ReturnedSupply {
  supply_id: string
  quantity: number
}

/**
 * Marca el pedido como ENTREGADO, guardando los INSUMOS devueltos (tipo +
 * cantidad) y el método de pago acordado. `returned_bidones` se guarda como la
 * suma de cantidades, por compatibilidad. Opcionalmente lo marca pagado en el
 * mismo paso (payments).
 */
export async function markOrderDelivered(
  id: string,
  returnedSupplies: ReturnedSupply[],
  // null = no tocar el método (pedido 100% prepagado: no hay nada que cobrar).
  paymentMethod: PaymentMethod | null,
  payments?: OrderPayment[] | null
): Promise<void> {
  const totalReturned = returnedSupplies.reduce(
    (sum, r) => sum + (Number(r.quantity) || 0),
    0
  )
  const patch: Record<string, unknown> = {
    status: 'delivered',
    returned_supplies: returnedSupplies,
    returned_bidones: totalReturned,
    delivered_at: new Date().toISOString(),
  }
  // Método acordado (o principal si ya pagó con el desglose).
  const method = payments?.length ? payments[0].method : paymentMethod
  if (method) patch.payment_method = method
  if (payments?.length) {
    patch.paid = true
    patch.paid_amount = paymentsTotal(payments)
    patch.payments = payments
  }
  const { error } = await supabase.from('orders').update(patch).eq('id', id)
  if (error) throw error
}

/** Deshace la entrega: vuelve a 'ordered' y limpia los insumos devueltos. */
export async function undeliverOrder(id: string): Promise<void> {
  const { error } = await supabase
    .from('orders')
    .update({
      status: 'ordered',
      returned_bidones: null,
      returned_supplies: null,
      delivered_at: null,
    })
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
