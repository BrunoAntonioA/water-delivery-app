import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getRoute } from '../api/routes'
import { listProducts } from '../api/products'
import { listSupplies } from '../api/supplies'
import { useAuth } from '../lib/auth'
import { formatDateOnly } from '../lib/format'
import {
  RouteLoadSection,
  soldBySupplyOf,
} from '../components/RouteLoadSection'
import { Card, EmptyState, Spinner } from '../components/ui'

export default function RouteLoadPage() {
  const { id = '' } = useParams()
  const qc = useQueryClient()
  const { profile } = useAuth()
  const isRepartidor = profile?.role === 'repartidor'

  const { data: route, isLoading } = useQuery({
    queryKey: ['route', id],
    queryFn: () => getRoute(id),
    enabled: Boolean(id),
  })
  const { data: supplies } = useQuery({
    queryKey: ['supplies'],
    queryFn: listSupplies,
  })
  const { data: products } = useQuery({
    queryKey: ['products'],
    queryFn: listProducts,
  })

  const productSupply = useMemo(() => {
    const m = new Map<string, { supply_id: string; quantity: number }[]>()
    products?.forEach((p) => {
      if (p.supplies?.length) m.set(p.id, p.supplies)
    })
    return m
  }, [products])

  const soldBySupply = useMemo(
    () => (route ? soldBySupplyOf(route, productSupply) : new Map()),
    [route, productSupply]
  )

  // Total de bidones devueltos por los clientes en esta ruta.
  const returnedTotal = useMemo(() => {
    if (!route) return 0
    return (route.stops ?? []).reduce(
      (sum, s) => sum + (s.order?.returned_bidones ?? 0),
      0
    )
  }, [route])

  function onSaved() {
    qc.invalidateQueries({ queryKey: ['route', id] })
    qc.invalidateQueries({ queryKey: ['routes'] })
  }

  if (isLoading) return <Spinner />
  if (!route)
    return (
      <EmptyState>
        No se encontró la ruta.{' '}
        <Link to="/rutas" className="text-sky-600 hover:underline">
          Volver
        </Link>
      </EmptyState>
    )

  return (
    <div>
      <Link
        to={`/rutas/${id}`}
        className="mb-4 inline-block text-sm text-sky-600 hover:underline"
      >
        ← Volver a la ruta
      </Link>

      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">
          Carga · {route.name || 'Ruta sin nombre'}
        </h1>
        <p className="flex items-center gap-2 text-sm text-slate-500">
          <span aria-hidden>📅</span>
          <span className="first-letter:uppercase">
            {formatDateOnly(route.route_date)}
          </span>
        </p>
      </div>

      <Card className="mb-4 flex items-center justify-between gap-3 p-4">
        <span className="flex items-center gap-2 text-sm font-medium text-slate-600">
          <span aria-hidden>↩</span> Bidones devueltos en la ruta
        </span>
        <span className="text-2xl font-bold tabular-nums text-slate-900">
          {returnedTotal}
        </span>
      </Card>

      <RouteLoadSection
        route={route}
        supplies={supplies ?? []}
        soldBySupply={soldBySupply}
        onSaved={onSaved}
        startEditing={!route.load_confirmed}
        canEdit
        addOnly={isRepartidor}
      />
    </div>
  )
}
