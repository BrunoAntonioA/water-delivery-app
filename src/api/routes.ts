import { supabase } from '../lib/supabase'
import type { OrderDetail, OrderStatus, Route, RouteDetail } from '../types/db'

const ORDER_SELECT =
  'order:orders(*, client:clients(*), address:addresses(*), items:order_items(*, product:products(*)))'

export interface RouteInput {
  name: string
  route_date: string
  driver: string
  notes: string
}

export interface RouteSummary extends Route {
  stopCount: number
  deliveredCount: number // entregados o pagados
  paidCount: number
}

export async function listRoutes(): Promise<RouteSummary[]> {
  const { data, error } = await supabase
    .from('routes')
    .select('*, stops:route_stops(id, order:orders(status))')
    .order('route_date', { ascending: false })
  if (error) throw error
  return (data ?? []).map((r) => {
    const { stops, ...route } = r as Route & {
      stops: { id: string; order: { status: OrderStatus } | null }[]
    }
    const list = stops ?? []
    const deliveredCount = list.filter(
      (s) => s.order && s.order.status !== 'ordered'
    ).length
    const paidCount = list.filter((s) => s.order?.status === 'paid').length
    return {
      ...route,
      stopCount: list.length,
      deliveredCount,
      paidCount,
    }
  })
}

export async function getRoute(id: string): Promise<RouteDetail> {
  const { data, error } = await supabase
    .from('routes')
    .select(`*, stops:route_stops(*, ${ORDER_SELECT})`)
    .eq('id', id)
    .single()
  if (error) throw error
  const route = data as RouteDetail
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
      notes: input.notes || null,
    })
    .eq('id', id)
  if (error) throw error
}

export async function deleteRoute(id: string): Promise<void> {
  const { error } = await supabase.from('routes').delete().eq('id', id)
  if (error) throw error
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
