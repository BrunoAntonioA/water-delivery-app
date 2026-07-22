import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  addOrderToRoute,
  getRoute,
  listAssignableOrders,
  removeStop,
  reorderStops,
} from '../api/routes'
import type { OrderDetail, RouteStopWithOrder } from '../types/db'
import { useAuth } from '../lib/auth'
import { useIsMobile } from '../lib/useIsMobile'
import { formatDateOnly, formatMoney } from '../lib/format'
import { Modal } from '../components/Modal'
import { OrderActions } from '../components/OrderActions'
import { StatusBadge } from '../components/StatusBadge'
import {
  Button,
  Card,
  CopyButton,
  EmptyState,
  MapButton,
  Spinner,
} from '../components/ui'

function stopAddress(stop: RouteStopWithOrder): string {
  const a = stop.order?.address
  if (!a) return '—'
  return [a.address, a.comuna].filter(Boolean).join(', ')
}

// Un pedido está "pendiente de entrega" si aún está en estado Pedido (o no
// tiene pedido asociado). Ya fue entregado si está Entregado o Pagado.
function isPending(stop: RouteStopWithOrder): boolean {
  return !stop.order || stop.order.status === 'ordered'
}

export default function RouteDetailPage() {
  const { id = '' } = useParams()
  const qc = useQueryClient()
  const { profile } = useAuth()
  const isRepartidor = profile?.role === 'repartidor'
  const canManage = !isRepartidor // el repartidor sólo reordena y entrega
  const isMobile = useIsMobile()

  const { data: route, isLoading } = useQuery({
    queryKey: ['route', id],
    queryFn: () => getRoute(id),
    enabled: Boolean(id),
  })

  const { data: assignable } = useQuery({
    queryKey: ['assignable-orders'],
    queryFn: listAssignableOrders,
    enabled: canManage,
  })

  // Copia local de las paradas para reordenar de forma instantánea (optimista).
  const [items, setItems] = useState<RouteStopWithOrder[]>([])
  useEffect(() => {
    if (route?.stops) setItems(route.stops)
  }, [route?.stops])

  const [addOpen, setAddOpen] = useState(false)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  const invalidateRoute = () => {
    qc.invalidateQueries({ queryKey: ['route', id] })
    qc.invalidateQueries({ queryKey: ['assignable-orders'] })
    qc.invalidateQueries({ queryKey: ['routes'] })
  }

  const reorderMutation = useMutation({
    mutationFn: (orderedIds: string[]) => reorderStops(orderedIds),
    onError: () => invalidateRoute(), // revertir al estado real si falla
  })

  const addMutation = useMutation({
    mutationFn: (orderId: string) => addOrderToRoute(id, orderId),
    onSuccess: invalidateRoute,
  })

  const removeMutation = useMutation({
    mutationFn: (stopId: string) => removeStop(stopId),
    onSuccess: invalidateRoute,
  })

  const pending = items.filter(isPending)
  const done = items.filter((s) => !isPending(s))

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = pending.findIndex((s) => s.id === active.id)
    const newIndex = pending.findIndex((s) => s.id === over.id)
    if (oldIndex < 0 || newIndex < 0) return
    const newPending = arrayMove(pending, oldIndex, newIndex)
    // Guardamos el orden completo: primero las pendientes, luego las entregadas.
    const next = [...newPending, ...done]
    setItems(next)
    reorderMutation.mutate(next.map((s) => s.id))
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
        to="/rutas"
        className="mb-4 inline-block text-sm text-sky-600 hover:underline"
      >
        ← Volver a rutas
      </Link>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            {route.name || 'Ruta sin nombre'}
          </h1>
          <p className="flex items-center gap-2 text-sm text-slate-500">
            <span aria-hidden>📅</span>
            <span className="first-letter:uppercase">
              {formatDateOnly(route.route_date)}
            </span>
          </p>
          <p className="flex items-center gap-2 text-sm text-slate-500">
            <span aria-hidden>🚚</span>
            <span>{route.driverName || 'Sin repartidor'}</span>
          </p>
          {route.notes && (
            <p className="mt-1 text-sm italic text-slate-500">
              “{route.notes}”
            </p>
          )}
        </div>
        {canManage && (
          <Button onClick={() => setAddOpen(true)}>+ Agregar pedido</Button>
        )}
      </div>

      {items.length === 0 ? (
        <EmptyState>
          {canManage
            ? 'Esta ruta no tiene pedidos. Agrega el primero con “Agregar pedido”.'
            : 'Esta ruta no tiene pedidos asignados todavía.'}
        </EmptyState>
      ) : (
        <div className="space-y-8">
          {/* --- Por entregar (arrastrable) --- */}
          <section>
            <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
              <span aria-hidden>📦</span>
              <span>Por entregar</span>
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
                {pending.length}
              </span>
            </h2>
            {pending.length === 0 ? (
              <EmptyState>¡Todo entregado! No quedan pedidos pendientes.</EmptyState>
            ) : (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={onDragEnd}
              >
                <SortableContext
                  items={pending.map((s) => s.id)}
                  strategy={verticalListSortingStrategy}
                >
                  {isMobile ? (
                    <div className="space-y-2">
                      {pending.map((stop, index) => (
                        <SortableStopCard
                          key={stop.id}
                          stop={stop}
                          index={index}
                          canManage={canManage}
                          onChanged={invalidateRoute}
                          onRemove={() => removeMutation.mutate(stop.id)}
                        />
                      ))}
                    </div>
                  ) : (
                    <Card className="overflow-hidden">
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <StopsTableHead sortable />
                          <tbody>
                            {pending.map((stop, index) => (
                              <SortableStopRow
                                key={stop.id}
                                stop={stop}
                                index={index}
                                canManage={canManage}
                                onChanged={invalidateRoute}
                                onRemove={() => removeMutation.mutate(stop.id)}
                              />
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </Card>
                  )}
                </SortableContext>
              </DndContext>
            )}
            {pending.length > 0 && (
              <p className="mt-2 text-xs text-slate-400">
                Arrastra las tarjetas desde el asa de la izquierda para cambiar
                el orden de entrega.
              </p>
            )}
          </section>

          {/* --- Entregados (estático) --- */}
          {done.length > 0 && (
            <section>
              <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
                <span aria-hidden>✅</span>
                <span>Entregados</span>
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800">
                  {done.length}
                </span>
              </h2>
              {isMobile ? (
                <div className="space-y-2">
                  {done.map((stop) => (
                    <StaticStopCard
                      key={stop.id}
                      stop={stop}
                      canManage={canManage}
                      onChanged={invalidateRoute}
                      onRemove={() => removeMutation.mutate(stop.id)}
                    />
                  ))}
                </div>
              ) : (
                <Card className="overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <StopsTableHead />
                      <tbody>
                        {done.map((stop) => (
                          <StaticStopRow
                            key={stop.id}
                            stop={stop}
                            canManage={canManage}
                            onChanged={invalidateRoute}
                            onRemove={() => removeMutation.mutate(stop.id)}
                          />
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              )}
            </section>
          )}
        </div>
      )}

      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Agregar pedido a la ruta"
        wide
      >
        <AddOrderList
          orders={assignable ?? []}
          onAdd={(orderId) => addMutation.mutate(orderId)}
          isPending={addMutation.isPending}
        />
      </Modal>
    </div>
  )
}

function StopsTableHead({ sortable = false }: { sortable?: boolean }) {
  return (
    <thead>
      <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase text-slate-500">
        <th className="w-8 px-2 py-2">{sortable ? '' : '✓'}</th>
        <th className="w-8 px-2 py-2">#</th>
        <th className="px-3 py-2">Cliente</th>
        <th className="px-3 py-2">Dirección</th>
        <th className="px-3 py-2">Teléfono</th>
        <th className="px-3 py-2 text-right">Total</th>
        <th className="px-3 py-2">Estado</th>
        <th className="px-3 py-2">Acciones</th>
        <th className="w-10 px-2 py-2"></th>
      </tr>
    </thead>
  )
}

/** Celdas compartidas por las dos tablas (desde Cliente hasta el botón quitar). */
function StopCells({
  stop,
  canManage,
  onChanged,
  onRemove,
}: {
  stop: RouteStopWithOrder
  canManage: boolean
  onChanged: () => void
  onRemove: () => void
}) {
  const order = stop.order
  const clientName = order?.client
    ? `${order.client.name} ${order.client.surname}`
    : 'Pedido'
  return (
    <>
      <td className="px-3 py-2 font-medium text-slate-800">{clientName}</td>
      <td className="px-3 py-2 text-slate-600">
        <div className="flex items-center gap-1">
          <span className="min-w-0">{stopAddress(stop)}</span>
          {order?.address?.address && (
            <>
              <CopyButton
                value={order.address.address}
                label="Copiar dirección"
              />
              <MapButton query={stopAddress(stop)} />
            </>
          )}
        </div>
      </td>
      <td className="px-3 py-2 text-slate-600">
        <div className="flex items-center gap-1">
          <span>{order?.client?.phone ?? '—'}</span>
          {order?.client?.phone && (
            <CopyButton value={order.client.phone} label="Copiar teléfono" />
          )}
        </div>
      </td>
      <td className="px-3 py-2 text-right font-medium text-slate-800">
        {order ? formatMoney(order.total) : '—'}
      </td>
      <td className="px-3 py-2">
        {order && <StatusBadge status={order.status} />}
      </td>
      <td className="px-3 py-2">
        {order && (
          <OrderActions
            order={order}
            onChanged={onChanged}
            className="flex items-center gap-1"
          />
        )}
      </td>
      <td className="px-2 py-2 text-center">
        {canManage && (
          <button
            type="button"
            onClick={onRemove}
            className="rounded-lg px-2 text-slate-400 hover:bg-slate-100 hover:text-red-600"
            aria-label="Quitar de la ruta"
          >
            ✕
          </button>
        )}
      </td>
    </>
  )
}

function SortableStopRow({
  stop,
  index,
  canManage,
  onChanged,
  onRemove,
}: {
  stop: RouteStopWithOrder
  index: number
  canManage: boolean
  onChanged: () => void
  onRemove: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: stop.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  return (
    <tr
      ref={setNodeRef}
      style={style}
      className={`border-b border-slate-100 [&>td]:align-middle ${
        isDragging ? 'bg-sky-50 shadow-lg' : 'bg-white'
      }`}
    >
      <td className="px-2 py-2 text-center">
        <button
          type="button"
          className="cursor-grab touch-none text-slate-400 hover:text-slate-600 active:cursor-grabbing"
          aria-label="Arrastrar"
          {...attributes}
          {...listeners}
        >
          ⠿
        </button>
      </td>
      <td className="px-2 py-2 font-semibold text-slate-500">{index + 1}</td>
      <StopCells
        stop={stop}
        canManage={canManage}
        onChanged={onChanged}
        onRemove={onRemove}
      />
    </tr>
  )
}

function StaticStopRow({
  stop,
  canManage,
  onChanged,
  onRemove,
}: {
  stop: RouteStopWithOrder
  canManage: boolean
  onChanged: () => void
  onRemove: () => void
}) {
  return (
    <tr className="border-b border-slate-100 bg-white [&>td]:align-middle">
      <td className="px-2 py-2 text-center text-emerald-500">✓</td>
      <td className="px-2 py-2 font-semibold text-slate-400">—</td>
      <StopCells
        stop={stop}
        canManage={canManage}
        onChanged={onChanged}
        onRemove={onRemove}
      />
    </tr>
  )
}

// ---- Tarjetas para la vista de teléfono ----

/** Contenido común de una tarjeta de parada (info + total + acciones). */
function StopCardInner({
  stop,
  canManage,
  onChanged,
  onRemove,
  leading,
  orderNo,
}: {
  stop: RouteStopWithOrder
  canManage: boolean
  onChanged: () => void
  onRemove: () => void
  leading: React.ReactNode
  orderNo?: number
}) {
  const order = stop.order
  const clientName = order?.client
    ? `${order.client.name} ${order.client.surname}`
    : 'Pedido'
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="flex items-start gap-2">
        <div className="shrink-0">{leading}</div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-slate-800">
              {orderNo != null && (
                <span className="mr-1 text-slate-400">{orderNo}.</span>
              )}
              {clientName}
            </span>
            {order && <StatusBadge status={order.status} />}
          </div>
          <div className="mt-1 flex items-start gap-2 text-sm text-slate-600">
            <span aria-hidden>📍</span>
            <span className="min-w-0 flex-1 break-words">{stopAddress(stop)}</span>
            {order?.address?.address && (
              <>
                <CopyButton
                  value={order.address.address}
                  label="Copiar dirección"
                />
                <MapButton query={stopAddress(stop)} />
              </>
            )}
          </div>
          {order?.client?.phone && (
            <div className="mt-0.5 flex items-center gap-2 text-sm text-slate-500">
              <span aria-hidden>📞</span>
              <span className="flex-1">{order.client.phone}</span>
              <CopyButton value={order.client.phone} label="Copiar teléfono" />
            </div>
          )}
        </div>
        {canManage && (
          <button
            type="button"
            onClick={onRemove}
            aria-label="Quitar de la ruta"
            className="shrink-0 rounded-lg px-2 py-1 text-slate-400 hover:bg-slate-100 hover:text-red-600"
          >
            ✕
          </button>
        )}
      </div>
      <div className="mt-2 border-t border-slate-100 pt-2">
        <p className="font-bold text-slate-900">
          {order ? formatMoney(order.total) : '—'}
        </p>
        {order && (
          <OrderActions
            order={order}
            onChanged={onChanged}
            className="mt-2 flex flex-wrap items-center gap-2"
          />
        )}
      </div>
    </div>
  )
}

function SortableStopCard({
  stop,
  index,
  canManage,
  onChanged,
  onRemove,
}: {
  stop: RouteStopWithOrder
  index: number
  canManage: boolean
  onChanged: () => void
  onRemove: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: stop.id })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={isDragging ? 'opacity-80' : ''}
    >
      <StopCardInner
        stop={stop}
        canManage={canManage}
        onChanged={onChanged}
        onRemove={onRemove}
        orderNo={index + 1}
        leading={
          <button
            type="button"
            {...attributes}
            {...listeners}
            aria-label="Arrastrar para reordenar"
            className="flex h-12 w-10 shrink-0 cursor-grab touch-none items-center justify-center rounded-lg bg-slate-100 text-slate-500 hover:bg-slate-200 active:cursor-grabbing"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <circle cx="9" cy="5" r="1.7" />
              <circle cx="15" cy="5" r="1.7" />
              <circle cx="9" cy="12" r="1.7" />
              <circle cx="15" cy="12" r="1.7" />
              <circle cx="9" cy="19" r="1.7" />
              <circle cx="15" cy="19" r="1.7" />
            </svg>
          </button>
        }
      />
    </div>
  )
}

function StaticStopCard({
  stop,
  canManage,
  onChanged,
  onRemove,
}: {
  stop: RouteStopWithOrder
  canManage: boolean
  onChanged: () => void
  onRemove: () => void
}) {
  return (
    <StopCardInner
      stop={stop}
      canManage={canManage}
      onChanged={onChanged}
      onRemove={onRemove}
      leading={<span className="text-lg leading-none text-emerald-500">✓</span>}
    />
  )
}

function AddOrderList({
  orders,
  onAdd,
  isPending,
}: {
  orders: OrderDetail[]
  onAdd: (orderId: string) => void
  isPending: boolean
}) {
  if (orders.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-slate-500">
        No hay pedidos disponibles. Todos los pedidos ya están en una ruta, o
        aún no has creado pedidos.
      </p>
    )
  }

  return (
    <div className="max-h-96 space-y-2 overflow-y-auto">
      {orders.map((o) => (
        <div
          key={o.id}
          className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2"
        >
          <div className="min-w-0">
            <p className="font-medium text-slate-800">
              {o.client ? `${o.client.name} ${o.client.surname}` : 'Cliente'}
            </p>
            <p className="truncate text-sm text-slate-500">
              {o.address
                ? [o.address.address, o.address.comuna]
                    .filter(Boolean)
                    .join(', ')
                : 'Sin dirección'}{' '}
              · {formatMoney(o.total)}
            </p>
          </div>
          <Button
            variant="secondary"
            onClick={() => onAdd(o.id)}
            disabled={isPending}
          >
            Agregar
          </Button>
        </div>
      ))}
    </div>
  )
}
