import { supabase } from '../lib/supabase'
import type { OrderDetail, OrderStatus, Route, RouteDetail } from '../types/db'

const ORDER_SELECT =
  'order:orders(*, client:clients(*), address:addresses(*), items:order_items(*, product:products(*)))'

export interface RouteInput {
  name: string
  route_date: string
  driver: string
  driver_id: string | null
  notes: string
}

export interface Driver {
  id: string
  full_name: string | null
  email: string | null
  role: 'admin' | 'repartidor'
}

/**
 * Usuarios que pueden ir asignados a una ruta: los repartidores y también los
 * admins (un admin puede hacer reparto). Se listan los repartidores primero.
 */
export async function listDrivers(): Promise<Driver[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, email, role')
    .in('role', ['repartidor', 'admin'])
    .order('full_name', { ascending: true })
  if (error) throw error
  const rows = (data ?? []) as Driver[]
  return rows.sort((a, b) => {
    if (a.role !== b.role) return a.role === 'repartidor' ? -1 : 1
    return (a.full_name || a.email || '').localeCompare(
      b.full_name || b.email || ''
    )
  })
}

/** Etiqueta para el selector de repartidor (marca a los admins). */
export function driverLabel(d: Driver): string {
  const name = d.full_name || d.email || 'Sin nombre'
  return d.role === 'admin' ? `${name} (admin)` : name
}

export interface RouteSummary extends Route {
  stopCount: number
  deliveredCount: number // entregados o pagados
  paidCount: number
  driverName: string | null
}

type DriverProfile = { full_name: string | null; email: string | null } | null

function driverNameOf(p: DriverProfile, fallback: string | null): string | null {
  return p?.full_name || p?.email || fallback
}

export async function listRoutes(): Promise<RouteSummary[]> {
  const { data, error } = await supabase
    .from('routes')
    .select(
      '*, stops:route_stops(id, order:orders(status, paid), pickup:route_pickups(done)), driver_profile:profiles!driver_id(full_name, email)'
    )
    .order('route_date', { ascending: false })
  if (error) throw error
  return (data ?? []).map((r) => {
    const { stops, driver_profile, ...route } = r as Route & {
      stops: {
        id: string
        order: { status: OrderStatus; paid: boolean } | null
        pickup: { done: boolean } | null
      }[]
      driver_profile: DriverProfile
    }
    const list = stops ?? []
    // Una parada está "completada" si el pedido se entregó o si el retiro se
    // recogió (los retiros no tienen "order" pero cuentan como cumplidos).
    const deliveredCount = list.filter(
      (s) => (s.order && s.order.status !== 'ordered') || s.pickup?.done
    ).length
    const paidCount = list.filter(
      (s) => s.order?.paid || s.pickup?.done
    ).length
    return {
      ...route,
      stopCount: list.length,
      deliveredCount,
      paidCount,
      driverName: driverNameOf(driver_profile, route.driver),
    }
  })
}

export async function getRoute(id: string): Promise<RouteDetail> {
  const { data, error } = await supabase
    .from('routes')
    .select(
      `*, stops:route_stops(*, ${ORDER_SELECT}, pickup:route_pickups(*, client:clients(*))), loads:route_loads(*), driver_profile:profiles!driver_id(full_name, email)`
    )
    .eq('id', id)
    .single()
  if (error) throw error
  const { driver_profile, ...rest } = data as RouteDetail & {
    driver_profile: DriverProfile
  }
  const route = rest as RouteDetail
  route.driverName = driverNameOf(driver_profile, route.driver)
  // Ordenar las paradas por su posición.
  route.stops = [...route.stops].sort((a, b) => a.position - b.position)
  return route
}

export async function createRoute(input: RouteInput): Promise<string> {
  const { data, error } = await supabase
    .from('routes')
    .insert({
      name: input.name || null,
      route_date: input.route_date,
      driver: input.driver || null,
      driver_id: input.driver_id,
      notes: input.notes || null,
    })
    .select()
    .single()
  if (error) throw error
  return data.id as string
}

export async function updateRoute(
  id: string,
  input: RouteInput
): Promise<void> {
  const { error } = await supabase
    .from('routes')
    .update({
      name: input.name || null,
      route_date: input.route_date,
      driver: input.driver || null,
      driver_id: input.driver_id,
      notes: input.notes || null,
    })
    .eq('id', id)
  if (error) throw error
}

/** Asigna (o quita) el repartidor de una ruta. */
export async function setRouteDriver(
  id: string,
  driverId: string | null
): Promise<void> {
  const { error } = await supabase
    .from('routes')
    .update({ driver_id: driverId })
    .eq('id', id)
  if (error) throw error
}

export async function deleteRoute(id: string): Promise<void> {
  const { error } = await supabase.from('routes').delete().eq('id', id)
  if (error) throw error
}

export interface QuickSaleItem {
  product_id: string
  quantity: number
}

/**
 * Venta rápida: crea un pedido (sólo con un nombre, sin cliente registrado) con
 * los productos indicados y lo agrega a la ruta de inmediato. Usa una función
 * de la base de datos (RPC) para hacerlo en una sola operación segura.
 */
export async function addQuickSale(
  routeId: string,
  customerName: string,
  items: QuickSaleItem[]
): Promise<string> {
  const { data, error } = await supabase.rpc('add_quick_sale', {
    p_route_id: routeId,
    p_customer_name: customerName,
    p_items: items,
  })
  if (error) throw error
  return data as string
}

/** Agrega un pedido al final de la ruta. */
export async function addOrderToRoute(
  routeId: string,
  orderId: string
): Promise<void> {
  // La nueva parada va al final: posición = cantidad actual de paradas.
  const { count, error: countError } = await supabase
    .from('route_stops')
    .select('id', { count: 'exact', head: true })
    .eq('route_id', routeId)
  if (countError) throw countError

  const { error } = await supabase.from('route_stops').insert({
    route_id: routeId,
    order_id: orderId,
    position: count ?? 0,
  })
  if (error) throw error
}

export async function removeStop(stopId: string): Promise<void> {
  const { error } = await supabase.from('route_stops').delete().eq('id', stopId)
  if (error) throw error
}

export interface RouteLoadInput {
  supply_id: string
  quantity: number
}

/**
 * Guarda la carga inicial de la ruta (por insumo, reemplaza la anterior) y marca
 * la carga como confirmada, para que el repartidor pueda ver los pedidos.
 */
export async function saveRouteLoads(
  routeId: string,
  items: RouteLoadInput[]
): Promise<void> {
  // Reemplazo total: borramos la carga previa y volvemos a insertar.
  const { error: delErr } = await supabase
    .from('route_loads')
    .delete()
    .eq('route_id', routeId)
  if (delErr) throw delErr

  const rows = items
    .filter((it) => it.supply_id && it.quantity > 0)
    .map((it) => ({
      route_id: routeId,
      supply_id: it.supply_id,
      quantity: it.quantity,
    }))
  if (rows.length > 0) {
    const { error: insErr } = await supabase.from('route_loads').insert(rows)
    if (insErr) throw insErr
  }

  const { error: updErr } = await supabase
    .from('routes')
    .update({ load_confirmed: true })
    .eq('id', routeId)
  if (updErr) throw updErr
}

// --- Retiros de insumos (pickups): son paradas de la ruta como una venta rápida ---

export interface PickupItemInput {
  supply_id: string
  quantity: number
}

/** Crea un retiro (con nombre, dirección e insumos) como una parada de la ruta. */
export async function addRoutePickup(
  routeId: string,
  customerName: string,
  address: string,
  items: PickupItemInput[],
  clientId: string | null
): Promise<string> {
  const { data, error } = await supabase.rpc('add_route_pickup', {
    p_route_id: routeId,
    p_customer_name: customerName,
    p_address: address,
    p_items: items,
    p_client_id: clientId,
  })
  if (error) throw error
  return data as string
}

/** Elimina un retiro (y su parada, por el on delete cascade). */
export async function removeRoutePickup(id: string): Promise<void> {
  const { error } = await supabase.from('route_pickups').delete().eq('id', id)
  if (error) throw error
}

export async function setRoutePickupDone(
  id: string,
  done: boolean
): Promise<void> {
  const { error } = await supabase
    .from('route_pickups')
    .update({ done })
    .eq('id', id)
  if (error) throw error
}

/** Persiste el nuevo orden de las paradas (una actualización por parada). */
export async function reorderStops(
  orderedStopIds: string[]
): Promise<void> {
  const results = await Promise.all(
    orderedStopIds.map((id, index) =>
      supabase.from('route_stops').update({ position: index }).eq('id', id)
    )
  )
  const failed = results.find((r) => r.error)
  if (failed?.error) throw failed.error
}

/** Pedidos que aún no están asignados a ninguna ruta. */
export async function listAssignableOrders(): Promise<OrderDetail[]> {
  const { data: stops, error: stopsError } = await supabase
    .from('route_stops')
    .select('order_id')
  if (stopsError) throw stopsError
  const assigned = new Set((stops ?? []).map((s) => s.order_id as string))

  const { data, error } = await supabase
    .from('orders')
    .select(
      '*, client:clients(*), address:addresses(*), items:order_items(*, product:products(*))'
    )
    .order('created_at', { ascending: false })
  if (error) throw error

  return (data as OrderDetail[]).filter((o) => !assigned.has(o.id))
}
