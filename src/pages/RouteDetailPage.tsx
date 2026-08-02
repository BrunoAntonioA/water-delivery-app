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
import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  addOrderToRoute,
  addQuickSale,
  addRoutePickup,
  getRoute,
  listAssignableOrders,
  removeRoutePickup,
  removeStop,
  reorderStops,
  setRoutePickupDone,
} from '../api/routes'
import { listProducts } from '../api/products'
import { listSupplies } from '../api/supplies'
import { listClients } from '../api/clients'
import { ClientCombobox } from '../components/ClientCombobox'
import type { OrderDetail, RouteStopWithOrder } from '../types/db'
import { useAuth } from '../lib/auth'
import { useIsMobile } from '../lib/useIsMobile'
import { formatDateOnly, formatMoney } from '../lib/format'
import { orderClientName, returnedBidonesText } from '../lib/order'
import { OrderItemsList } from '../components/OrderItems'
import { Modal } from '../components/Modal'
import { OrderActions } from '../components/OrderActions'
import { PaidBadge, PAYMENT_LABELS, StatusBadge } from '../components/StatusBadge'
import {
  Button,
  CallButton,
  Card,
  CopyButton,
  EmptyState,
  Label,
  MapButton,
  Spinner,
  TextInput,
} from '../components/ui'

// Datos/acciones extra para pintar las paradas de tipo "retiro" sin pasar props
// por todas las capas de fila/tarjeta.
const StopExtrasContext = createContext<{
  supplyName: Map<string, string>
  onPickupDone: (pickupId: string, done: boolean) => void
}>({ supplyName: new Map(), onPickupDone: () => {} })

/** Texto de los insumos de un retiro: "3× Bidón 20L, 2× ...". */
function pickupItemsText(
  pickup: { items: { supply_id: string; quantity: number }[] },
  supplyName: Map<string, string>
): string {
  if (!pickup.items?.length) return '—'
  return pickup.items
    .map((it) => `${it.quantity}× ${supplyName.get(it.supply_id) ?? 'Insumo'}`)
    .join(', ')
}

function stopAddress(stop: RouteStopWithOrder): string {
  if (stop.pickup) return stop.pickup.address || '—'
  const a = stop.order?.address
  if (!a) return '—'
  return [a.address, a.comuna].filter(Boolean).join(', ')
}

// Un pedido está "pendiente de entrega" si aún está en estado Pedido (o no
// tiene pedido asociado). Ya fue entregado si está Entregado o Pagado.
function isPending(stop: RouteStopWithOrder): boolean {
  if (stop.pickup) return !stop.pickup.done
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

  const { data: products } = useQuery({
    queryKey: ['products'],
    queryFn: listProducts,
  })
  const { data: supplies } = useQuery({
    queryKey: ['supplies'],
    queryFn: listSupplies,
  })
  const { data: clients } = useQuery({
    queryKey: ['clients'],
    queryFn: listClients,
  })
  const productMap = useMemo(() => {
    const m = new Map<string, number>()
    products?.forEach((p) => m.set(p.id, p.price))
    return m
  }, [products])
  const supplyName = useMemo(() => {
    const m = new Map<string, string>()
    supplies?.forEach((s) => m.set(s.id, s.name))
    return m
  }, [supplies])

  // Retiro rápido (parada de la ruta: cliente opcional + nombre + dirección + insumos).
  const [pickupOpen, setPickupOpen] = useState(false)
  const [pickupClientId, setPickupClientId] = useState('')
  const [pickupName, setPickupName] = useState('')
  const [pickupAddress, setPickupAddress] = useState('')
  const [pickupItems, setPickupItems] = useState<
    { supply_id: string; quantity: number }[]
  >([{ supply_id: '', quantity: 1 }])
  const pickupValid =
    pickupItems.filter((it) => it.supply_id && it.quantity > 0).length > 0

  function openPickup() {
    setPickupClientId('')
    setPickupName('')
    setPickupAddress('')
    setPickupItems([{ supply_id: '', quantity: 1 }])
    setPickupOpen(true)
  }

  // Al elegir un cliente, prellenamos nombre y dirección (editables).
  function choosePickupClient(clientId: string) {
    setPickupClientId(clientId)
    const c = clients?.find((cl) => cl.id === clientId)
    if (c) {
      setPickupName(`${c.name} ${c.surname}`.trim())
      const a = c.addresses?.[0]
      if (a) {
        setPickupAddress([a.address, a.comuna].filter(Boolean).join(', '))
      }
    }
  }

  // Copia local de las paradas para reordenar de forma instantánea (optimista).
  const [items, setItems] = useState<RouteStopWithOrder[]>([])
  useEffect(() => {
    if (route?.stops) setItems(route.stops)
  }, [route?.stops])

  const [addOpen, setAddOpen] = useState(false)

  // Venta rápida (sólo nombre + productos).
  const [quickOpen, setQuickOpen] = useState(false)
  const [quickName, setQuickName] = useState('')
  const [quickItems, setQuickItems] = useState<
    { product_id: string; quantity: number }[]
  >([{ product_id: '', quantity: 1 }])
  const quickTotal = quickItems.reduce(
    (s, it) => s + it.quantity * (productMap.get(it.product_id) ?? 0),
    0
  )
  const quickValid =
    quickItems.filter((it) => it.product_id && it.quantity > 0).length > 0
  const canQuickSave = Boolean(quickName.trim() && quickValid)

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

  const addPickupMutation = useMutation({
    mutationFn: () =>
      addRoutePickup(
        id,
        pickupName.trim(),
        pickupAddress.trim(),
        pickupItems
          .filter((it) => it.supply_id && it.quantity > 0)
          .map((it) => ({
            supply_id: it.supply_id,
            quantity: Math.max(1, Math.trunc(it.quantity) || 1),
          })),
        pickupClientId || null
      ),
    onSuccess: () => {
      invalidateRoute()
      setPickupOpen(false)
    },
  })

  const removePickupMutation = useMutation({
    mutationFn: (pickupId: string) => removeRoutePickup(pickupId),
    onSuccess: invalidateRoute,
  })

  const pickupDoneMutation = useMutation({
    mutationFn: ({ pickupId, done }: { pickupId: string; done: boolean }) =>
      setRoutePickupDone(pickupId, done),
    onSuccess: invalidateRoute,
  })

  const quickSaleMutation = useMutation({
    mutationFn: () =>
      addQuickSale(
        id,
        quickName.trim(),
        quickItems.filter((it) => it.product_id && it.quantity > 0)
      ),
    onSuccess: async (newOrderId) => {
      setQuickOpen(false)
      // La venta rápida se agrega al final. Traemos las paradas, reubicamos la
      // nueva al inicio de "Por entregar" y PERSISTIMOS ese orden antes de
      // refrescar, para que la lista la muestre primera al recargar.
      const fresh = await getRoute(id)
      const freshPending = fresh.stops.filter(isPending)
      const freshDone = fresh.stops.filter((s) => !isPending(s))
      const newStop = freshPending.find((s) => s.order?.id === newOrderId)
      if (newStop) {
        const rest = freshPending.filter((s) => s.id !== newStop.id)
        const ordered = [newStop, ...rest, ...freshDone]
        await reorderStops(ordered.map((s) => s.id))
      }
      invalidateRoute()
    },
  })

  function openQuick() {
    setQuickName('')
    setQuickItems([{ product_id: '', quantity: 1 }])
    setQuickOpen(true)
  }

  function updateQuickItem(i: number, patch: Partial<{ product_id: string; quantity: number }>) {
    setQuickItems((list) =>
      list.map((it, idx) => (idx === i ? { ...it, ...patch } : it))
    )
  }

  const pending = items.filter(isPending)
  const done = items.filter((s) => !isPending(s))

  // Al repartidor se le ocultan los pedidos hasta registrar la carga inicial.
  const loadBlocked = isRepartidor && !route?.load_confirmed

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
        <div className="flex w-full flex-wrap gap-2 sm:w-auto sm:shrink-0">
          <Link to={`/rutas/${id}/carga`} className="flex-1 sm:flex-none">
            <Button variant="secondary" className="w-full">
              🛒 Ver carga
            </Button>
          </Link>
          {!loadBlocked && (
            <>
              <Button
                variant="success"
                onClick={openQuick}
                className="flex-1 sm:flex-none"
              >
                ⚡ Venta rápida
              </Button>
              <Button
                variant="secondary"
                onClick={openPickup}
                className="flex-1 sm:flex-none"
              >
                🔄 Retiro
              </Button>
            </>
          )}
          {canManage && (
            <Button
              onClick={() => setAddOpen(true)}
              className="flex-1 sm:flex-none"
            >
              + Agregar pedido
            </Button>
          )}
        </div>
      </div>

      {loadBlocked ? (
        <Card className="flex flex-col items-start gap-3 p-4">
          <p className="text-sm text-slate-600">
            🔒 Registra la carga inicial de la ruta para ver los pedidos.
          </p>
          <Link to={`/rutas/${id}/carga`}>
            <Button>Registrar carga</Button>
          </Link>
        </Card>
      ) : items.length === 0 ? (
        <EmptyState>
          {canManage
            ? 'Esta ruta no tiene pedidos. Agrega el primero con “Agregar pedido”.'
            : 'Esta ruta no tiene pedidos asignados todavía.'}
        </EmptyState>
      ) : (
        <StopExtrasContext.Provider
          value={{
            supplyName,
            onPickupDone: (pickupId, done) =>
              pickupDoneMutation.mutate({ pickupId, done }),
          }}
        >
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
                          onRemove={() =>
                            stop.pickup
                              ? removePickupMutation.mutate(stop.pickup.id)
                              : removeMutation.mutate(stop.id)
                          }
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
                                onRemove={() =>
                            stop.pickup
                              ? removePickupMutation.mutate(stop.pickup.id)
                              : removeMutation.mutate(stop.id)
                          }
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
                      onRemove={() =>
                            stop.pickup
                              ? removePickupMutation.mutate(stop.pickup.id)
                              : removeMutation.mutate(stop.id)
                          }
                    />
                  ))}
                </div>
              ) : (
                <Card className="overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <StopsTableHead showReturned />
                      <tbody>
                        {done.map((stop) => (
                          <StaticStopRow
                            key={stop.id}
                            stop={stop}
                            canManage={canManage}
                            onChanged={invalidateRoute}
                            onRemove={() =>
                            stop.pickup
                              ? removePickupMutation.mutate(stop.pickup.id)
                              : removeMutation.mutate(stop.id)
                          }
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
        </StopExtrasContext.Provider>
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

      {/* --- Venta rápida --- */}
      <Modal
        open={quickOpen}
        onClose={() => setQuickOpen(false)}
        title="Venta rápida"
        wide
      >
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (canQuickSave) quickSaleMutation.mutate()
          }}
          className="space-y-4"
        >
          <div>
            <Label>Nombre del cliente *</Label>
            <TextInput
              value={quickName}
              onChange={(e) => setQuickName(e.target.value)}
              placeholder="Ej: Señora del kiosco"
              autoFocus
            />
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <Label>Productos *</Label>
              <button
                type="button"
                onClick={() =>
                  setQuickItems((l) => [...l, { product_id: '', quantity: 1 }])
                }
                className="text-sm font-medium text-sky-600 hover:text-sky-700"
              >
                + Agregar producto
              </button>
            </div>
            <div className="space-y-2">
              {quickItems.map((it, i) => {
                const price = productMap.get(it.product_id) ?? 0
                return (
                  <div key={i} className="flex items-center gap-2">
                    <select
                      value={it.product_id}
                      onChange={(e) =>
                        updateQuickItem(i, { product_id: e.target.value })
                      }
                      className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-500"
                    >
                      <option value="">Producto…</option>
                      {products?.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} ({formatMoney(p.price)})
                        </option>
                      ))}
                    </select>
                    <div className="w-16 shrink-0">
                      <TextInput
                        type="number"
                        min="1"
                        inputMode="numeric"
                        value={it.quantity}
                        onChange={(e) =>
                          updateQuickItem(i, {
                            quantity: Math.max(1, Number(e.target.value) || 1),
                          })
                        }
                        className="text-center"
                      />
                    </div>
                    <span className="w-24 shrink-0 text-right text-sm font-medium text-slate-600">
                      {formatMoney(price * it.quantity)}
                    </span>
                    {quickItems.length > 1 && (
                      <button
                        type="button"
                        onClick={() =>
                          setQuickItems((l) => l.filter((_, idx) => idx !== i))
                        }
                        className="shrink-0 rounded-lg px-2 text-slate-400 hover:bg-slate-100 hover:text-red-600"
                        aria-label="Quitar producto"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          <div className="flex items-center justify-between border-t border-slate-100 pt-3">
            <span className="text-sm text-slate-500">Total</span>
            <span className="text-xl font-bold text-slate-900">
              {formatMoney(quickTotal)}
            </span>
          </div>

          {quickSaleMutation.isError && (
            <p className="text-sm text-red-600">
              Error: {(quickSaleMutation.error as Error).message}
            </p>
          )}

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setQuickOpen(false)}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              variant="success"
              disabled={!canQuickSave || quickSaleMutation.isPending}
            >
              {quickSaleMutation.isPending ? 'Guardando…' : 'Vender y agregar'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* --- Retiro (parada para recoger insumos) --- */}
      <Modal
        open={pickupOpen}
        onClose={() => setPickupOpen(false)}
        title="Agregar retiro"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (pickupValid) addPickupMutation.mutate()
          }}
          className="space-y-4"
        >
          <div>
            <Label>Cliente (opcional)</Label>
            <ClientCombobox
              clients={clients ?? []}
              value={pickupClientId}
              onChange={choosePickupClient}
            />
            <p className="mt-1 text-xs text-slate-400">
              Si hay un cliente involucrado, elígelo y se prellenan nombre y
              dirección.
            </p>
          </div>
          <div>
            <Label>Nombre / referencia</Label>
            <TextInput
              value={pickupName}
              onChange={(e) => setPickupName(e.target.value)}
              placeholder="Ej: Planta Puquén"
            />
          </div>
          <div>
            <Label>Dirección</Label>
            <TextInput
              value={pickupAddress}
              onChange={(e) => setPickupAddress(e.target.value)}
              placeholder="Dónde se retira"
            />
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <Label>Insumos a retirar *</Label>
              <button
                type="button"
                onClick={() =>
                  setPickupItems((l) => [...l, { supply_id: '', quantity: 1 }])
                }
                className="text-sm font-medium text-sky-600 hover:text-sky-700"
              >
                + Agregar insumo
              </button>
            </div>
            <div className="space-y-2">
              {pickupItems.map((it, i) => (
                <div key={i} className="flex items-center gap-2">
                  <select
                    value={it.supply_id}
                    onChange={(e) =>
                      setPickupItems((l) =>
                        l.map((x, idx) =>
                          idx === i ? { ...x, supply_id: e.target.value } : x
                        )
                      )
                    }
                    className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
                  >
                    <option value="">Insumo…</option>
                    {supplies?.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                  <div className="w-16 shrink-0">
                    <TextInput
                      type="number"
                      min="1"
                      value={it.quantity}
                      onChange={(e) =>
                        setPickupItems((l) =>
                          l.map((x, idx) =>
                            idx === i
                              ? {
                                  ...x,
                                  quantity: Math.max(
                                    1,
                                    Number(e.target.value) || 1
                                  ),
                                }
                              : x
                          )
                        )
                      }
                      className="text-center"
                    />
                  </div>
                  {pickupItems.length > 1 && (
                    <button
                      type="button"
                      onClick={() =>
                        setPickupItems((l) => l.filter((_, idx) => idx !== i))
                      }
                      className="shrink-0 rounded-lg px-2 py-2 text-slate-400 hover:bg-slate-100 hover:text-red-600"
                      aria-label="Quitar insumo"
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {addPickupMutation.isError && (
            <p className="text-sm text-red-600">
              Error: {(addPickupMutation.error as Error).message}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setPickupOpen(false)}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={!pickupValid || addPickupMutation.isPending}
            >
              {addPickupMutation.isPending ? 'Guardando…' : 'Agregar retiro'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}

function StopsTableHead({
  sortable = false,
  showReturned = false,
}: {
  sortable?: boolean
  showReturned?: boolean
}) {
  return (
    <thead>
      <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase text-slate-500">
        <th className="w-8 px-2 py-2">{sortable ? '' : '✓'}</th>
        <th className="w-8 px-2 py-2">#</th>
        <th className="px-3 py-2">Cliente</th>
        <th className="px-3 py-2">Productos</th>
        <th className="px-3 py-2">Dirección</th>
        <th className="px-3 py-2">Teléfono</th>
        <th className="px-3 py-2 text-right">Total</th>
        <th className="px-3 py-2">Estado</th>
        {showReturned && <th className="px-3 py-2">Método</th>}
        {showReturned && <th className="px-3 py-2 text-center">Devueltos</th>}
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
  showReturned = false,
}: {
  stop: RouteStopWithOrder
  canManage: boolean
  onChanged: () => void
  onRemove: () => void
  showReturned?: boolean
}) {
  const { supplyName, onPickupDone } = useContext(StopExtrasContext)
  const order = stop.order
  const pickup = stop.pickup

  // --- Fila de RETIRO ---
  if (pickup) {
    const address = stopAddress(stop)
    return (
      <>
        <td className="px-3 py-2 font-medium text-slate-800">
          <div className="flex items-center gap-2">
            <span>{pickup.customer_name || 'Retiro'}</span>
            <span className="rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-800">
              Retiro
            </span>
          </div>
        </td>
        <td className="px-3 py-2 text-slate-600">
          {pickupItemsText(pickup, supplyName)}
        </td>
        <td className="px-3 py-2 text-slate-600">
          <div className="flex items-center gap-1">
            <span className="min-w-0">{address}</span>
            {pickup.address && (
              <>
                <CopyButton value={pickup.address} label="Copiar dirección" />
                <MapButton query={pickup.address} />
              </>
            )}
          </div>
        </td>
        <td className="px-3 py-2 text-slate-600">
          <div className="flex items-center gap-1">
            <span>{pickup.client?.phone ?? '—'}</span>
            {pickup.client?.phone && (
              <>
                <CallButton phone={pickup.client.phone} />
                <CopyButton
                  value={pickup.client.phone}
                  label="Copiar teléfono"
                />
              </>
            )}
          </div>
        </td>
        <td className="px-3 py-2 text-right text-slate-400">—</td>
        <td className="px-3 py-2">
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
              pickup.done
                ? 'bg-emerald-100 text-emerald-800'
                : 'bg-amber-100 text-amber-800'
            }`}
          >
            {pickup.done ? 'Recogido' : 'Por retirar'}
          </span>
        </td>
        {showReturned && <td className="px-3 py-2 text-slate-400">—</td>}
        {showReturned && (
          <td className="px-3 py-2 text-center text-slate-400">—</td>
        )}
        <td className="px-3 py-2">
          <Button
            variant={pickup.done ? 'secondary' : 'success'}
            onClick={() => onPickupDone(pickup.id, !pickup.done)}
          >
            {pickup.done ? 'Deshacer' : 'Recogido'}
          </Button>
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

  const clientName = order ? orderClientName(order) : 'Pedido'
  return (
    <>
      <td className="px-3 py-2 font-medium text-slate-800">{clientName}</td>
      <td className="px-3 py-2 text-slate-600">
        {order ? <OrderItemsList items={order.items} /> : '—'}
      </td>
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
            <>
              <CallButton phone={order.client.phone} />
              <CopyButton value={order.client.phone} label="Copiar teléfono" />
            </>
          )}
        </div>
      </td>
      <td className="px-3 py-2 text-right font-medium text-slate-800">
        {order ? formatMoney(order.total) : '—'}
      </td>
      <td className="px-3 py-2">
        {order && (
          <div className="flex flex-col items-start gap-1">
            <StatusBadge status={order.status} />
            <PaidBadge paid={order.paid} />
          </div>
        )}
      </td>
      {showReturned && (
        <td className="px-3 py-2 text-slate-700">
          {order?.payment_method ? PAYMENT_LABELS[order.payment_method] : '—'}
        </td>
      )}
      {showReturned && (
        <td className="px-3 py-2 text-center tabular-nums text-slate-700">
          {order ? returnedBidonesText(order) : '—'}
        </td>
      )}
      <td className="px-3 py-2">
        {order && (
          <OrderActions
            order={order}
            onChanged={onChanged}
            className="flex w-40 flex-col items-stretch gap-1"
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
        showReturned
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
  const { supplyName, onPickupDone } = useContext(StopExtrasContext)
  const order = stop.order
  const pickup = stop.pickup

  // --- Tarjeta de RETIRO ---
  if (pickup) {
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
                {pickup.customer_name || 'Retiro'}
              </span>
              <span className="rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-800">
                Retiro
              </span>
            </div>
            <div className="mt-1.5 flex items-start gap-2 text-sm">
              <span aria-hidden>🔄</span>
              <span className="min-w-0">
                {pickupItemsText(pickup, supplyName)}
              </span>
            </div>
            {pickup.address && (
              <div className="mt-1 flex items-start gap-2 text-sm text-slate-600">
                <span aria-hidden>📍</span>
                <span className="min-w-0 flex-1 break-words">
                  {pickup.address}
                </span>
                <CopyButton value={pickup.address} label="Copiar dirección" />
                <MapButton query={pickup.address} />
              </div>
            )}
            {pickup.client?.phone && (
              <div className="mt-0.5 flex items-center gap-2 text-sm text-slate-500">
                <span aria-hidden>📞</span>
                <span className="flex-1">{pickup.client.phone}</span>
                <CallButton phone={pickup.client.phone} />
                <CopyButton
                  value={pickup.client.phone}
                  label="Copiar teléfono"
                />
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
          <Button
            variant={pickup.done ? 'secondary' : 'success'}
            onClick={() => onPickupDone(pickup.id, !pickup.done)}
          >
            {pickup.done ? 'Deshacer retiro' : 'Marcar recogido'}
          </Button>
        </div>
      </div>
    )
  }

  const clientName = order ? orderClientName(order) : 'Pedido'
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
            {order && <PaidBadge paid={order.paid} />}
          </div>
          {order && order.items.length > 0 && (
            <div className="mt-1.5 flex items-start gap-2 text-sm">
              <span aria-hidden>📦</span>
              <OrderItemsList items={order.items} className="min-w-0" />
            </div>
          )}
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
              <CallButton phone={order.client.phone} />
              <CopyButton value={order.client.phone} label="Copiar teléfono" />
            </div>
          )}
          {order &&
            order.status !== 'ordered' &&
            order.returned_bidones != null && (
              <div className="mt-0.5 flex items-center gap-2 text-sm text-slate-600">
                <span aria-hidden>↩</span>
                <span>{order.returned_bidones} bidones devueltos</span>
              </div>
            )}
          {order && !order.paid && order.payment_method && (
            <div className="mt-0.5 flex items-center gap-2 text-sm text-slate-600">
              <span aria-hidden>💳</span>
              <span>Método: {PAYMENT_LABELS[order.payment_method]}</span>
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
