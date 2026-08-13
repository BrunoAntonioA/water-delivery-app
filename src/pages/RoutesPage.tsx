import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  closeRoute,
  createRoute,
  deleteRoute,
  driverLabel,
  listDrivers,
  listRoutesPage,
  setRouteDriver,
  type RouteInput,
  type RouteSummary,
} from '../api/routes'
import { useAuth } from '../lib/auth'
import { formatDateOnly } from '../lib/format'
import { Modal } from '../components/Modal'
import { DateRangeFilter } from '../components/DateRangeFilter'
import {
  Button,
  Card,
  EmptyState,
  Label,
  Pagination,
  PageHeader,
  Spinner,
  TextArea,
  TextInput,
} from '../components/ui'

const PAGE_SIZE = 10

function today(): string {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

const emptyForm = (): RouteInput => ({
  name: '',
  route_date: today(),
  driver: '',
  driver_id: null,
  notes: '',
})

export default function RoutesPage() {
  const qc = useQueryClient()
  const { profile } = useAuth()
  const isRepartidor = profile?.role === 'repartidor'
  const canManage = !isRepartidor // admin gestiona rutas

  // Filtros y paginación (server-side: sólo se descarga la página visible).
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [page, setPage] = useState(1)

  const { data: routesPage, isLoading } = useQuery({
    queryKey: ['routes', { from: dateFrom, to: dateTo, page }],
    queryFn: () =>
      listRoutesPage({
        from: dateFrom || undefined,
        to: dateTo || undefined,
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      }),
  })
  const pageItems = routesPage?.rows ?? []
  const total = routesPage?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount)

  const { data: drivers } = useQuery({
    queryKey: ['drivers'],
    queryFn: listDrivers,
    enabled: canManage,
  })

  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState<RouteInput>(emptyForm())

  const invalidate = () => qc.invalidateQueries({ queryKey: ['routes'] })

  const createMutation = useMutation({
    mutationFn: () => createRoute(form),
    onSuccess: () => {
      invalidate()
      setModalOpen(false)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteRoute(id),
    onSuccess: invalidate,
  })

  const driverMutation = useMutation({
    mutationFn: ({ id, driverId }: { id: string; driverId: string | null }) =>
      setRouteDriver(id, driverId),
    onSuccess: invalidate,
  })

  // --- Cerrar ruta ---
  // Pendientes = pedidos sin entregar + retiros sin recoger.
  const pendingOf = (r: RouteSummary) =>
    r.orderCount - r.deliveredCount + (r.pickupCount - r.pickupDoneCount)

  const [closingRoute, setClosingRoute] = useState<RouteSummary | null>(null)
  const [closeMode, setCloseMode] = useState<'ask' | 'create'>('ask')
  const [closeForm, setCloseForm] = useState<RouteInput>(emptyForm())

  // Cerrar y desasignar los pendientes (o sin pendientes).
  const closeOnlyMutation = useMutation({
    mutationFn: (routeId: string) => closeRoute(routeId, null),
    onSuccess: () => {
      invalidate()
      setClosingRoute(null)
    },
  })

  // Cerrar creando una nueva ruta y moviendo los pendientes a ella.
  const closeWithNewMutation = useMutation({
    mutationFn: async () => {
      const newId = await createRoute(closeForm)
      await closeRoute(closingRoute!.id, newId)
    },
    onSuccess: () => {
      invalidate()
      setClosingRoute(null)
    },
  })

  function onCloseClick(r: RouteSummary) {
    if (pendingOf(r) <= 0) {
      if (confirm(`¿Cerrar la ruta “${r.name || 'sin nombre'}”?`))
        closeOnlyMutation.mutate(r.id)
      return
    }
    setCloseMode('ask')
    setCloseForm({
      ...emptyForm(),
      name: r.name ? `Pendientes de ${r.name}` : '',
      driver_id: r.driver_id,
    })
    setClosingRoute(r)
  }

  function openNew() {
    setForm(emptyForm())
    setModalOpen(true)
  }

  return (
    <div>
      <PageHeader
        title="Rutas"
        subtitle={
          canManage
            ? 'Organiza los pedidos por ruta de reparto y ordénalos arrastrando.'
            : 'Estas son las rutas asignadas a ti.'
        }
        action={
          canManage ? <Button onClick={openNew}>+ Nueva ruta</Button> : undefined
        }
      />

      <Card className="mb-4 p-4">
        <DateRangeFilter
          from={dateFrom}
          to={dateTo}
          onChange={(f, t) => {
            setDateFrom(f)
            setDateTo(t)
            setPage(1)
          }}
          label="Fecha"
        />
        <div className="mt-2 flex items-center justify-between">
          {dateFrom || dateTo ? (
            <Button
              variant="ghost"
              onClick={() => {
                setDateFrom('')
                setDateTo('')
                setPage(1)
              }}
            >
              Limpiar
            </Button>
          ) : (
            <span />
          )}
          <span className="text-sm text-slate-400">
            {total} {total === 1 ? 'ruta' : 'rutas'}
          </span>
        </div>
      </Card>

      {isLoading ? (
        <Spinner />
      ) : total === 0 ? (
        <EmptyState>
          {dateFrom || dateTo
            ? 'No hay rutas en esas fechas.'
            : 'Aún no tienes rutas. Crea la primera con “Nueva ruta”.'}
        </EmptyState>
      ) : (
        <>
          <div className="grid gap-3">
            {pageItems.map((r) => (
              <Card key={r.id} className="p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <Link to={`/rutas/${r.id}`} className="min-w-0 flex-1 group">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-slate-900 group-hover:text-sky-700">
                        {r.name || 'Ruta sin nombre'}
                      </p>
                      <RouteStatusBadge route={r} />
                    </div>
                    <p className="mt-0.5 text-sm text-slate-500 first-letter:uppercase">
                      📅 {formatDateOnly(r.route_date)}
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-sm text-slate-500">
                      <span>🚚 {r.driverName || 'Sin repartidor'}</span>
                      <CountChip
                        label="Entregados"
                        done={r.deliveredCount}
                        total={r.orderCount}
                      />
                      <CountChip
                        label="Pagados"
                        done={r.paidCount}
                        total={r.orderCount}
                      />
                      {r.pickupCount > 0 && (
                        <CountChip
                          label="Retirados"
                          done={r.pickupDoneCount}
                          total={r.pickupCount}
                        />
                      )}
                      {r.notesCount > 0 && (
                        <span
                          className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800"
                          title="Pedidos con nota u observación de entrega"
                        >
                          📝 {r.notesCount} con notas
                        </span>
                      )}
                    </div>
                  </Link>
                  <div className="flex flex-wrap items-center gap-2 sm:shrink-0 sm:justify-end">
                    {canManage && (
                      <select
                        value={r.driver_id ?? ''}
                        onChange={(e) =>
                          driverMutation.mutate({
                            id: r.id,
                            driverId: e.target.value || null,
                          })
                        }
                        className="w-full rounded-lg border border-slate-300 px-2 py-2 text-sm outline-none focus:border-sky-500 sm:w-auto"
                        title="Asignar repartidor"
                      >
                        <option value="">Sin repartidor</option>
                        {drivers?.map((d) => (
                          <option key={d.id} value={d.id}>
                            {driverLabel(d)}
                          </option>
                        ))}
                      </select>
                    )}
                    <Link
                      to={`/rutas/${r.id}/carga`}
                      className="flex-1 sm:flex-none"
                    >
                      <Button variant="secondary" className="w-full">
                        🛒 Ver carga
                      </Button>
                    </Link>
                    <Link to={`/rutas/${r.id}`} className="flex-1 sm:flex-none">
                      <Button variant="secondary" className="w-full">
                        Abrir
                      </Button>
                    </Link>
                    {canManage && !r.closed_at && (
                      <Button
                        variant="secondary"
                        className="flex-1 sm:flex-none"
                        onClick={() => onCloseClick(r)}
                      >
                        🔒 Cerrar ruta
                      </Button>
                    )}
                    {canManage && (
                      <Button
                        variant="danger"
                        className="flex-1 sm:flex-none"
                        onClick={() => {
                          if (confirm('¿Eliminar esta ruta?'))
                            deleteMutation.mutate(r.id)
                        }}
                      >
                        Eliminar
                      </Button>
                    )}
                  </div>
                </div>
              </Card>
            ))}
          </div>
          <Pagination
            page={currentPage}
            pageCount={pageCount}
            onPage={setPage}
          />
        </>
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Nueva ruta"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault()
            createMutation.mutate()
          }}
          className="space-y-4"
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label>Nombre</Label>
              <TextInput
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Ruta Norte"
              />
            </div>
            <div>
              <Label>Fecha *</Label>
              <TextInput
                type="date"
                value={form.route_date}
                onChange={(e) =>
                  setForm({ ...form, route_date: e.target.value })
                }
                required
              />
            </div>
          </div>

          <div>
            <Label>Repartidor</Label>
            <select
              value={form.driver_id ?? ''}
              onChange={(e) =>
                setForm({ ...form, driver_id: e.target.value || null })
              }
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-500"
            >
              <option value="">Sin repartidor</option>
              {drivers?.map((d) => (
                <option key={d.id} value={d.id}>
                  {driverLabel(d)}
                </option>
              ))}
            </select>
            {drivers && drivers.length === 0 && (
              <p className="mt-1 text-xs text-slate-400">
                No tienes usuarios para asignar. Crea repartidores (o admins) en
                Usuarios.
              </p>
            )}
          </div>

          <div>
            <Label>Notas (opcional)</Label>
            <TextArea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              rows={2}
            />
          </div>

          {createMutation.isError && (
            <p className="text-sm text-red-600">
              Error al crear: {(createMutation.error as Error).message}
            </p>
          )}

          <div className="sticky bottom-0 -mx-5 -mb-4 mt-2 flex flex-wrap justify-end gap-2 border-t border-slate-100 bg-white px-5 py-3">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setModalOpen(false)}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={!form.route_date || createMutation.isPending}
            >
              {createMutation.isPending ? 'Creando…' : 'Crear ruta'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* --- Cerrar ruta (con pendientes) --- */}
      <Modal
        open={Boolean(closingRoute)}
        onClose={() => setClosingRoute(null)}
        title="Cerrar ruta"
      >
        {closingRoute &&
          (closeMode === 'ask' ? (
            <div className="space-y-4">
              <p className="text-sm text-slate-600">
                La ruta “{closingRoute.name || 'sin nombre'}” tiene{' '}
                <span className="font-semibold">{pendingOf(closingRoute)}</span>{' '}
                {pendingOf(closingRoute) === 1 ? 'pendiente' : 'pendientes'} sin
                entregar (pedidos y/o retiros). ¿Qué deseas hacer con ellos?
              </p>
              <div className="space-y-2">
                <Button
                  className="w-full"
                  onClick={() => setCloseMode('create')}
                >
                  Crear una nueva ruta con los pendientes
                </Button>
                <Button
                  variant="secondary"
                  className="w-full"
                  disabled={closeOnlyMutation.isPending}
                  onClick={() => closeOnlyMutation.mutate(closingRoute.id)}
                >
                  {closeOnlyMutation.isPending
                    ? 'Cerrando…'
                    : 'Sólo cerrar (dejar pendientes sin ruta)'}
                </Button>
                <Button
                  variant="ghost"
                  className="w-full"
                  onClick={() => setClosingRoute(null)}
                >
                  Cancelar
                </Button>
              </div>
              {closeOnlyMutation.isError && (
                <p className="text-sm text-red-600">
                  Error: {(closeOnlyMutation.error as Error).message}
                </p>
              )}
            </div>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault()
                closeWithNewMutation.mutate()
              }}
              className="space-y-4"
            >
              <p className="text-sm text-slate-500">
                Se creará esta ruta y se moverán a ella los{' '}
                {pendingOf(closingRoute)} pendientes de “
                {closingRoute.name || 'sin nombre'}”.
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <Label>Nombre</Label>
                  <TextInput
                    value={closeForm.name}
                    onChange={(e) =>
                      setCloseForm({ ...closeForm, name: e.target.value })
                    }
                    placeholder="Ruta de pendientes"
                  />
                </div>
                <div>
                  <Label>Fecha *</Label>
                  <TextInput
                    type="date"
                    value={closeForm.route_date}
                    onChange={(e) =>
                      setCloseForm({ ...closeForm, route_date: e.target.value })
                    }
                    required
                  />
                </div>
              </div>
              <div>
                <Label>Repartidor</Label>
                <select
                  value={closeForm.driver_id ?? ''}
                  onChange={(e) =>
                    setCloseForm({
                      ...closeForm,
                      driver_id: e.target.value || null,
                    })
                  }
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-500"
                >
                  <option value="">Sin repartidor</option>
                  {drivers?.map((d) => (
                    <option key={d.id} value={d.id}>
                      {driverLabel(d)}
                    </option>
                  ))}
                </select>
              </div>
              {closeWithNewMutation.isError && (
                <p className="text-sm text-red-600">
                  Error: {(closeWithNewMutation.error as Error).message}
                </p>
              )}
              <div className="sticky bottom-0 -mx-5 -mb-4 mt-2 flex flex-wrap justify-end gap-2 border-t border-slate-100 bg-white px-5 py-3">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setCloseMode('ask')}
                >
                  Volver
                </Button>
                <Button
                  type="submit"
                  disabled={
                    !closeForm.route_date || closeWithNewMutation.isPending
                  }
                >
                  {closeWithNewMutation.isPending
                    ? 'Creando…'
                    : 'Crear ruta y mover pendientes'}
                </Button>
              </div>
            </form>
          ))}
      </Modal>
    </div>
  )
}

/** Estado general de la ruta según sus pedidos. */
function RouteStatusBadge({ route }: { route: RouteSummary }) {
  const {
    stopCount,
    orderCount,
    deliveredCount,
    paidCount,
    pickupCount,
    pickupDoneCount,
  } = route
  const pickupsDone = pickupDoneCount === pickupCount
  const allDelivered = deliveredCount === orderCount && pickupsDone
  const allPaid =
    orderCount > 0 && paidCount === orderCount && pickupsDone
  let label: string
  let cls: string
  if (route.closed_at) {
    label = 'Cerrada'
    cls = 'bg-slate-700 text-white'
  } else if (stopCount === 0) {
    label = 'Sin pedidos'
    cls = 'bg-slate-100 text-slate-500'
  } else if (allPaid) {
    label = 'Todo pagado'
    cls = 'bg-emerald-100 text-emerald-800'
  } else if (allDelivered) {
    label = 'Todo entregado'
    cls = 'bg-sky-100 text-sky-800'
  } else if (deliveredCount > 0 || pickupDoneCount > 0) {
    label = 'En reparto'
    cls = 'bg-amber-100 text-amber-800'
  } else {
    label = 'Pendiente'
    cls = 'bg-slate-100 text-slate-600'
  }
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${cls}`}>
      {label}
    </span>
  )
}

/** Chip "Entregados 3/5" que se pone verde al completarse. */
function CountChip({
  label,
  done,
  total,
}: {
  label: string
  done: number
  total: number
}) {
  const complete = total > 0 && done === total
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs ${
        complete ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'
      }`}
    >
      {label} {done}/{total}
    </span>
  )
}
