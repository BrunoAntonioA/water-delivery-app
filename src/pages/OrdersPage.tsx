import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { createOrder, deleteOrder, listOrders, type OrderItemInput } from '../api/orders'
import { listClients } from '../api/clients'
import { listProducts } from '../api/products'
import type { OrderDetail, OrderStatus } from '../types/db'
import { formatDate, formatMoney, toLocalDateStr } from '../lib/format'
import { useIsMobile } from '../lib/useIsMobile'
import { ClientCombobox } from '../components/ClientCombobox'
import { Modal } from '../components/Modal'
import { OrderActions } from '../components/OrderActions'
import { PAYMENT_LABELS, StatusBadge } from '../components/StatusBadge'
import {
  Button,
  Card,
  CopyButton,
  EmptyState,
  Label,
  MapButton,
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

// 'unpaid' agrupa los que aún deben pagar (pedido o entregado).
type StatusFilter = 'all' | 'unpaid' | OrderStatus

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'unpaid', label: 'Pendientes de pago' },
  { value: 'ordered', label: 'Pedido' },
  { value: 'delivered', label: 'Entregado' },
  { value: 'paid', label: 'Pagado' },
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

  const [modalOpen, setModalOpen] = useState(false)
  const [clientId, setClientId] = useState('')
  const [addressId, setAddressId] = useState('')
  const [notes, setNotes] = useState('')
  const [items, setItems] = useState<DraftItem[]>([])

  const [dateFilter, setDateFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [page, setPage] = useState(1)

  const invalidate = () => qc.invalidateQueries({ queryKey: ['orders'] })

  const filteredOrders = useMemo(() => {
    return (orders ?? []).filter((o) => {
      if (dateFilter && toLocalDateStr(o.created_at) !== dateFilter) return false
      if (statusFilter === 'all') return true
      if (statusFilter === 'unpaid') return o.status !== 'paid'
      return o.status === statusFilter
    })
  }, [orders, dateFilter, statusFilter])

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

  const createMutation = useMutation({
    mutationFn: () => {
      const payload: OrderItemInput[] = items
        .filter((it) => it.product_id && it.quantity > 0)
        .map((it) => ({
          product_id: it.product_id,
          quantity: it.quantity,
          unit_price: productMap.get(it.product_id) ?? 0,
        }))
      return createOrder({
        client_id: clientId,
        address_id: addressId || null,
        notes,
        items: payload,
      })
    },
    onSuccess: () => {
      invalidate()
      setModalOpen(false)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteOrder(id),
    onSuccess: invalidate,
  })

  function openNew() {
    setClientId('')
    setAddressId('')
    setNotes('')
    setItems([{ product_id: '', quantity: 1 }])
    setModalOpen(true)
  }

  function updateItem(i: number, patch: Partial<DraftItem>) {
    setItems((list) =>
      list.map((it, idx) => (idx === i ? { ...it, ...patch } : it))
    )
  }

  const validItems = items.filter((it) => it.product_id && it.quantity > 0)
  const canSave = clientId && validItems.length > 0

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
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <TextInput
            type="date"
            value={dateFilter}
            onChange={(e) => {
              setDateFilter(e.target.value)
              setPage(1)
            }}
            className="w-full sm:w-auto"
          />
          <div className="flex flex-wrap gap-1">
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
          {dateFilter && (
            <Button
              variant="ghost"
              onClick={() => {
                setDateFilter('')
                setPage(1)
              }}
            >
              Limpiar fecha
            </Button>
          )}
          <span className="ml-auto text-sm text-slate-400">
            {filteredOrders.length}{' '}
            {filteredOrders.length === 1 ? 'pedido' : 'pedidos'}
          </span>
        </div>
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
                        {o.client
                          ? `${o.client.name} ${o.client.surname}`
                          : 'Cliente eliminado'}
                      </span>
                      <StatusBadge status={o.status} />
                    </div>
                    <p className="text-xs text-slate-400">
                      {formatDate(o.created_at)}
                    </p>
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

                  {/* Eliminar (arriba a la derecha, como en las rutas) */}
                  <button
                    type="button"
                    onClick={() => {
                      if (confirm('¿Eliminar este pedido?'))
                        deleteMutation.mutate(o.id)
                    }}
                    aria-label="Eliminar pedido"
                    className="shrink-0 rounded-lg px-2 py-1 text-slate-400 hover:bg-slate-100 hover:text-red-600"
                  >
                    ✕
                  </button>
                </div>

                <div className="mt-2 border-t border-slate-100 pt-2">
                  <p className="font-bold text-slate-900">
                    Total: {formatMoney(o.total)}
                  </p>
                  {o.status === 'paid' && o.payment_method && (
                    <p className="mt-1 text-sm text-emerald-700">
                      ✓ Pagado con {PAYMENT_LABELS[o.payment_method]}
                      {o.paid_amount != null
                        ? ` — ${formatMoney(o.paid_amount)}`
                        : ''}
                    </p>
                  )}
                  <OrderActions
                    order={o}
                    onChanged={invalidate}
                    className="mt-2 flex flex-wrap items-center gap-2"
                  />
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
                  <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase text-slate-500">
                    <th className="px-3 py-2">Cliente</th>
                    <th className="px-3 py-2">Dirección</th>
                    <th className="px-3 py-2">Teléfono</th>
                    <th className="px-3 py-2 text-right">Total</th>
                    <th className="px-3 py-2">Estado</th>
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
                      onDelete={() => {
                        if (confirm('¿Eliminar este pedido?'))
                          deleteMutation.mutate(o.id)
                      }}
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

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Nuevo pedido"
        wide
      >
        <form
          onSubmit={(e) => {
            e.preventDefault()
            createMutation.mutate()
          }}
          className="space-y-4"
        >
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
                        <TextInput
                          type="number"
                          min="1"
                          inputMode="numeric"
                          value={it.quantity}
                          onChange={(e) =>
                            updateItem(i, {
                              quantity: Math.max(1, Number(e.target.value) || 1),
                            })
                          }
                          className="w-20 bg-white text-center"
                        />
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

          <div className="flex items-center justify-between border-t border-slate-100 pt-3">
            <span className="text-sm text-slate-500">Total del pedido</span>
            <span className="text-xl font-bold text-slate-900">
              {formatMoney(draftTotal)}
            </span>
          </div>

          {createMutation.isError && (
            <p className="text-sm text-red-600">
              Error al crear: {(createMutation.error as Error).message}
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
            <Button
              type="submit"
              disabled={!canSave || createMutation.isPending}
            >
              {createMutation.isPending ? 'Creando…' : 'Crear pedido'}
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
  onDelete,
}: {
  o: OrderDetail
  onChanged: () => void
  onDelete: () => void
}) {
  const clientName = o.client
    ? `${o.client.name} ${o.client.surname}`
    : 'Cliente eliminado'
  const addressFull = o.address
    ? [o.address.address, o.address.comuna].filter(Boolean).join(', ')
    : ''
  return (
    <tr className="border-b border-slate-100 last:border-0 [&>td]:align-middle">
      <td className="px-3 py-2 font-medium text-slate-800">{clientName}</td>
      <td className="px-3 py-2 text-slate-600">
        {o.address ? (
          <div className="flex items-center gap-1">
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
          <div className="flex items-center gap-1">
            <span>{o.client.phone}</span>
            <CopyButton value={o.client.phone} label="Copiar teléfono" />
          </div>
        ) : (
          '—'
        )}
      </td>
      <td className="px-3 py-2 text-right font-medium text-slate-800">
        {formatMoney(o.total)}
      </td>
      <td className="px-3 py-2">
        <StatusBadge status={o.status} />
      </td>
      <td className="px-3 py-2">
        <OrderActions
          order={o}
          onChanged={onChanged}
          className="flex items-center gap-1"
        />
      </td>
      <td className="px-2 py-2 text-center">
        <button
          type="button"
          onClick={onDelete}
          aria-label="Eliminar pedido"
          className="rounded-lg px-2 py-1 text-slate-400 hover:bg-slate-100 hover:text-red-600"
        >
          ✕
        </button>
      </td>
    </tr>
  )
}
