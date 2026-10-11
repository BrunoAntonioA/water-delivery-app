import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import {
  createOrder,
  deleteOrder,
  listOrdersPage,
  updateOrder,
  type OrderItemInput,
} from '../api/orders'
import { listClients } from '../api/clients'
import { listProducts } from '../api/products'
import {
  listPrepaymentUsage,
  listPrepayments,
  prepaymentLines,
  type PrepaymentLine,
} from '../api/prepayments'
import { listSupplies } from '../api/supplies'
import {
  addOrderToRoute,
  createRoute,
  driverLabel,
  listDrivers,
  listOpenRoutes,
  type Driver,
  type OpenRouteOption,
  type RouteInput,
} from '../api/routes'
import type {
  OrderDetail,
  OrderStatus,
  PaymentMethod,
  PaymentPeriod,
} from '../types/db'
import { PAYMENT_PERIOD_LABELS } from '../types/db'
import {
  formatDate,
  formatDatePart,
  formatDateShort,
  formatMoney,
  formatTimePart,
} from '../lib/format'
import { useIsMobile } from '../lib/useIsMobile'
import { useOnlineStatus } from '../lib/useOnlineStatus'
import { useOrderFilters } from '../lib/useOrderFilters'
import { useScrollRestoration } from '../lib/useScrollRestoration'
import { invalidateOrdersAndRoutes } from '../lib/queryInvalidation'
import {
  isFullyPrepaid,
  orderClientName,
  orderPaymentList,
  returnedSuppliesText,
} from '../lib/order'
import { OrderItemsList, PrepaidBadge } from '../components/OrderItems'
import { NoteButton, NoteInline } from '../components/NoteButton'
import { ClientCombobox } from '../components/ClientCombobox'
import { QuickClientForm } from '../components/QuickClientForm'
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
  // Línea que sale de un prepago: vale $0 y descuenta del saldo del cliente.
  prepayment_id?: string
}

// Clave de un saldo: prepago + producto.
const ppKey = (prepaymentId: string, productId: string) =>
  `${prepaymentId}|${productId}`

const PAGE_SIZE = 10

// Fecha de hoy en formato YYYY-MM-DD (para el valor por defecto al crear ruta).
function today(): string {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

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
  const offline = !useOnlineStatus()

  const { data: clients } = useQuery({
    queryKey: ['clients'],
    queryFn: listClients,
  })
  const { data: products } = useQuery({
    queryKey: ['products'],
    queryFn: listProducts,
  })
  const { data: supplies } = useQuery({
    queryKey: ['supplies'],
    queryFn: listSupplies,
  })
  const supplyName = useMemo(() => {
    const m = new Map<string, string>()
    supplies?.forEach((s) => m.set(s.id, s.name))
    return m
  }, [supplies])

  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [clientId, setClientId] = useState('')
  const [addressId, setAddressId] = useState('')
  const [notes, setNotes] = useState('')
  const [items, setItems] = useState<DraftItem[]>([])
  // Al editar: lo que este pedido YA tenía reservado de cada prepago (el saldo
  // del servidor lo cuenta como usado, así que se suma de vuelta).
  const [originalPrepaid, setOriginalPrepaid] = useState<Map<string, number>>(
    () => new Map()
  )
  // Pago al crear/editar el pedido.
  const [formPaid, setFormPaid] = useState(false)
  const [formMethod, setFormMethod] = useState<PaymentMethod | ''>('')

  // Registro rápido de cliente dentro del formulario de pedido.
  // Lo escrito en el buscador al elegir "Registrar cliente nuevo"; null = cerrado.
  const [newClientQuery, setNewClientQuery] = useState<string | null>(null)

  // Filtros y página guardados en la URL (sobreviven a la recarga que hace el
  // teléfono al volver desde WhatsApp). Ver useOrderFilters.
  const { filters, setFilters, reset: clearFilters, hasFilters } =
    useOrderFilters()

  // Búsqueda con "debounce": se consulta 300 ms después de dejar de escribir,
  // para no lanzar una petición por cada tecla. El texto en sí vive en la URL
  // (filters.q); esto sólo retrasa el disparo de la consulta.
  const [searchQuery, setSearchQuery] = useState(filters.q)
  useEffect(() => {
    const id = setTimeout(() => setSearchQuery(filters.q.trim()), 300)
    return () => clearTimeout(id)
  }, [filters.q])

  // Marca obsoletas las vistas de pedidos Y de rutas (un pedido puede estar en
  // una ruta): así lo que cambias en Pedidos se refleja al abrir la Ruta.
  const invalidate = () => invalidateOrdersAndRoutes(qc)

  // Clave de la página actual de pedidos (incluye todos los filtros). Se reutiliza
  // para actualizar la caché al vuelo al crear un pedido (aparece al instante).
  const ordersPageKey = [
    'orders',
    'page',
    {
      q: searchQuery,
      client: filters.clientId,
      from: filters.from,
      to: filters.to,
      status: filters.status,
      paid: filters.paid,
      method: filters.method,
      period: filters.period,
      page: filters.page,
    },
  ]

  // Pedidos filtrados y paginados EN EL SERVIDOR (ver listOrdersPage). La clave
  // comparte el prefijo ['orders'] con reportes/entregas, así invalidate() cubre todo.
  const { data: ordersPage, isLoading, error: ordersError } = useQuery({
    queryKey: ordersPageKey,
    queryFn: () =>
      listOrdersPage({
        query: searchQuery || undefined,
        clientId: filters.clientId || undefined,
        from: filters.from || undefined,
        to: filters.to || undefined,
        status: filters.status === 'all' ? undefined : filters.status,
        paid: filters.paid === 'all' ? undefined : filters.paid === 'paid',
        method: filters.method === 'all' ? undefined : filters.method,
        period:
          filters.period === 'all'
            ? undefined
            : filters.period === 'none'
              ? '__none__'
              : filters.period,
        limit: PAGE_SIZE,
        offset: (filters.page - 1) * PAGE_SIZE,
      }),
    placeholderData: keepPreviousData,
  })
  const pageItems = ordersPage?.rows ?? []
  const total = ordersPage?.total ?? 0

  // Al volver desde WhatsApp (recarga en móvil), vuelve a la misma altura de scroll
  // una vez que la lista ya está pintada.
  useScrollRestoration('pedidos', !isLoading && pageItems.length > 0)

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const currentPage = Math.min(filters.page, pageCount)

  // Si tras borrar/cambiar filtros la página queda vacía sin ser la primera,
  // vuelve a la primera (evita quedar en una página que ya no existe).
  useEffect(() => {
    if (!isLoading && filters.page > 1 && pageItems.length === 0)
      setFilters({ page: 1 })
  }, [isLoading, filters.page, pageItems.length, setFilters])

  const selectedClient = useMemo(
    () => clients?.find((c) => c.id === clientId),
    [clients, clientId]
  )

  const productMap = useMemo(() => {
    const m = new Map<string, number>()
    products?.forEach((p) => m.set(p.id, p.price))
    return m
  }, [products])

  // Las líneas de prepago valen $0: sólo se cobra lo nuevo.
  const draftTotal = useMemo(
    () =>
      items.reduce(
        (sum, it) =>
          it.prepayment_id
            ? sum
            : sum + it.quantity * (productMap.get(it.product_id) ?? 0),
        0
      ),
    [items, productMap]
  )

  // Prepagos: se cargan sólo con el formulario abierto (ahorro de egress).
  const { data: prepayments } = useQuery({
    queryKey: ['prepayments'],
    queryFn: listPrepayments,
    enabled: modalOpen,
  })
  const { data: prepaymentUsage } = useQuery({
    queryKey: ['prepayment-usage'],
    queryFn: listPrepaymentUsage,
    enabled: modalOpen,
  })

  // Saldo prepagado del cliente elegido, por prepago y producto. Al editar, se
  // suma lo que este mismo pedido ya tenía reservado.
  const clientPrepaidLines = useMemo((): PrepaymentLine[] => {
    if (!clientId || !prepayments) return []
    return prepayments
      .filter((p) => p.client_id === clientId && !p.refunded_at)
      .flatMap((p) => prepaymentLines(p, prepaymentUsage ?? []))
      .map((l) => ({
        ...l,
        available:
          l.available +
          (originalPrepaid.get(ppKey(l.prepayment_id, l.product_id)) ?? 0),
      }))
      .filter((l) => l.available > 0)
  }, [clientId, prepayments, prepaymentUsage, originalPrepaid])

  const paidDateOf = useMemo(() => {
    const m = new Map<string, string>()
    prepayments?.forEach((p) => m.set(p.id, p.paid_at))
    return m
  }, [prepayments])

  /** Cuánto del saldo (prepago + producto) ya usa el borrador. */
  function draftPrepaidUsed(
    prepaymentId: string,
    productId: string,
    exceptIndex = -1
  ): number {
    return items.reduce(
      (s, it, i) =>
        i !== exceptIndex &&
        it.prepayment_id === prepaymentId &&
        it.product_id === productId
          ? s + it.quantity
          : s,
      0
    )
  }

  function prepaidLineFor(it: DraftItem): PrepaymentLine | undefined {
    return clientPrepaidLines.find(
      (l) =>
        l.prepayment_id === it.prepayment_id && l.product_id === it.product_id
    )
  }

  /** Agrega 1 unidad del prepago al pedido (o suma a su línea si ya está). */
  function addPrepaidItem(l: PrepaymentLine) {
    setItems((list) => {
      const idx = list.findIndex(
        (it) =>
          it.prepayment_id === l.prepayment_id && it.product_id === l.product_id
      )
      if (idx >= 0) {
        return list.map((it, i) =>
          i === idx ? { ...it, quantity: it.quantity + 1 } : it
        )
      }
      // Reemplaza la fila vacía inicial, si quedó sin producto.
      return [
        ...list.filter((it) => it.product_id),
        { product_id: l.product_id, quantity: 1, prepayment_id: l.prepayment_id },
      ]
    })
  }

  const hasPrepaidDraft = items.some((it) => it.product_id && it.prepayment_id)
  // Todo el pedido sale de prepagos: no hay nada que cobrar.
  const fullyPrepaidDraft =
    hasPrepaidDraft &&
    items.filter((it) => it.product_id).every((it) => it.prepayment_id)
  // Alguna línea de prepago pide más de lo disponible (lo valida también la BD).
  const prepaidOverBalance = items.some((it, i) => {
    if (!it.prepayment_id) return false
    const line = prepaidLineFor(it)
    if (!line) return Boolean(prepayments) // datos cargados y ya sin saldo
    return draftPrepaidUsed(it.prepayment_id, it.product_id, i) + it.quantity >
      line.available
  })

  const saveMutation = useMutation({
    mutationFn: async (): Promise<string | null> => {
      const payload: OrderItemInput[] = items
        .filter((it) => it.product_id && it.quantity > 0)
        .map((it) =>
          it.prepayment_id
            ? {
                product_id: it.product_id,
                quantity: it.quantity,
                unit_price: 0,
                prepayment_id: it.prepayment_id,
              }
            : {
                product_id: it.product_id,
                quantity: it.quantity,
                unit_price: productMap.get(it.product_id) ?? 0,
              }
        )
      // 100% prepagado: no se registra pago (la BD lo deja pagado sola).
      const payNow = formPaid && !fullyPrepaidDraft
      const input = {
        client_id: clientId,
        address_id: addressId || null,
        notes,
        items: payload,
        paid: payNow,
        payment_method: payNow ? (formMethod as PaymentMethod) : null,
      }
      if (editingId) {
        await updateOrder(editingId, input)
        return null
      }
      return await createOrder(input)
    },
    onSuccess: (newId) => {
      // Inserción OPTIMISTA al crear: si el pedido nuevo pertenece sin ambigüedad
      // al inicio de la vista actual (página 1, sin filtros), lo insertamos en la
      // caché al instante y NO refetcheamos la lista (misma o menos egress). El
      // resto de vistas se marca obsoleto para refrescarse al entrar.
      if (newId && filters.page === 1 && !hasFilters && selectedClient) {
        const vItems = items.filter((it) => it.product_id && it.quantity > 0)
        const unitPrice = (it: DraftItem) =>
          it.prepayment_id ? 0 : productMap.get(it.product_id) ?? 0
        const total = vItems.reduce((s, it) => s + it.quantity * unitPrice(it), 0)
        const payNow = formPaid && !fullyPrepaidDraft
        const paid = payNow || fullyPrepaidDraft
        const optimistic: OrderDetail = {
          id: newId,
          client_id: clientId,
          customer_name: null,
          address_id: addressId || null,
          status: 'ordered',
          paid,
          total,
          payment_method: payNow ? (formMethod as PaymentMethod) : null,
          paid_amount: paid ? total : null,
          payments:
            payNow && formMethod
              ? [{ method: formMethod as PaymentMethod, amount: total }]
              : null,
          returned_bidones: null,
          returned_supplies: null,
          delivered_at: null,
          notes: notes || null,
          created_at: new Date().toISOString(),
          client: selectedClient,
          address:
            selectedClient.addresses.find((a) => a.id === addressId) ?? null,
          items: vItems.map((it, i) => ({
            id: `tmp-${i}`,
            order_id: newId,
            product_id: it.product_id,
            quantity: it.quantity,
            unit_price: unitPrice(it),
            prepayment_id: it.prepayment_id ?? null,
            product: products?.find((p) => p.id === it.product_id) ?? null,
          })),
          driverId: null,
          driverName: null,
          routeDate: null,
        }
        qc.setQueryData(ordersPageKey, (old: unknown) => {
          const data = old as { rows: OrderDetail[]; total: number } | undefined
          if (!data?.rows) return old
          return {
            rows: [optimistic, ...data.rows].slice(0, PAGE_SIZE),
            total: data.total + 1,
          }
        })
        // Marca obsoletas las demás vistas SIN re-pedir la lista activa.
        qc.invalidateQueries({ queryKey: ['orders'], refetchType: 'none' })
        qc.invalidateQueries({ queryKey: ['assignable-orders'] })
        qc.invalidateQueries({ queryKey: ['prepayment-usage'] })
      } else {
        invalidate()
      }
      setEditingId(null)
      // Creado: se queda en Pedidos (aunque se haya abierto desde Prepagos),
      // para ver el pedido recién creado en la lista.
      setReturnToPrepayments(false)
      setModalOpen(false)
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

  // Rutas abiertas para el selector: se cargan SÓLO al abrir el modal (ahorro de
  // egress; antes se traían todas las rutas + paradas en cada visita a Pedidos).
  const { data: openRoutes } = useQuery({
    queryKey: ['open-routes'],
    queryFn: listOpenRoutes,
    enabled: assignTarget != null,
  })

  // Repartidores para el formulario de "crear ruta" dentro del modal.
  const { data: drivers } = useQuery({
    queryKey: ['drivers'],
    queryFn: listDrivers,
    enabled: assignTarget != null,
  })

  const addToRouteMutation = useMutation({
    mutationFn: ({ orderId, routeId }: { orderId: string; routeId: string }) =>
      addOrderToRoute(routeId, orderId),
    onSuccess: () => {
      invalidate()
      setAssignTarget(null)
    },
  })

  // Crea una ruta nueva y, en el acto, le agrega el pedido seleccionado.
  const createRouteAndAddMutation = useMutation({
    mutationFn: async ({
      orderId,
      input,
    }: {
      orderId: string
      input: RouteInput
    }) => {
      const routeId = await createRoute(input)
      await addOrderToRoute(routeId, orderId)
    },
    onSuccess: () => {
      invalidate()
      setAssignTarget(null)
    },
  })

  function openNew() {
    setEditingId(null)
    setClientId('')
    setAddressId('')
    setNotes('')
    setItems([{ product_id: '', quantity: 1 }])
    setOriginalPrepaid(new Map())
    setFormPaid(false)
    setFormMethod('')
    setNewClientQuery(null)
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
            ...(it.prepayment_id ? { prepayment_id: it.prepayment_id } : {}),
          }))
        : [{ product_id: '', quantity: 1 }]
    )
    const reserved = new Map<string, number>()
    for (const it of o.items) {
      if (!it.prepayment_id) continue
      const k = ppKey(it.prepayment_id, it.product_id)
      reserved.set(k, (reserved.get(k) ?? 0) + it.quantity)
    }
    setOriginalPrepaid(reserved)
    // Un pedido 100% prepagado queda "pagado" solo: no es un pago a registrar.
    setFormPaid(o.paid && !isFullyPrepaid(o))
    setFormMethod(o.payment_method ?? '')
    setNewClientQuery(null)
    setModalOpen(true)
  }

  // Sólo se pueden editar pedidos aún en estado "Pedido" y con cliente
  // registrado (las ventas rápidas se manejan desde la ruta).
  const canEditOrder = (o: OrderDetail) =>
    o.status === 'ordered' && Boolean(o.client_id)

  /** Elige el cliente del pedido (existente o recién creado). */
  function selectClient(id: string, newAddressId = '') {
    setClientId(id)
    setAddressId(newAddressId)
    // Las líneas de prepago son del cliente anterior.
    setItems((l) => {
      const kept = l.filter((it) => !it.prepayment_id)
      return kept.length ? kept : [{ product_id: '', quantity: 1 }]
    })
  }

  function updateItem(i: number, patch: Partial<DraftItem>) {
    setItems((list) =>
      list.map((it, idx) => (idx === i ? { ...it, ...patch } : it))
    )
  }

  const validItems = items.filter((it) => it.product_id && it.quantity > 0)
  const canSave =
    clientId &&
    validItems.length > 0 &&
    !prepaidOverBalance &&
    (fullyPrepaidDraft || !formPaid || formMethod)

  // Desde Prepagos → "Crear entrega": se abre el formulario con el cliente ya
  // elegido (su prepago aparece solo). Al crear se queda en Pedidos; al
  // cancelar vuelve a Prepagos.
  const location = useLocation()
  const navigate = useNavigate()
  const [returnToPrepayments, setReturnToPrepayments] = useState(false)
  const prefillAddress = useRef(false)
  useEffect(() => {
    const cid = (location.state as { prepaidOrderClientId?: string } | null)
      ?.prepaidOrderClientId
    if (!cid) return
    openNew()
    setClientId(cid)
    setReturnToPrepayments(true)
    prefillAddress.current = true
    // Limpia el estado para que no se reabra al recargar o volver atrás.
    navigate(location.pathname + location.search, { replace: true, state: null })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state])
  // Si el cliente tiene una sola dirección, se deja elegida (una vez).
  useEffect(() => {
    if (!prefillAddress.current || !selectedClient) return
    prefillAddress.current = false
    if (selectedClient.addresses.length === 1) {
      setAddressId(selectedClient.addresses[0].id)
    }
  }, [selectedClient])

  function closeForm() {
    setModalOpen(false)
    if (returnToPrepayments) {
      setReturnToPrepayments(false)
      navigate('/pedidos/prepagos')
    }
  }

  return (
    <div>
      <PageHeader
        title="Pedidos"
        subtitle="Crea pedidos, avanza su estado y cobra por WhatsApp."
        action={
          <div className="flex flex-wrap gap-2">
            <Link to="/pedidos/prepagos">
              <Button variant="secondary">💳 Prepagos</Button>
            </Link>
            <Button
              onClick={openNew}
              disabled={!products?.length || offline}
              title={offline ? 'Sin conexión: no puedes crear pedidos ahora' : undefined}
            >
              + Nuevo pedido
            </Button>
          </div>
        }
      />

      {!products?.length && (
        <p className="mb-4 rounded-lg bg-amber-50 px-4 py-2 text-sm text-amber-800">
          Necesitas al menos un producto para crear pedidos. El cliente lo puedes
          crear al momento.
        </p>
      )}

      {ordersError && (
        <p className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">
          No se pudieron cargar los pedidos: {(ordersError as Error).message}
        </p>
      )}

      {(total > 0 || hasFilters) && (
        <>
          <Card className="mb-4 p-4">
            <div className="mb-4">
              <Label>Buscar por nombre</Label>
              <TextInput
                value={filters.q}
                onChange={(e) => {
                  setFilters({ q: e.target.value, page: 1 })
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
                  value={filters.clientId}
                  onChange={(cid) => {
                    setFilters({ clientId: cid, page: 1 })
                  }}
                />
              </div>
              <DateRangeFilter
                from={filters.from}
                to={filters.to}
                onChange={(f, t) => {
                  setFilters({ from: f, to: t, page: 1 })
                }}
                label="Fecha de creación"
              />
              <div>
                <Label>Período de cobro</Label>
                <select
                  value={filters.period}
                  onChange={(e) => {
                    setFilters({
                      period: e.target.value as 'all' | 'none' | PaymentPeriod,
                      page: 1,
                    })
                  }}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
                >
                  <option value="all">Todos</option>
                  <option value="none">Sin período (cobro al momento)</option>
                  {(
                    Object.keys(PAYMENT_PERIOD_LABELS) as PaymentPeriod[]
                  ).map((p) => (
                    <option key={p} value={p}>
                      {PAYMENT_PERIOD_LABELS[p]}
                    </option>
                  ))}
                </select>
              </div>
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
                        setFilters({ status: f.value, page: 1 })
                      }}
                      className={`rounded-full px-3 py-1 text-sm font-medium transition-colors ${
                        filters.status === f.value
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
                        setFilters({ paid: f.value, page: 1 })
                      }}
                      className={`rounded-full px-3 py-1 text-sm font-medium transition-colors ${
                        filters.paid === f.value
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
                        setFilters({ method: f.value, page: 1 })
                      }}
                      className={`rounded-full px-3 py-1 text-sm font-medium transition-colors ${
                        filters.method === f.value
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
            {total} {total === 1 ? 'pedido' : 'pedidos'}
          </div>
        </>
      )}

      {isLoading ? (
        <Spinner />
      ) : total === 0 && !hasFilters ? (
        <EmptyState>Aún no hay pedidos.</EmptyState>
      ) : total === 0 ? (
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
                        <li key={it.id} className="flex items-center gap-1.5">
                          <span>
                            {it.quantity} × {it.product?.name ?? 'Producto'}
                            {!it.prepayment_id &&
                              ` — ${formatMoney(it.quantity * it.unit_price)}`}
                          </span>
                          {it.prepayment_id && <PrepaidBadge />}
                        </li>
                      ))}
                    </ul>
                    {o.address && (
                      <div className="mt-1 flex items-start gap-2 text-sm text-slate-500">
                        <span className="min-w-0 flex-1 break-words">
                          📍 {o.address.address}
                          {o.address.comuna ? `, ${o.address.comuna}` : ''}
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
                    <NoteInline
                      note={o.notes}
                      observation={o.address?.observation}
                      className="mt-2"
                    />
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
                  {o.status !== 'ordered' &&
                    returnedSuppliesText(o, supplyName) !== '—' && (
                      <p className="mt-1 text-sm text-slate-600">
                        ↩ Devuelto: {returnedSuppliesText(o, supplyName)}
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
            onPage={(p) => setFilters({ page: p })}
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
                      supplyName={supplyName}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          <Pagination
            page={currentPage}
            pageCount={pageCount}
            onPage={(p) => setFilters({ page: p })}
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
        {(addToRouteMutation.isError || createRouteAndAddMutation.isError) && (
          <p className="mb-3 text-sm text-red-600">
            Error:{' '}
            {
              (
                (addToRouteMutation.error ??
                  createRouteAndAddMutation.error) as Error
              ).message
            }
          </p>
        )}
        <AddToRouteList
          routes={openRoutes ?? []}
          drivers={drivers ?? []}
          onAdd={(routeId) =>
            assignTarget &&
            addToRouteMutation.mutate({ orderId: assignTarget.id, routeId })
          }
          onCreate={(input) =>
            assignTarget &&
            createRouteAndAddMutation.mutate({ orderId: assignTarget.id, input })
          }
          isPending={addToRouteMutation.isPending}
          isCreating={createRouteAndAddMutation.isPending}
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
        onClose={closeForm}
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
          {newClientQuery !== null ? (
            <QuickClientForm
              initialQuery={newClientQuery}
              onCreated={({ id, addressId: newAddressId }) => {
                selectClient(id, newAddressId ?? '')
                setNewClientQuery(null)
              }}
              onCancel={() => setNewClientQuery(null)}
            />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label>Cliente *</Label>
                <ClientCombobox
                  clients={clients ?? []}
                  value={clientId}
                  onChange={(id) => selectClient(id)}
                  onCreateNew={(q) => setNewClientQuery(q)}
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
            {/* Saldo prepagado del cliente: se agrega al pedido sin cobrarse. */}
            {clientPrepaidLines.length > 0 && (
              <div className="mb-3 rounded-xl border border-violet-200 bg-violet-50/60 p-3">
                <p className="mb-2 text-sm font-medium text-violet-900">
                  💳 Prepago disponible
                </p>
                <div className="space-y-1.5">
                  {clientPrepaidLines.map((l) => {
                    const left =
                      l.available - draftPrepaidUsed(l.prepayment_id, l.product_id)
                    const paidAt = paidDateOf.get(l.prepayment_id)
                    return (
                      <div
                        key={ppKey(l.prepayment_id, l.product_id)}
                        className="flex items-center justify-between gap-3 text-sm"
                      >
                        <span className="min-w-0 text-slate-700">
                          <span className="font-medium">{l.productName}</span>{' '}
                          <span className="text-slate-500">
                            · quedan {left}
                            {paidAt ? ` · pagado ${formatDatePart(paidAt)}` : ''}
                          </span>
                        </span>
                        <button
                          type="button"
                          onClick={() => addPrepaidItem(l)}
                          disabled={left <= 0}
                          className="shrink-0 rounded-lg border border-violet-300 bg-white px-2.5 py-1 text-sm font-medium text-violet-700 hover:bg-violet-100 disabled:opacity-40"
                        >
                          + Agregar
                        </button>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
            <div className="space-y-2">
              {items.map((it, i) => {
                const price = it.prepayment_id
                  ? 0
                  : productMap.get(it.product_id) ?? 0
                const line = it.prepayment_id ? prepaidLineFor(it) : undefined
                // Máximo de esta línea de prepago: lo disponible menos lo que
                // usan otras líneas del borrador del mismo prepago y producto.
                const maxQty =
                  it.prepayment_id && line
                    ? line.available -
                      draftPrepaidUsed(it.prepayment_id, it.product_id, i)
                    : Infinity
                return (
                  <div
                    key={i}
                    className="flex flex-col gap-2.5 rounded-xl border border-slate-200 bg-slate-50 p-3 sm:flex-row sm:items-center sm:gap-3 sm:rounded-none sm:border-0 sm:bg-transparent sm:p-0"
                  >
                    {it.prepayment_id ? (
                      // Producto fijo: sale del prepago (no se puede cambiar).
                      <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-sm">
                        <span className="truncate text-slate-800">
                          {products?.find((p) => p.id === it.product_id)
                            ?.name ?? 'Producto'}
                        </span>
                        <PrepaidBadge />
                      </div>
                    ) : (
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
                    )}

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
                              updateItem(i, {
                                quantity: Math.max(1, Math.min(n, maxQty)),
                              })
                            }
                            className="bg-white text-center"
                          />
                        </div>
                      </label>
                      <div className="flex items-center gap-1">
                        <span className="text-base font-semibold text-slate-800 sm:w-24 sm:text-right sm:text-sm sm:font-medium">
                          {it.prepayment_id ? (
                            <span className="text-violet-700">Prepagado</span>
                          ) : (
                            formatMoney(price * it.quantity)
                          )}
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
          {fullyPrepaidDraft ? (
            // Todo sale del prepago: ya está pagado y no se puede cambiar.
            <div className="rounded-lg border border-violet-200 bg-violet-50/60 p-3">
              <label className="flex cursor-not-allowed items-center gap-3">
                <input
                  type="checkbox"
                  checked
                  disabled
                  readOnly
                  className="h-4 w-4 rounded border-slate-300 text-violet-600"
                />
                <span className="text-sm font-medium text-slate-700">
                  Ya está pagado
                </span>
              </label>
              <p className="mt-1 pl-7 text-xs text-violet-800">
                Todo sale del prepago: no se cobra.
              </p>
            </div>
          ) : (
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
                {hasPrepaidDraft
                  ? 'Ya pagó lo nuevo (lo prepagado no se cobra)'
                  : 'Ya está pagado'}
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
          )}

          {prepaidOverBalance && (
            <p className="text-sm text-red-600">
              Una línea de prepago supera el saldo disponible del cliente.
            </p>
          )}

          <div className="flex items-center justify-between border-t border-slate-100 pt-3">
            <span className="text-sm text-slate-500">
              {hasPrepaidDraft ? 'Total a cobrar' : 'Total del pedido'}
            </span>
            <span className="text-xl font-bold text-slate-900">
              {formatMoney(draftTotal)}
            </span>
          </div>

          {saveMutation.isError && (
            <p className="text-sm text-red-600">
              Error al guardar: {(saveMutation.error as Error).message}
            </p>
          )}

          <div className="sticky bottom-0 -mx-5 -mb-4 mt-2 flex flex-wrap justify-end gap-2 border-t border-slate-100 bg-white px-5 py-3">
            <Button type="button" variant="secondary" onClick={closeForm}>
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={!canSave || saveMutation.isPending || offline}
            >
              {saveMutation.isPending
                ? 'Guardando…'
                : offline
                  ? 'Sin conexión'
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
  supplyName,
}: {
  o: OrderDetail
  onChanged: () => void
  onEdit?: () => void
  onDelete: () => void
  onAddToRoute: () => void
  supplyName: Map<string, string>
}) {
  const clientName = orderClientName(o)
  const addressFull = o.address
    ? [o.address.address, o.address.comuna].filter(Boolean).join(', ')
    : ''
  return (
    <tr className="border-b border-slate-100 last:border-0 [&>td]:align-middle [&>td]:text-center">
      <td className="px-3 py-2 font-medium text-slate-800">
        <div className="flex flex-col items-center gap-1">
          <span className="flex items-center gap-1">
            {clientName}
            <NoteButton note={o.notes} observation={o.address?.observation} />
          </span>
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
        {returnedSuppliesText(o, supplyName)}
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

/**
 * Contenido del modal "Agregar pedido a una ruta": lista las rutas abiertas para
 * elegir una, y permite crear una ruta nueva ahí mismo (útil cuando no hay
 * ninguna). Al crearla, el pedido se agrega automáticamente a esa ruta.
 */
function AddToRouteList({
  routes,
  drivers,
  onAdd,
  onCreate,
  isPending,
  isCreating,
}: {
  routes: OpenRouteOption[]
  drivers: Driver[]
  onAdd: (routeId: string) => void
  onCreate: (input: RouteInput) => void
  isPending: boolean
  isCreating: boolean
}) {
  const busy = isPending || isCreating
  // Si no hay rutas abiertas, el formulario aparece desplegado de una.
  const [creating, setCreating] = useState(routes.length === 0)
  const [form, setForm] = useState<RouteInput>({
    name: '',
    route_date: today(),
    driver: '',
    driver_id: null,
    notes: '',
  })

  return (
    <div className="space-y-3">
      {routes.length > 0 && (
        <div className="max-h-72 space-y-2 overflow-y-auto">
          {routes.map((r) => (
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
                  {r.driverName || 'Sin repartidor'}
                </p>
              </div>
              <Button
                variant="secondary"
                onClick={() => onAdd(r.id)}
                disabled={busy}
              >
                Agregar
              </Button>
            </div>
          ))}
        </div>
      )}

      {routes.length === 0 && !creating && (
        <p className="text-center text-sm text-slate-500">
          No hay rutas abiertas todavía.
        </p>
      )}

      {!creating ? (
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="w-full rounded-lg border border-dashed border-slate-300 py-2 text-sm font-medium text-sky-600 hover:bg-sky-50"
        >
          + Crear ruta nueva
        </button>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            onCreate(form)
          }}
          className="space-y-3 rounded-lg border border-slate-200 bg-slate-50/50 p-3"
        >
          <p className="text-sm font-semibold text-slate-700">Nueva ruta</p>
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
              {drivers.map((d) => (
                <option key={d.id} value={d.id}>
                  {driverLabel(d)}
                </option>
              ))}
            </select>
          </div>
          <div className="flex justify-end gap-2">
            {routes.length > 0 && (
              <Button
                type="button"
                variant="secondary"
                onClick={() => setCreating(false)}
                disabled={busy}
              >
                Cancelar
              </Button>
            )}
            <Button type="submit" disabled={!form.route_date || busy}>
              {isCreating ? 'Creando…' : 'Crear y agregar'}
            </Button>
          </div>
        </form>
      )}
    </div>
  )
}
