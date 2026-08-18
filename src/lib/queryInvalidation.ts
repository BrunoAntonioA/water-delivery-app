import type { QueryClient } from '@tanstack/react-query'
import type { OrderDetail } from '../types/db'

// Todas las claves de consulta que dependen de los pedidos y/o de las rutas. Un
// pedido puede estar en una ruta, así que cambiarlo afecta ambas vistas.
const ORDER_ROUTE_KEYS: readonly (readonly string[])[] = [
  ['orders'], // lista de Pedidos (paginada), reportes y resumen de entregas
  ['route'], // detalle de una ruta
  ['routes'], // lista de rutas
  ['open-routes'], // selector "agregar a ruta"
  ['assignable-orders'], // pedidos asignables a una ruta
  ['pending-pickups'], // retiros pendientes
]

/**
 * Marca obsoletas TODAS las vistas derivadas de pedidos y rutas. React Query
 * sólo vuelve a pedir de inmediato las consultas ACTIVAS (la vista en la que
 * estás); las demás se refrescan al entrar, sin costo mientras no las visitas.
 * Con esto, una acción hecha en Pedidos se refleja al abrir la Ruta y viceversa.
 */
export function invalidateOrdersAndRoutes(qc: QueryClient): void {
  for (const key of ORDER_ROUTE_KEYS) {
    qc.invalidateQueries({ queryKey: key as unknown as unknown[] })
  }
}

type OrdersPageData = { rows: OrderDetail[]; total: number }
type RouteLike = { stops?: { order?: OrderDetail | null }[] }

/**
 * Actualiza EN EL ACTO un pedido en las cachés (lista de Pedidos y detalle de
 * ruta) sin esperar al servidor, para que el cambio de estado/pago se vea al
 * instante. Luego la invalidación reconcilia con el dato real. Es defensivo: si
 * la caché no tiene la forma esperada, no toca nada.
 */
export function patchOrderInCaches(
  qc: QueryClient,
  orderId: string,
  patch: Partial<OrderDetail>
): void {
  qc.setQueriesData({ queryKey: ['orders', 'page'] }, (old: unknown) => {
    const page = old as OrdersPageData | undefined
    if (!page?.rows) return old
    return {
      ...page,
      rows: page.rows.map((o) => (o.id === orderId ? { ...o, ...patch } : o)),
    }
  })
  qc.setQueriesData({ queryKey: ['route'] }, (old: unknown) => {
    const route = old as RouteLike | undefined
    if (!route?.stops) return old
    return {
      ...route,
      stops: route.stops.map((s) =>
        s?.order?.id === orderId
          ? { ...s, order: { ...s.order, ...patch } }
          : s
      ),
    }
  })
}
