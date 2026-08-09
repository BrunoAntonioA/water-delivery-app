import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import {
  createOrder,
  deleteOrder,
  listOrders,
  updateOrder,
  type OrderItemInput,
} from '../api/orders'
import { createClient, listClients } from '../api/clients'
import { listProducts } from '../api/products'
import { addOrderToRoute, listRoutes, type RouteSummary } from '../api/routes'
import type { OrderDetail, OrderStatus, PaymentMethod } from '../types/db'
import {
  formatDate,
  formatDatePart,
  formatDateShort,
  formatMoney,
  formatTimePart,
  toLocalDateStr,
} from '../lib/format'
import { useIsMobile } from '../lib/useIsMobile'
import {
  orderClientName,
  orderPaymentList,
  returnedBidonesText,
} from '../lib/order'
import { OrderItemsList } from '../components/OrderItems'
import { ClientCombobox } from '../components/ClientCombobox'
import { Modal } from '../components/Modal'
import { OrderActions } from '../components/OrderActions'
import { PaidBadge, PAYMENT_LABELS, StatusBadge } from '../components/StatusBadge'
import { DateRangeFilter } from '../components/DateRangeFilter'
import {
  Button,
  CallButton,
  Card,
  CopyButton,
  EmptyState,
  Label,
  MapButton,
  NumberInput,
  Pagination,
  PageHeader,
  Spinner,
  TextArea,
  TextInput,
} from '../components/ui'

interface DraftItem {
  product_id: string
  quantity: number
}

const PAGE_SIZE = 10

// Estado de ENTREGA (el pago va en su propio filtro).
type StatusFilter = 'all' | OrderStatus

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'ordered', label: 'Sin entregar' },
  { value: 'delivered', label: 'Entregado' },
]

type PaidFilter = 'all' | 'paid' | 'unpaid'

const PAID_FILTERS: { value: PaidFilter; label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'paid', label: 'Pagado' },
  { value: 'unpaid', label: 'Pendiente' },
]

export default function OrdersPage() {
  const qc = useQueryClient()
  const isMobile = useIsMobile()

  const { data: orders, isLoading } = useQuery({
    queryKey: ['orders'],
    queryFn: listOrders,
  })
  const { data: clients } = useQuery({
    queryKey: ['clients'],
    queryFn: listClients,
  })
  const { data: products } = useQuery({
    queryKey: ['products'],
    queryFn: listProducts,
  })
  const { data: routes } = useQuery({
    queryKey: ['routes'],
    queryFn: listRoutes,
  })

  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [clientId, setClientId] = useState('')
  const [addressId, setAddressId] = useState('')
  const [notes, setNotes] = useState('')
  const [items, setItems] = useState<DraftItem[]>([])
  // Pago al crear/editar el pedido.
  const [formPaid, setFormPaid] = useState(false)
  const [formMethod, setFormMethod] = useState<PaymentMethod | ''>('')

  // Registro rápido de cliente dentro del formulario de pedido.
  const emptyNewClient = { name: '', surname: '', phone: '', address: '', comuna: '' }
  const [newClientMode, setNewClientMode] = useState(false)
  const [newClient, setNewClient] = useState(emptyNewClient)

  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [paidFilter, setPaidFilter] = useState<PaidFilter>('all')
  const [paymentFilter, setPaymentFilter] = useState<'all' | PaymentMethod>(
    'all'
  )
  const [filterClientId, setFilterClientId] = useState('')
  const [nameSearch, setNameSearch] = useState('')
  const [page, setPage] = useState(1)

  const invalidate = () => qc.invalidateQueries({ queryKey: ['orders'] })

  const filteredOrders = useMemo(() => {
    return (orders ?? []).filter((o) => {
      const d = toLocalDateStr(o.created_at)
      if (dateFrom && d < dateFrom) return false
      if (dateTo && d > dateTo) return false
      if (filterClientId && o.client_id !== filterClientId) return false
      if (
        nameSearch &&
        !orderClientName(o).toLowerCase().includes(nameSearch.trim().toLowerCase())
      )
        return false
      if (paymentFilter !== 'all' && o.payment_method !== paymentFilter)
        return false
      if (paidFilter === 'paid' && !o.paid) return false
      if (paidFilter === 'unpaid' && o.paid) return false
      if (statusFilter !== 'all' && o.status !== statusFilter) return false
      return true
    })
  }, [
    orders,
    dateFrom,
    dateTo,
    statusFilter,
    paidFilter,
    paymentFilter,
    filterClientId,
    nameSearch,
  ])

  const hasFilters = Boolean(
    dateFrom ||
      dateTo ||
      filterClientId ||
      nameSearch ||
      statusFilter !== 'all' ||
      paidFilter !== 'all' ||
      paymentFilter !== 'all'
  )
  function clearFilters() {
    setDateFrom('')
    setDateTo('')
    setFilterClientId('')
    setNameSearch('')
    setStatusFilter('all')
    setPaidFilter('all')
    setPaymentFilter('all')
    setPage(1)
  }

  const pageCount = Math.max(1, Math.ceil(filteredOrders.length / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount)
  const pageItems = filteredOrders.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE
  )

  const selectedClient = useMemo(
    () => clients?.find((c) => c.id === clientId),
    [clients, clientId]
  )

  const productMap = useMemo(() => {
    const m = new Map<string, number>()
    products?.forEach((p) => m.set(p.id, p.price))
    return m
  }, [products])

  const draftTotal = useMemo(
    () =>
      items.reduce(
        (sum, it) => sum + it.quantity * (productMap.get(it.product_id) ?? 0),
        0
      ),
    [items, productMap]
  )

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload: OrderItemInput[] = items
        .filter((it) => it.product_id && it.quantity > 0)
        .map((it) => ({
          product_id: it.product_id,
          quantity: it.quantity,
          unit_price: productMap.get(it.product_id) ?? 0,
        }))
      const input = {
        client_id: clientId,
        address_id: addressId || null,
        notes,
        items: payload,
        paid: formPaid,
        payment_method: formPaid ? (formMethod as PaymentMethod) : null,
      }
      if (editingId) await updateOrder(editingId, input)
      else await createOrder(input)
    },
    onSuccess: () => {
      invalidate()
      setModalOpen(false)
      setEditingId(null)
    },
  })

  // Pedido pendiente de eliminación (confirmación en un modal propio: window.
  // confirm() no funciona de forma fiable en el móvil / app instalada).
  const [deleteTarget, setDeleteTarget] = useState<OrderDetail | null>(null)

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteOrder(id),
    onSuccess: () => {
      invalidate()
      setDeleteTarget(null)
    },
  })

  // Pedido que se va a agregar a una ruta (abre el modal con las rutas).
  const [assignTarget, setAssignTarget] = useState<OrderDetail | null>(null)

  const addToRouteMutation = useMutation({
    mutationFn: ({ orderId, routeId }: { orderId: string; routeId: string }) =>
      addOrderToRoute(routeId, orderId),
    onSuccess: () => {
      invalidate()
      qc.invalidateQueries({ queryKey: ['routes'] })
      setAssignTarget(null)
    },
  })

  const createClientMutation = useMutation({
    mutationFn: () =>
      createClient({
        name: newClient.name.trim(),
        surname: newClient.surname.trim(),
        national_id: '',
        phone: newClient.phone.trim(),
        addresses: [
          {
            label: 'Casa',
            address: newClient.address.trim(),
            comuna: newClient.comuna.trim(),
            observation: '',
          },
        ],
      }),
    onSuccess: ({ id, addressId: newAddressId }) => {
      qc.invalidateQueries({ queryKey: ['clients'] })
      setClientId(id)
      setAddressId(newAddressId ?? '')
      setNewClientMode(false)
      setNewClient(emptyNewClient)
    },
  })

  const canSaveNewClient = Boolean(
    newClient.name.trim() &&
      newClient.phone.trim() &&
      newClient.address.trim() &&
      newClient.comuna.trim()
  )

  function openNew() {
    setEditingId(null)
    setClientId('')
    setAddressId('')
    setNotes('')
    setItems([{ product_id: '', quantity: 1 }])
    setFormPaid(false)
    setFormMethod('')
    setNewClientMode(false)
    setNewClient(emptyNewClient)
    setModalOpen(true)
  }

  function openEdit(o: OrderDetail) {
    setEditingId(o.id)
    setClientId(o.client_id ?? '')
    setAddressId(o.address_id ?? '')
    setNotes(o.notes ?? '')
    setItems(
      o.items.length
        ? o.items.map((it) => ({
            product_id: it.product_id,
            quantity: it.quantity,
          }))
        : [{ product_id: '', quantity: 1 }]
    )
    setFormPaid(o.paid)
    setFormMethod(o.payment_method ?? '')
    setNewClientMode(false)
    setNewClient(emptyNewClient)
    setModalOpen(true)
  }

  // Sólo se pueden editar pedidos aún en estado "Pedido" y con cliente
  // registrado (las ventas rápidas se manejan desde la ruta).
  const canEditOrder = (o: OrderDetail) =>
    o.status === 'ordered' && Boolean(o.client_id)

  function updateItem(i: number, patch: Partial<DraftItem>) {
    setItems((list) =>
      list.map((it, idx) => (idx === i ? { ...it, ...patch } : it))
    )
  }

  const validItems = items.filter((it) => it.product_id && it.quantity > 0)
  const canSave =
    clientId && validItems.length > 0 && (!formPaid || formMethod)

  return (
    <div>
      <PageHeader
        title="Pedidos"
        subtitle="Crea pedidos, avanza su estado y cobra por WhatsApp."
        action={
          <Button onClick={openNew} disabled={!clients?.length}>
            + Nuevo pedido
          </Button>
        }
      />

      {!clients?.length && (
        <p className="mb-4 rounded-lg bg-amber-50 px-4 py-2 text-sm text-amber-800">
          Necesitas al menos un cliente y un producto para crear pedidos.
        </p>
      )}

      {!isLoading && orders && orders.length > 0 && (
        <>
          <Card className="mb-4 p-4">
            <div className="mb-4">
              <Label>Buscar por nombre</Label>
              <TextInput
                value={nameSearch}
                onChange={(e) => {
                  setNameSearch(e.target.value)
                  setPage(1)
                }}
                placeholder="Nombre del cliente o de la venta rápida…"
                className="w-full sm:max-w-sm"
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label>Cliente registrado</Label>
                <ClientCombobox
                  clients={clients ?? []}
                  value={filterClientId}
                  onChange={(cid) => {
                    setFilterClientId(cid)
                    setPage(1)
                  }}
                />
              </div>
              <DateRangeFilter
                from={dateFrom}
                to={dateTo}
                onChange={(f, t) => {
                  setDateFrom(f)
                  setDateTo(t)
                  setPage(1)
                }}
                label="Fecha de creación"
              />
            </div>

            <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:gap-6 sm:overflow-x-auto sm:pb-1">
              <div className="shrink-0">
                <Label>Estado</Label>
                <div className="flex gap-1">
                  {STATUS_FILTERS.map((f) => (
                    <button
                      key={f.value}
                      type="button"
                      onClick={() => {
                        setStatusFilter(f.value)
                        setPage(1)
                      }}
                      className={`rounded-full px-3 py-1 text-sm font-medium transition-colors ${
                        statusFilter === f.value
                          ? 'bg-sky-600 text-white'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="shrink-0">
                <Label>Pago</Label>
                <div className="flex gap-1">
                  {PAID_FILTERS.map((f) => (
                    <button
                      key={f.value}
                      type="button"
                      onClick={() => {
                        setPaidFilter(f.value)
                        setPage(1)
                      }}
                      className={`rounded-full px-3 py-1 text-sm font-medium transition-colors ${
                        paidFilter === f.value
                          ? 'bg-emerald-600 text-white'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="shrink-0">
                <Label>Método</Label>
                <div className="flex gap-1">
                  {(
                    [
                      { value: 'all', label: 'Todos' },
                      { value: 'efectivo', label: 'Efectivo' },
                      { value: 'transferencia', label: 'Transferencia' },
                      { value: 'tarjeta', label: 'Tarjeta' },
                    ] as { value: 'all' | PaymentMethod; label: string }[]
                  ).map((f) => (
                    <button
                      key={f.value}
                      type="button"
                      onClick={() => {
                        setPaymentFilter(f.value)
                        setPage(1)
                      }}
                      className={`rounded-full px-3 py-1 text-sm font-medium transition-colors ${
                        paymentFilter === f.value
                          ? 'bg-emerald-600 text-white'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {hasFilters && (
              <div className="mt-4">
                <Button variant="ghost" onClick={clearFilters}>
                  Limpiar filtros
                </Button>
              </div>
            )}
          </Card>

          <div className="mb-3 text-sm text-slate-500">
            {filteredOrders.length}{' '}
            {filteredOrders.length === 1 ? 'pedido' : 'pedidos'}
          </div>
        </>
      )}

      {isLoading ? (
        <Spinner />
      ) : !orders || orders.length === 0 ? (
        <EmptyState>Aún no hay pedidos.</EmptyState>
      ) : filteredOrders.length === 0 ? (
        <EmptyState>No hay pedidos con esos filtros.</EmptyState>
      ) : isMobile ? (
        <>
          <div className="grid gap-3">
          {pageItems.map((o) => {
            return (
              <Card key={o.id} className="p-4">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-slate-900">
                        {orderClientName(o)}
                      </span>
                      {!o.client_id && (
                        <span className="rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-800">
                          Venta rápida
                        </span>
                      )}
                      <StatusBadge status={o.status} />
                      <PaidBadge paid={o.paid} />
                    </div>
                    <p className="text-xs text-slate-400">
                      {formatDate(o.created_at)}
                    </p>
                    {o.routeDate && (
                      <p className="text-xs text-slate-500">
                        🚚 Ruta de entrega: {formatDateShort(o.routeDate)}
                      </p>
                    )}
                    <ul className="mt-2 space-y-0.5 text-sm text-slate-600">
                      {o.items.map((it) => (
                        <li key={it.id}>
                          {it.quantity} × {it.product?.name ?? 'Producto'} —{' '}
                          {formatMoney(it.quantity * it.unit_price)}
                        </li>
                      ))}
                    </ul>
                    {o.address && (
                      <div className="mt-1 flex items-start gap-2 text-sm text-slate-500">
                        <span className="min-w-0 flex-1 break-words">
                          📍 {o.address.address}
                          {o.address.comuna ? `, ${o.address.comuna}` : ''}
                          {o.address.observation
                            ? ` (${o.address.observation})`
                            : ''}
                        </span>
                        <CopyButton
                          value={o.address.address}
                          label="Copiar dirección"
                        />
                        <MapButton
                          query={[o.address.address, o.address.comuna]
                            .filter(Boolean)
                            .join(', ')}
                        />
                      </div>
                    )}
                    {o.client?.phone && (
                      <div className="mt-1 flex items-center gap-2 text-sm text-slate-500">
                        <span className="flex-1">📞 {o.client.phone}</span>
                        <CallButton phone={o.client.phone} />
                        <CopyButton
                          value={o.client.phone}
                          label="Copiar teléfono"
                        />
                      </div>
                    )}
                    {o.notes && (
                      <p className="mt-1 text-sm italic text-slate-500">
                        “{o.notes}”
                      </p>
                    )}
                  </div>

                  {/* Editar / Eliminar (arriba a la derecha) */}
                  <div className="flex shrink-0 flex-col items-center gap-1">
                    {canEditOrder(o) && (
                      <button
                        type="button"
                        onClick={() => openEdit(o)}
                        aria-label="Editar pedido"
                        className="rounded-lg px-2 py-1 text-slate-400 hover:bg-slate-100 hover:text-sky-600"
                      >
                        ✏️
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setDeleteTarget(o)}
                      aria-label="Eliminar pedido"
                      className="rounded-lg px-2 py-1 text-slate-400 hover:bg-slate-100 hover:text-red-600"
                    >
                      ✕
                    </button>
                  </div>
                </div>

                <div className="mt-2 border-t border-slate-100 pt-2">
                  <p className="font-bold text-slate-900">
                    Total: {formatMoney(o.total)}
                  </p>
                  {o.status !== 'ordered' && o.returned_bidones != null && (
                    <p className="mt-1 text-sm text-slate-600">
                      ↩ {o.returned_bidones} bidones devueltos
                    </p>
                  )}
                  {o.paid ? (
                    <p className="mt-1 text-sm text-emerald-700">
                      ✓ Pagado:{' '}
                      {orderPaymentList(o)
                        .map(
                          (p) =>
                            `${PAYMENT_LABELS[p.method]} ${formatMoney(p.amount)}`
                        )
                        .join(' + ')}
                    </p>
                  ) : (
                    o.payment_method && (
                      <p className="mt-1 text-sm text-slate-600">
                        Método (acordado): {PAYMENT_LABELS[o.payment_method]}
                      </p>
                    )
                  )}
                  {o.routeDate ? (
                    <OrderActions
                      order={o}
                      onChanged={invalidate}
                      className="mt-2 flex flex-wrap items-center gap-2"
                    />
                  ) : (
                    <Button
                      className="mt-2 w-full"
                      onClick={() => setAssignTarget(o)}
                    >
                      🚚 Agregar a ruta
                    </Button>
                  )}
                </div>
              </Card>
            )
          })}
          </div>
          <Pagination
            page={currentPage}
            pageCount={pageCount}
            onPage={setPage}
          />
        </>
      ) : (
        <>
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-center text-xs uppercase text-slate-500">
                    <th className="px-3 py-2">Cliente</th>
                    <th className="w-16 px-2 py-2">Fecha de ruta de entrega</th>
                    <th className="px-3 py-2">Productos</th>
                    <th className="px-3 py-2">Dirección</th>
                    <th className="px-3 py-2">Teléfono</th>
                    <th className="px-3 py-2">Total</th>
                    <th className="px-3 py-2">Estado</th>
                    <th className="px-3 py-2">Método</th>
                    <th className="px-3 py-2 text-center">Devueltos</th>
                    <th className="w-16 px-2 py-2">Fecha de creación</th>
                    <th className="px-3 py-2">Acciones</th>
                    <th className="w-10 px-2 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {pageItems.map((o) => (
                    <OrderRow
                      key={o.id}
                      o={o}
                      onChanged={invalidate}
                      onEdit={canEditOrder(o) ? () => openEdit(o) : undefined}
                      onDelete={() => setDeleteTarget(o)}
                      onAddToRoute={() => setAssignTarget(o)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          <Pagination
            page={currentPage}
            pageCount={pageCount}
            onPage={setPage}
          />
        </>
      )}

      {/* Agregar el pedido a una ruta (mientras no esté en una, se bloquean las
          acciones de entrega/pago) */}
      <Modal
        open={assignTarget != null}
        onClose={() => setAssignTarget(null)}
        title="Agregar pedido a una ruta"
        wide
      >
        {addToRouteMutation.isError && (
          <p className="mb-3 text-sm text-red-600">
            Error: {(addToRouteMutation.error as Error).message}
          </p>
        )}
        <AddToRouteList
          routes={routes ?? []}
          onAdd={(routeId) =>
            assignTarget &&
            addToRouteMutation.mutate({ orderId: assignTarget.id, routeId })
          }
          isPending={addToRouteMutation.isPending}
        />
      </Modal>

      {/* Confirmación de borrado (en vez de window.confirm, que falla en móvil) */}
      <Modal
        open={deleteTarget != null}
        onClose={() => setDeleteTarget(null)}
        title="Eliminar pedido"
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            ¿Eliminar el pedido de{' '}
            <span className="font-semibold">
              {deleteTarget ? orderClientName(deleteTarget) : ''}
            </span>
            ? Esta acción no se puede deshacer.
          </p>
          {deleteMutation.isError && (
            <p className="text-sm text-red-600">
              Error al eliminar: {(deleteMutation.error as Error).message}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setDeleteTarget(null)}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              variant="danger"
              disabled={deleteMutation.isPending}
              onClick={() =>
                deleteTarget && deleteMutation.mutate(deleteTarget.id)
              }
            >
              {deleteMutation.isPending ? 'Eliminando…' : 'Eliminar'}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingId ? 'Editar pedido' : 'Nuevo pedido'}
        wide
      >
        <form
          onSubmit={(e) => {
            e.preventDefault()
            saveMutation.mutate()
          }}
          className="space-y-4"
        >
          {newClientMode ? (
            <div className="space-y-3 rounded-xl border border-sky-200 bg-sky-50/60 p-4">
              <p className="font-medium text-slate-800">
                Registrar cliente nuevo
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <Label>Nombre *</Label>
                  <TextInput
                    value={newClient.name}
                    onChange={(e) =>
                      setNewClient({ ...newClient, name: e.target.value })
                    }
                    placeholder="Nombre"
                    autoFocus
                  />
                </div>
                <div>
                  <Label>Apellido</Label>
                  <TextInput
                    value={newClient.surname}
                    onChange={(e) =>
                      setNewClient({ ...newClient, surname: e.target.value })
                    }
                    placeholder="Apellido"
                  />
                </div>
              </div>
              <div>
                <Label>Teléfono *</Label>
                <TextInput
                  value={newClient.phone}
                  onChange={(e) =>
                    setNewClient({ ...newClient, phone: e.target.value })
                  }
                  placeholder="+56912345678"
                />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <Label>Dirección *</Label>
                  <TextInput
                    value={newClient.address}
                    onChange={(e) =>
                      setNewClient({ ...newClient, address: e.target.value })
                    }
                    placeholder="Dirección"
                  />
                </div>
                <div>
                  <Label>Comuna *</Label>
                  <TextInput
                    value={newClient.comuna}
                    onChange={(e) =>
                      setNewClient({ ...newClient, comuna: e.target.value })
                    }
                    placeholder="Comuna"
                  />
                </div>
              </div>
              {createClientMutation.isError && (
                <p className="text-sm text-red-600">
                  Error: {(createClientMutation.error as Error).message}
                </p>
              )}
              <div className="flex gap-2">
                <Button
                  type="button"
                  onClick={() => createClientMutation.mutate()}
                  disabled={!canSaveNewClient || createClientMutation.isPending}
                >
                  {createClientMutation.isPending
                    ? 'Guardando…'
                    : 'Guardar y usar'}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setNewClientMode(false)}
                >
                  Cancelar
                </Button>
              </div>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label>Cliente *</Label>
                <ClientCombobox
                  clients={clients ?? []}
                  value={clientId}
                  onChange={(id) => {
                    setClientId(id)
                    setAddressId('')
                  }}
                  onCreateNew={(q) => {
                    setNewClient({ ...emptyNewClient, name: q })
                    setNewClientMode(true)
                  }}
                />
              </div>
              <div>
                <Label>Dirección de entrega</Label>
                <select
                  value={addressId}
                  onChange={(e) => setAddressId(e.target.value)}
                  disabled={!selectedClient?.addresses.length}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100 disabled:bg-slate-50"
                >
                  <option value="">
                    {selectedClient?.addresses.length
                      ? 'Selecciona una dirección…'
                      : 'Sin direcciones'}
                  </option>
                  {selectedClient?.addresses.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.label ? `${a.label}: ` : ''}
                      {a.address}
                      {a.comuna ? `, ${a.comuna}` : ''}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          <div>
            <div className="mb-1 flex items-center justify-between">
              <Label>Productos *</Label>
              <button
                type="button"
                onClick={() =>
                  setItems((l) => [...l, { product_id: '', quantity: 1 }])
                }
                className="text-sm font-medium text-sky-600 hover:text-sky-700"
              >
                + Agregar producto
              </button>
            </div>
            <div className="space-y-2">
              {items.map((it, i) => {
                const price = productMap.get(it.product_id) ?? 0
                return (
                  <div
                    key={i}
                    className="flex flex-col gap-2.5 rounded-xl border border-slate-200 bg-slate-50 p-3 sm:flex-row sm:items-center sm:gap-3 sm:rounded-none sm:border-0 sm:bg-transparent sm:p-0"
                  >
                    <select
                      value={it.product_id}
                      onChange={(e) =>
                        updateItem(i, { product_id: e.target.value })
                      }
                      className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
                    >
                      <option value="">Producto…</option>
                      {products?.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} ({formatMoney(p.price)})
                        </option>
                      ))}
                    </select>

                    <div className="flex items-center justify-between gap-3 sm:justify-end">
                      <label className="flex items-center gap-2">
                        <span className="text-sm text-slate-500 sm:sr-only">
                          Cantidad
                        </span>
                        <div className="w-20 shrink-0">
                          <NumberInput
                            min={1}
                            value={it.quantity}
                            onValueChange={(n) =>
                              updateItem(i, { quantity: n })
                            }
                            className="bg-white text-center"
                          />
                        </div>
                      </label>
                      <div className="flex items-center gap-1">
                        <span className="text-base font-semibold text-slate-800 sm:w-24 sm:text-right sm:text-sm sm:font-medium">
                          {formatMoney(price * it.quantity)}
                        </span>
                        {items.length > 1 && (
                          <button
                            type="button"
                            onClick={() =>
                              setItems((l) => l.filter((_, idx) => idx !== i))
                            }
                            className="shrink-0 rounded-lg px-2 py-2 text-slate-400 hover:bg-slate-100 hover:text-red-600"
                            aria-label="Quitar producto"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          <div>
            <Label>Notas (opcional)</Label>
            <TextArea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
            />
          </div>

          {/* Pago al crear el pedido (puede pagarse sin haber sido entregado). */}
          <div className="rounded-lg border border-slate-200 p-3">
            <label className="flex cursor-pointer items-center gap-3">
              <input
                type="checkbox"
                checked={formPaid}
                onChange={(e) => {
                  setFormPaid(e.target.checked)
                  if (!e.target.checked) setFormMethod('')
                }}
                className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
              />
              <span className="text-sm font-medium text-slate-700">
                Ya está pagado
              </span>
            </label>
            {formPaid && (
              <div className="mt-3">
                <Label>Método de pago *</Label>
                <div className="grid grid-cols-3 gap-2">
                  {(['efectivo', 'transferencia', 'tarjeta'] as PaymentMethod[]).map(
                    (m) => (
                      <button
                        type="button"
                        key={m}
                        onClick={() => setFormMethod(m)}
                        className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                          formMethod === m
                            ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                            : 'border-slate-300 text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        {PAYMENT_LABELS[m]}
                      </button>
                    )
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between border-t border-slate-100 pt-3">
            <span className="text-sm text-slate-500">Total del pedido</span>
            <span className="text-xl font-bold text-slate-900">
              {formatMoney(draftTotal)}
            </span>
          </div>

          {saveMutation.isError && (
            <p className="text-sm text-red-600">
              Error al guardar: {(saveMutation.error as Error).message}
            </p>
          )}

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setModalOpen(false)}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={!canSave || saveMutation.isPending}>
              {saveMutation.isPending
                ? 'Guardando…'
                : editingId
                  ? 'Guardar cambios'
                  : 'Crear pedido'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}

// Fila de la tabla de pedidos (vista escritorio), con el mismo estilo que las
// paradas de una ruta: dirección con copiar/mapa, teléfono con copiar, acciones.
function OrderRow({
  o,
  onChanged,
  onEdit,
  onDelete,
  onAddToRoute,
}: {
  o: OrderDetail
  onChanged: () => void
  onEdit?: () => void
  onDelete: () => void
  onAddToRoute: () => void
}) {
  const clientName = orderClientName(o)
  const addressFull = o.address
    ? [o.address.address, o.address.comuna].filter(Boolean).join(', ')
    : ''
  return (
    <tr className="border-b border-slate-100 last:border-0 [&>td]:align-middle [&>td]:text-center">
      <td className="px-3 py-2 font-medium text-slate-800">
        <div className="flex flex-col items-center gap-1">
          <span>{clientName}</span>
          {!o.client_id && (
            <span className="rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-800">
              Venta rápida
            </span>
          )}
        </div>
      </td>
      <td className="w-16 whitespace-nowrap px-2 py-2 text-center text-slate-600">
        {o.routeDate ? formatDateShort(o.routeDate) : '—'}
      </td>
      <td className="px-3 py-2 text-slate-600">
        <OrderItemsList items={o.items} />
      </td>
      <td className="px-3 py-2 text-slate-600">
        {o.address ? (
          <div className="flex items-center justify-center gap-1">
            <span className="min-w-0">{addressFull}</span>
            <CopyButton value={o.address.address} label="Copiar dirección" />
            <MapButton query={addressFull} />
          </div>
        ) : (
          '—'
        )}
      </td>
      <td className="px-3 py-2 text-slate-600">
        {o.client?.phone ? (
          <div className="flex items-center justify-center gap-1">
            <span>{o.client.phone}</span>
            <CallButton phone={o.client.phone} />
            <CopyButton value={o.client.phone} label="Copiar teléfono" />
          </div>
        ) : (
          '—'
        )}
      </td>
      <td className="px-3 py-2 font-medium text-slate-800">
        {formatMoney(o.total)}
      </td>
      <td className="px-3 py-2">
        <div className="flex flex-col items-center gap-1">
          <StatusBadge status={o.status} />
          <PaidBadge paid={o.paid} />
        </div>
      </td>
      <td className="px-3 py-2 text-slate-700">
        {orderPaymentList(o)
          .map((p) => PAYMENT_LABELS[p.method])
          .join(' + ') || '—'}
      </td>
      <td className="px-3 py-2 text-center tabular-nums text-slate-700">
        {returnedBidonesText(o)}
      </td>
      <td className="w-16 whitespace-nowrap px-2 py-2 text-center text-slate-600">
        <div className="leading-tight">
          <div>{formatDatePart(o.created_at)}</div>
          <div className="text-xs text-slate-400">
            {formatTimePart(o.created_at)}
          </div>
        </div>
      </td>
      <td className="px-3 py-2">
        {o.routeDate ? (
          <OrderActions
            order={o}
            onChanged={onChanged}
            className="mx-auto flex w-40 flex-col items-stretch gap-1"
          />
        ) : (
          <Button className="mx-auto w-40" onClick={onAddToRoute}>
            🚚 Agregar a ruta
          </Button>
        )}
      </td>
      <td className="px-2 py-2">
        <div className="flex items-center justify-center gap-1">
          {onEdit && (
            <button
              type="button"
              onClick={onEdit}
              aria-label="Editar pedido"
              className="rounded-lg px-2 py-1 text-slate-400 hover:bg-slate-100 hover:text-sky-600"
            >
              ✏️
            </button>
          )}
          <button
            type="button"
            onClick={onDelete}
            aria-label="Eliminar pedido"
            className="rounded-lg px-2 py-1 text-slate-400 hover:bg-slate-100 hover:text-red-600"
          >
            ✕
          </button>
        </div>
      </td>
    </tr>
  )
}

/** Lista de rutas ABIERTAS para asignarles el pedido. */
function AddToRouteList({
  routes,
  onAdd,
  isPending,
}: {
  routes: RouteSummary[]
  onAdd: (routeId: string) => void
  isPending: boolean
}) {
  const open = routes.filter((r) => !r.closed_at)
  if (open.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-slate-500">
        No hay rutas abiertas. Crea una ruta en el módulo Rutas y vuelve a
        intentarlo.
      </p>
    )
  }
  return (
    <div className="max-h-96 space-y-2 overflow-y-auto">
      {open.map((r) => (
        <div
          key={r.id}
          className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2"
        >
          <div className="min-w-0">
            <p className="truncate font-medium text-slate-800">
              {r.name || 'Ruta sin nombre'}
            </p>
            <p className="truncate text-sm text-slate-500">
              📅 {formatDateShort(r.route_date)} · 🚚{' '}
              {r.driverName || 'Sin repartidor'} · {r.stopCount}{' '}
              {r.stopCount === 1 ? 'parada' : 'paradas'}
            </p>
          </div>
          <Button
            variant="secondary"
            onClick={() => onAdd(r.id)}
            disabled={isPending}
          >
            Agregar
          </Button>
        </div>
      ))}
    </div>
  )
}
