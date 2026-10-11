import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  listOrders,
  listOrdersByRouteDate,
  listUnpaidOrders,
} from '../api/orders'
import { ALL_TIME, currentMonthRange, sameRange } from '../lib/dateRange'
import { listClients } from '../api/clients'
import { listCosts } from '../api/costs'
import { listPrepayments } from '../api/prepayments'
import { listDrivers, type Driver } from '../api/routes'
import { listProducts } from '../api/products'
import { listSupplies } from '../api/supplies'
import { useAuth } from '../lib/auth'
import {
  makeReportDoc,
  addReportTable,
  saveReport,
} from '../lib/reportPdf'
import type {
  OrderDetail,
  OrderStatus,
  PaymentMethod,
  Prepayment,
  Product,
  Supply,
} from '../types/db'
import {
  formatDatePart,
  formatDateShort,
  formatMoney,
  toLocalDateStr,
} from '../lib/format'
import {
  isFullyPrepaid,
  orderClientName,
  orderPaymentList,
  paidWithMethod,
} from '../lib/order'
import { ClientCombobox } from '../components/ClientCombobox'
import {
  PAYMENT_LABELS,
  STATUS_LABELS,
  StatusBadge,
} from '../components/StatusBadge'
import { DateRangeFilter } from '../components/DateRangeFilter'
import {
  Button,
  Card,
  EmptyState,
  InfoHint,
  Label,
  Pagination,
  PageHeader,
  Spinner,
} from '../components/ui'

const PAGE_SIZE = 15

// 'prepaid' = sólo las compras de prepago (no son pedidos con entrega).
type StatusFilter = 'all' | OrderStatus | 'prepaid'

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'ordered', label: 'Sin entregar' },
  { value: 'delivered', label: 'Entregado' },
  { value: 'prepaid', label: 'Prepagos' },
]

/**
 * Fila del reporte de pedidos: un pedido, o una compra de PREPAGO (el dinero
 * entra ahí; sus entregas valen $0), para que el total refleje lo cobrado.
 */
type ReportRow =
  | { kind: 'order'; key: string; date: string; order: OrderDetail }
  | { kind: 'prepayment'; key: string; date: string; p: Prepayment }

/** Detalle de productos de un pedido; las líneas de prepago se marcan. */
const orderItemsText = (o: OrderDetail) =>
  o.items
    .map(
      (it) =>
        `${it.quantity} x ${it.product?.name ?? 'Producto'}${it.prepayment_id ? ' (prepago)' : ''}`
    )
    .join('; ')

const prepaymentItemsText = (p: Prepayment) =>
  p.items
    .map((it) => `${it.quantity} x ${it.product?.name ?? 'Producto'}`)
    .join('; ')

type PaidFilter = 'all' | 'paid' | 'unpaid'

const PAID_FILTERS: { value: PaidFilter; label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'paid', label: 'Pagado' },
  { value: 'unpaid', label: 'Pendiente' },
]


export default function OrdersReportPage() {
  const { company } = useAuth()
  const [tab, setTab] = useState<'pedidos' | 'repartidores' | 'caja'>('pedidos')
  // Pestaña Pedidos: rango por fecha de CREACIÓN. Arranca en el mes actual y se
  // filtra EN EL SERVIDOR (ahorro de egress). Cada pestaña pide sus propios
  // datos según su rango; si coinciden, comparten la misma consulta en caché.
  const [defaultRange] = useState(currentMonthRange)
  const [fromDate, setFromDate] = useState(defaultRange.from)
  const [toDate, setToDate] = useState(defaultRange.to)
  const { data: orders, isLoading } = useQuery({
    queryKey: ['orders', 'report', { from: fromDate, to: toDate }],
    queryFn: () => listOrders({ from: fromDate, to: toDate }),
    enabled: tab === 'pedidos',
    placeholderData: keepPreviousData,
  })
  const { data: clients } = useQuery({
    queryKey: ['clients'],
    queryFn: listClients,
  })
  const { data: driversList } = useQuery({
    queryKey: ['drivers'],
    queryFn: listDrivers,
  })
  const { data: products } = useQuery({
    queryKey: ['products'],
    queryFn: listProducts,
  })
  const { data: supplies } = useQuery({
    queryKey: ['supplies'],
    queryFn: listSupplies,
  })

  // Prepagos: filas del reporte de pedidos y ingresos/devoluciones del flujo de
  // caja (tabla pequeña).
  const { data: prepayments } = useQuery({
    queryKey: ['prepayments'],
    queryFn: listPrepayments,
    enabled: tab === 'caja' || tab === 'pedidos',
  })
  // Cada pestaña "registra" su exportador; el botón del encabezado ejecuta el
  // de la pestaña activa, para que el botón se vea igual en todas.
  const exporterRef = useRef<null | (() => void)>(null)
  const [childCanExport, setChildCanExport] = useState(false)
  const registerExporter = useCallback((fn: (() => void) | null) => {
    exporterRef.current = fn
    setChildCanExport(Boolean(fn))
  }, [])
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [paidFilter, setPaidFilter] = useState<PaidFilter>('all')
  const [clientId, setClientId] = useState('')
  const [paymentFilter, setPaymentFilter] = useState<'all' | PaymentMethod>(
    'all'
  )
  const [driverId, setDriverId] = useState('')
  const [page, setPage] = useState(1)

  // Repartidores presentes en los pedidos (para el filtro).
  const drivers = useMemo(() => {
    const m = new Map<string, string>()
    for (const o of orders ?? []) {
      if (o.driverId) m.set(o.driverId, o.driverName || 'Sin nombre')
    }
    return Array.from(m, ([id, name]) => ({ id, name })).sort((a, b) =>
      a.name.localeCompare(b.name)
    )
  }, [orders])

  const filtered = useMemo(() => {
    return (orders ?? []).filter((o) => {
      // Rango de fechas: 'YYYY-MM-DD' se compara lexicográficamente (= por fecha).
      const date = toLocalDateStr(o.created_at)
      if (fromDate && date < fromDate) return false
      if (toDate && date > toDate) return false
      if (clientId && o.client_id !== clientId) return false
      if (driverId && o.driverId !== driverId) return false
      if (paymentFilter !== 'all' && o.payment_method !== paymentFilter)
        return false
      if (paidFilter === 'paid' && !o.paid) return false
      if (paidFilter === 'unpaid' && o.paid) return false
      if (statusFilter !== 'all' && o.status !== statusFilter) return false
      return true
    })
  }, [
    orders,
    fromDate,
    toDate,
    statusFilter,
    paidFilter,
    clientId,
    driverId,
    paymentFilter,
  ])

  // Compras de prepago del período (por FECHA DE PAGO), con los mismos filtros
  // que aplican: no tienen repartidor ni estado de entrega y siempre están pagadas.
  const filteredPrepayments = useMemo(() => {
    if (driverId || paidFilter === 'unpaid') return []
    if (statusFilter !== 'all' && statusFilter !== 'prepaid') return []
    return (prepayments ?? []).filter((p) => {
      const date = toLocalDateStr(p.paid_at)
      if (fromDate && date < fromDate) return false
      if (toDate && date > toDate) return false
      if (clientId && p.client_id !== clientId) return false
      if (
        paymentFilter !== 'all' &&
        !p.payments.some((x) => x.method === paymentFilter)
      )
        return false
      return true
    })
  }, [
    prepayments,
    fromDate,
    toDate,
    clientId,
    driverId,
    paidFilter,
    statusFilter,
    paymentFilter,
  ])

  // Pedidos + prepagos, del más nuevo al más antiguo.
  const rows = useMemo((): ReportRow[] => {
    const list: ReportRow[] = [
      ...filtered.map((o) => ({
        kind: 'order' as const,
        key: o.id,
        date: o.created_at,
        order: o,
      })),
      ...filteredPrepayments.map((p) => ({
        kind: 'prepayment' as const,
        key: `pp-${p.id}`,
        date: p.paid_at,
        p,
      })),
    ]
    return list.sort((a, b) => b.date.localeCompare(a.date))
  }, [filtered, filteredPrepayments])

  // Total cobrado: pedidos + prepagos vigentes (un prepago anulado se devolvió).
  const totalSum = useMemo(
    () =>
      filtered.reduce((sum, o) => sum + Number(o.total), 0) +
      filteredPrepayments
        .filter((p) => !p.refunded_at)
        .reduce((sum, p) => sum + Number(p.total), 0),
    [filtered, filteredPrepayments]
  )

  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount)
  const pageItems = rows.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE
  )

  const hasFilters = Boolean(
    !sameRange({ from: fromDate, to: toDate }, defaultRange) ||
      clientId ||
      statusFilter !== 'all' ||
      paidFilter !== 'all' ||
      paymentFilter !== 'all' ||
      driverId
  )

  function clearAll() {
    setFromDate(defaultRange.from)
    setToDate(defaultRange.to)
    setStatusFilter('all')
    setPaidFilter('all')
    setClientId('')
    setPaymentFilter('all')
    setDriverId('')
    setPage(1)
  }

  function exportPdf() {
    if (rows.length === 0) return
    const counts = [`${filtered.length} pedidos`]
    if (filteredPrepayments.length > 0) {
      counts.push(`${filteredPrepayments.length} prepagos`)
    }
    const subtitle = `${counts.join(' · ')} · Total ${formatMoney(totalSum)} · Generado ${new Date().toLocaleDateString('es-CL')}`
    const r = makeReportDoc('Reporte de pedidos', company?.name, subtitle, true)
    addReportTable(
      r,
      [
        'Fecha de creación',
        'Fecha de ruta de entrega',
        'Cliente',
        'Repartidor',
        'Teléfono',
        'Dirección',
        'Detalle',
        'Total',
        'Estado',
        'Pago',
      ],
      rows.map((row) => {
        if (row.kind === 'prepayment') {
          const p = row.p
          return [
            formatDatePart(p.paid_at),
            '—',
            prepaymentClientName(p),
            '',
            p.client?.phone ?? '',
            '',
            prepaymentItemsText(p),
            p.refunded_at
              ? `${formatMoney(Number(p.total))} (devuelto)`
              : formatMoney(Number(p.total)),
            p.refunded_at ? 'Prepago anulado' : 'Prepago (compra)',
            p.payments.map((x) => PAYMENT_LABELS[x.method]).join(' + '),
          ]
        }
        const o = row.order
        const fromPrepaid = o.items.some((it) => it.prepayment_id)
        return [
          formatDatePart(o.created_at),
          o.routeDate ? formatDateShort(o.routeDate) : '—',
          orderClientName(o),
          o.driverName ?? '',
          o.client?.phone ?? '',
          o.address
            ? [o.address.address, o.address.comuna].filter(Boolean).join(', ')
            : '',
          orderItemsText(o),
          formatMoney(o.total),
          fromPrepaid
            ? `${STATUS_LABELS[o.status]} · de prepago`
            : STATUS_LABELS[o.status],
          isFullyPrepaid(o)
            ? 'Prepago'
            : o.paid
              ? orderPaymentList(o)
                  .map((p) => PAYMENT_LABELS[p.method])
                  .join(' + ')
              : '',
        ]
      })
    )
    saveReport(r, 'reporte-pedidos.pdf')
  }

  return (
    <div>
      <PageHeader
        title="Reportes"
        subtitle="Analiza tu operación desde distintos reportes."
        action={
          <Button
            variant="secondary"
            disabled={tab === 'pedidos' ? rows.length === 0 : !childCanExport}
            onClick={() => {
              if (tab === 'pedidos') exportPdf()
              else exporterRef.current?.()
            }}
          >
            ⬇ Descargar PDF
          </Button>
        }
      />

      {/* --- Pestañas de reportes --- */}
      <div className="mb-4 flex gap-1 overflow-x-auto border-b border-slate-200">
        {(
          [
            ['pedidos', 'Pedidos'],
            ['repartidores', 'Repartidores'],
            ['caja', 'Flujo de Caja'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`-mb-px whitespace-nowrap border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
              tab === key
                ? 'border-sky-600 text-sky-700'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'repartidores' && (
        <RepartidoresTab
          products={products ?? []}
          supplies={supplies ?? []}
          drivers={driversList ?? []}
          companyName={company?.name}
          registerExporter={registerExporter}
        />
      )}
      {tab === 'caja' && (
        <CashFlowTab
          prepayments={prepayments ?? []}
          companyName={company?.name}
          registerExporter={registerExporter}
        />
      )}

      {tab === 'pedidos' && (
        <>
      {/* --- Filtros --- */}
      <Card className="mb-4 p-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label>Cliente</Label>
            <ClientCombobox
              clients={clients ?? []}
              value={clientId}
              onChange={(id) => {
                setClientId(id)
                setPage(1)
              }}
            />
          </div>
          <DateRangeFilter
            from={fromDate}
            to={toDate}
            onChange={(f, t) => {
              setFromDate(f)
              setToDate(t)
              setPage(1)
            }}
            label="Fecha de creación"
            presets
          />
          <div>
            <Label>Repartidor</Label>
            <select
              value={driverId}
              onChange={(e) => {
                setDriverId(e.target.value)
                setPage(1)
              }}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
            >
              <option value="">Todos los repartidores</option>
              {drivers.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
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
                      ? 'bg-sky-600 text-white'
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
            <Button variant="ghost" onClick={clearAll}>
              Limpiar filtros
            </Button>
          </div>
        )}
      </Card>

      {/* --- Resumen --- */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="text-slate-500">
          {filtered.length} {filtered.length === 1 ? 'pedido' : 'pedidos'}
          {filteredPrepayments.length > 0 &&
            ` · ${filteredPrepayments.length} ${
              filteredPrepayments.length === 1 ? 'prepago' : 'prepagos'
            }`}
        </span>
        <span className="flex items-center gap-1.5 font-semibold text-slate-900">
          Total: {formatMoney(totalSum)}
          {filteredPrepayments.length > 0 && (
            <InfoHint text="Incluye los prepagos (el dinero se cobra al comprar el prepago; sus entregas valen $0). No incluye prepagos anulados." />
          )}
        </span>
      </div>

      {isLoading ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <EmptyState>No hay pedidos con esos filtros.</EmptyState>
      ) : (
        <>
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-center text-xs uppercase text-slate-500">
                    <th className="px-3 py-2">Fecha de creación</th>
                    <th className="px-3 py-2">Fecha de ruta de entrega</th>
                    <th className="px-3 py-2">Cliente</th>
                    <th className="px-3 py-2">Repartidor</th>
                    <th className="px-3 py-2">Ítems</th>
                    <th className="px-3 py-2">Total</th>
                    <th className="px-3 py-2">Estado</th>
                    <th className="px-3 py-2">Pago</th>
                  </tr>
                </thead>
                <tbody>
                  {pageItems.map((row) => {
                    if (row.kind === 'prepayment') {
                      const p = row.p
                      return (
                        <tr
                          key={row.key}
                          className="border-b border-slate-100 bg-violet-50/40 last:border-0 [&>td]:text-center"
                        >
                          <td className="whitespace-nowrap px-3 py-2 text-slate-500">
                            {formatDatePart(p.paid_at)}
                          </td>
                          <td className="px-3 py-2 text-slate-400">—</td>
                          <td className="px-3 py-2 font-medium text-slate-800">
                            {prepaymentClientName(p)}
                          </td>
                          <td className="px-3 py-2 text-slate-400">—</td>
                          <td
                            className="px-3 py-2 text-slate-600"
                            title={prepaymentItemsText(p)}
                          >
                            {p.items.reduce((s, it) => s + it.quantity, 0)}
                          </td>
                          <td
                            className={`whitespace-nowrap px-3 py-2 font-medium ${
                              p.refunded_at
                                ? 'text-slate-400 line-through'
                                : 'text-slate-800'
                            }`}
                          >
                            {formatMoney(Number(p.total))}
                          </td>
                          <td className="px-3 py-2">
                            <span
                              className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                                p.refunded_at
                                  ? 'bg-slate-200 text-slate-600'
                                  : 'bg-violet-100 text-violet-800'
                              }`}
                              title={
                                p.refunded_at
                                  ? `Anulado: devolución el ${formatDatePart(p.refunded_at)}`
                                  : 'Compra de prepago: el dinero entra aquí; sus entregas valen $0'
                              }
                            >
                              {p.refunded_at ? 'Prepago anulado' : 'Prepago'}
                            </span>
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 text-slate-600">
                            {p.payments
                              .map((x) => PAYMENT_LABELS[x.method])
                              .join(' + ') || '—'}
                          </td>
                        </tr>
                      )
                    }
                    const o = row.order
                    const itemCount = o.items.reduce(
                      (s, it) => s + it.quantity,
                      0
                    )
                    const fromPrepaid = o.items.some((it) => it.prepayment_id)
                    return (
                      <tr
                        key={row.key}
                        className="border-b border-slate-100 last:border-0 [&>td]:text-center"
                      >
                        <td className="whitespace-nowrap px-3 py-2 text-slate-500">
                          {formatDatePart(o.created_at)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-slate-500">
                          {o.routeDate ? formatDateShort(o.routeDate) : '—'}
                        </td>
                        <td className="px-3 py-2 font-medium text-slate-800">
                          {orderClientName(o)}
                        </td>
                        <td className="px-3 py-2 text-slate-600">
                          {o.driverName ?? '—'}
                        </td>
                        <td className="px-3 py-2 text-slate-600">{itemCount}</td>
                        <td className="whitespace-nowrap px-3 py-2 font-medium text-slate-800">
                          {formatMoney(o.total)}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex flex-col items-center gap-1">
                            <StatusBadge status={o.status} />
                            {fromPrepaid && (
                              <span
                                className="rounded bg-violet-100 px-1.5 py-0.5 text-[11px] font-medium text-violet-700"
                                title="Entrega que sale de un prepago: lo prepagado no se cobra aquí"
                              >
                                De prepago
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-slate-600">
                          {isFullyPrepaid(o)
                            ? 'Prepago'
                            : o.paid
                              ? orderPaymentList(o)
                                  .map((p) => PAYMENT_LABELS[p.method])
                                  .join(' + ')
                              : '—'}
                        </td>
                      </tr>
                    )
                  })}
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
        </>
      )}
    </div>
  )
}

/** Monto de un prepago pagado con un método específico. */
function prepaidWithMethod(p: Prepayment, method: PaymentMethod): number {
  return p.payments
    .filter((x) => x.method === method)
    .reduce((s, x) => s + Number(x.amount), 0)
}

const prepaymentClientName = (p: Prepayment) =>
  p.client ? `${p.client.name} ${p.client.surname}`.trim() : 'Cliente'

// ============================================================================
//  Flujo de caja: ingresos (pedidos pagados + prepagos) vs egresos (costos +
//  devoluciones de prepagos), por fecha.
// ============================================================================
function CashFlowTab({
  prepayments,
  companyName,
  registerExporter,
}: {
  prepayments: Prepayment[]
  companyName?: string
  registerExporter: (fn: (() => void) | null) => void
}) {
  // Rango: arranca en el mes actual y se filtra EN EL SERVIDOR (ahorro de egress).
  const [defaultRange] = useState(currentMonthRange)
  const [fromDate, setFromDate] = useState(defaultRange.from)
  const [toDate, setToDate] = useState(defaultRange.to)
  const range = { from: fromDate, to: toDate }
  // Mostrar los pedidos aún NO pagados (por cobrar). Apagado por defecto.
  const [showUnpaid, setShowUnpaid] = useState(false)

  const ordersQuery = useQuery({
    queryKey: ['orders', 'report', range],
    queryFn: () => listOrders(range),
    placeholderData: keepPreviousData,
  })
  const costsQuery = useQuery({
    queryKey: ['costs', range],
    queryFn: () => listCosts(range),
    placeholderData: keepPreviousData,
  })
  // "Por cobrar" = TODAS las deudas pendientes, sin importar la fecha: las
  // deudas de meses anteriores no deben desaparecer por el rango.
  const unpaidQuery = useQuery({
    queryKey: ['orders', 'unpaid'],
    queryFn: listUnpaidOrders,
    enabled: showUnpaid,
  })
  const orders = useMemo(() => ordersQuery.data ?? [], [ordersQuery.data])
  const costs = useMemo(() => costsQuery.data ?? [], [costsQuery.data])

  const income = useMemo(() => {
    let efectivo = 0
    let transferencia = 0
    let tarjeta = 0
    let otros = 0
    for (const o of orders) {
      if (!o.paid) continue
      const date = toLocalDateStr(o.created_at)
      if (fromDate && date < fromDate) continue
      if (toDate && date > toDate) continue
      const e = paidWithMethod(o, 'efectivo')
      const t = paidWithMethod(o, 'transferencia')
      const k = paidWithMethod(o, 'tarjeta')
      efectivo += e
      transferencia += t
      tarjeta += k
      // Cualquier remanente sin método (pedidos antiguos) va a "otros".
      otros += Math.max(0, Number(o.paid_amount ?? o.total) - (e + t + k))
    }
    // Prepagos: el ingreso cuenta en su FECHA DE PAGO (aunque después se
    // anule: la devolución se registra aparte, en su propia fecha).
    for (const p of prepayments) {
      const date = toLocalDateStr(p.paid_at)
      if (fromDate && date < fromDate) continue
      if (toDate && date > toDate) continue
      const e = prepaidWithMethod(p, 'efectivo')
      const t = prepaidWithMethod(p, 'transferencia')
      const k = prepaidWithMethod(p, 'tarjeta')
      efectivo += e
      transferencia += t
      tarjeta += k
      otros += Math.max(0, Number(p.total) - (e + t + k))
    }
    return {
      efectivo,
      transferencia,
      tarjeta,
      otros,
      total: efectivo + transferencia + tarjeta + otros,
    }
  }, [orders, prepayments, fromDate, toDate])

  // Devoluciones de prepagos anulados: egreso en la FECHA DE LA DEVOLUCIÓN.
  const refunds = useMemo(() => {
    const rows: { id: string; date: string; name: string; amount: number }[] = []
    let total = 0
    for (const p of prepayments) {
      if (!p.refunded_at) continue
      const date = toLocalDateStr(p.refunded_at)
      if (fromDate && date < fromDate) continue
      if (toDate && date > toDate) continue
      const amount = Number(p.refund_amount ?? p.total)
      rows.push({ id: p.id, date, name: prepaymentClientName(p), amount })
      total += amount
    }
    return { rows, total }
  }, [prepayments, fromDate, toDate])

  const expense = useMemo(() => {
    const byCat = new Map<string, number>()
    let total = 0
    for (const c of costs) {
      if (fromDate && c.issue_date < fromDate) continue
      if (toDate && c.issue_date > toDate) continue
      const amt = Number(c.amount)
      const cat = c.category?.name ?? 'Sin categoría'
      byCat.set(cat, (byCat.get(cat) ?? 0) + amt)
      total += amt
    }
    if (refunds.total > 0) {
      byCat.set('Devoluciones de prepagos', refunds.total)
      total += refunds.total
    }
    const rows = Array.from(byCat, ([name, amount]) => ({ name, amount })).sort(
      (a, b) => b.amount - a.amount
    )
    return { rows, total }
  }, [costs, refunds, fromDate, toDate])

  const balance = income.total - expense.total

  // Pedidos aún no pagados (por cobrar): TODOS, sin importar el rango.
  const unpaid = useMemo(() => {
    const rows: { id: string; date: string; name: string; total: number }[] = []
    let total = 0
    for (const o of unpaidQuery.data ?? []) {
      if (o.paid) continue
      const date = toLocalDateStr(o.created_at)
      rows.push({
        id: o.id,
        date,
        name: orderClientName(o),
        total: Number(o.total),
      })
      total += Number(o.total)
    }
    rows.sort((a, b) => a.date.localeCompare(b.date))
    return { rows, total }
  }, [unpaidQuery.data])

  function exportPdf() {
    const periodo =
      fromDate || toDate
        ? `Período: ${fromDate || 'inicio'} a ${toDate || 'hoy'}`
        : 'Período: todo'
    const r = makeReportDoc(
      'Flujo de caja',
      companyName,
      `${periodo} · Generado ${new Date().toLocaleDateString('es-CL')}`
    )
    addReportTable(
      r,
      ['Resumen', 'Monto'],
      [
        ['Ingresos', formatMoney(income.total)],
        ['Egresos (costos)', formatMoney(expense.total)],
        ['Balance', formatMoney(balance)],
        ...(showUnpaid
          ? [['Por cobrar (todas las deudas)', formatMoney(unpaid.total)]]
          : []),
      ],
      { title: 'Resumen' }
    )
    addReportTable(
      r,
      ['Ingreso', 'Monto'],
      [
        ['Efectivo', formatMoney(income.efectivo)],
        ['Transferencia', formatMoney(income.transferencia)],
        ['Tarjeta', formatMoney(income.tarjeta)],
        ...(income.otros > 0
          ? [['Sin método', formatMoney(income.otros)]]
          : []),
      ],
      { title: 'Ingresos por método' }
    )
    addReportTable(
      r,
      ['Categoría', 'Monto'],
      expense.rows.map((x) => [x.name, formatMoney(x.amount)]),
      { title: 'Egresos por categoría' }
    )

    // Detalle de movimientos (ingresos + costos) ordenado por fecha.
    const short = (d: string) => d.split('-').reverse().join('-')
    type Mov = { date: string; tipo: string; detalle: string; monto: string }
    const movimientos: Mov[] = []
    for (const o of orders) {
      if (!o.paid) continue
      // Entregas 100% prepagadas ($0): su ingreso ya está en el prepago.
      if (Number(o.paid_amount ?? o.total) === 0) continue
      const date = toLocalDateStr(o.created_at)
      if (fromDate && date < fromDate) continue
      if (toDate && date > toDate) continue
      const metodo =
        orderPaymentList(o)
          .map((p) => PAYMENT_LABELS[p.method])
          .join(' + ') || 'Sin método'
      movimientos.push({
        date,
        tipo: 'Ingreso',
        detalle: `${orderClientName(o)} · ${metodo}`,
        monto: formatMoney(Number(o.paid_amount ?? o.total)),
      })
    }
    for (const p of prepayments) {
      const date = toLocalDateStr(p.paid_at)
      if (fromDate && date < fromDate) continue
      if (toDate && date > toDate) continue
      const metodo =
        p.payments.map((x) => PAYMENT_LABELS[x.method]).join(' + ') ||
        'Sin método'
      movimientos.push({
        date,
        tipo: 'Ingreso',
        detalle: `Prepago · ${prepaymentClientName(p)} · ${metodo}`,
        monto: formatMoney(Number(p.total)),
      })
    }
    for (const r of refunds.rows) {
      movimientos.push({
        date: r.date,
        tipo: 'Egreso',
        detalle: `Devolución prepago · ${r.name}`,
        monto: `- ${formatMoney(r.amount)}`,
      })
    }
    for (const c of costs) {
      if (fromDate && c.issue_date < fromDate) continue
      if (toDate && c.issue_date > toDate) continue
      movimientos.push({
        date: c.issue_date,
        tipo: 'Egreso',
        detalle: `${c.name} · ${c.category?.name ?? 'Sin categoría'}`,
        monto: `- ${formatMoney(Number(c.amount))}`,
      })
    }
    movimientos.sort((a, b) => a.date.localeCompare(b.date))
    addReportTable(
      r,
      ['Fecha', 'Tipo', 'Detalle', 'Monto'],
      movimientos.map((m) => [short(m.date), m.tipo, m.detalle, m.monto]),
      { title: 'Detalle por fecha' }
    )

    if (showUnpaid && unpaid.rows.length > 0) {
      addReportTable(
        r,
        ['Fecha', 'Cliente', 'Monto'],
        unpaid.rows.map((x) => [short(x.date), x.name, formatMoney(x.total)]),
        { title: 'Pedidos por cobrar (todas las deudas pendientes)' }
      )
    }

    saveReport(r, 'flujo-de-caja.pdf')
  }

  const hasData =
    income.total > 0 ||
    expense.total > 0 ||
    (showUnpaid && unpaid.total > 0)

  // Registra el exportador para el botón del encabezado.
  const exportRef = useRef(exportPdf)
  exportRef.current = exportPdf
  useEffect(() => {
    registerExporter(hasData ? () => exportRef.current() : null)
    return () => registerExporter(null)
  }, [hasData, registerExporter])

  return (
    <div>
      {/* Filtro de fechas */}
      <Card className="mb-4 p-4">
        <DateRangeFilter
          from={fromDate}
          to={toDate}
          onChange={(f, t) => {
            setFromDate(f)
            setToDate(t)
          }}
          label="Fecha"
          presets
        />
        {!sameRange(range, defaultRange) && (
          <Button
            variant="ghost"
            className="mt-2"
            onClick={() => {
              setFromDate(defaultRange.from)
              setToDate(defaultRange.to)
            }}
          >
            Volver al mes actual
          </Button>
        )}

        <label className="mt-3 flex cursor-pointer items-center gap-2 border-t border-slate-100 pt-3 text-sm text-slate-700">
          <button
            type="button"
            role="switch"
            aria-checked={showUnpaid}
            onClick={() => setShowUnpaid((v) => !v)}
            className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
              showUnpaid ? 'bg-amber-500' : 'bg-slate-300'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                showUnpaid ? 'translate-x-4' : 'translate-x-0.5'
              }`}
            />
          </button>
          <span>Mostrar pedidos por cobrar (todas las deudas, sin importar la fecha)</span>
        </label>
      </Card>

      {/* KPIs */}
      <div
        className={`mb-4 grid gap-3 sm:grid-cols-2 ${
          showUnpaid ? 'lg:grid-cols-4' : 'lg:grid-cols-3'
        }`}
      >
        <KpiCard
          label="Ingresos"
          value={income.total}
          tone="green"
          hint="Pedidos marcados como Pagado más los prepagos (en su fecha de pago), dentro del rango de fechas."
        />
        <KpiCard
          label="Egresos (costos)"
          value={expense.total}
          tone="red"
          hint="Costos de la empresa más las devoluciones de prepagos anulados (en su fecha de devolución), dentro del rango de fechas."
        />
        <KpiCard
          label="Balance"
          value={balance}
          tone={balance >= 0 ? 'green' : 'red'}
          hint="Ingresos menos egresos. Positivo = ganancia; negativo = pérdida en el período."
        />
        {showUnpaid && (
          <KpiCard
            label="Por cobrar"
            value={unpaid.total}
            tone="amber"
            hint="Total de TODOS los pedidos aún NO pagados, de cualquier fecha (las deudas antiguas no se esconden por el rango). No entra en el balance (todavía no es dinero recibido)."
          />
        )}
      </div>

      {/* Detalle */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <h3 className="mb-3 flex items-center gap-2 font-semibold text-slate-900">
            <span aria-hidden>💵</span> Ingresos
          </h3>
          {income.total === 0 ? (
            <p className="text-sm text-slate-500">
              Sin ingresos en el período.
            </p>
          ) : (
            <div className="space-y-3">
              <BreakdownRow
                label="Efectivo"
                amount={income.efectivo}
                total={income.total}
                color="bg-emerald-500"
              />
              <BreakdownRow
                label="Transferencia"
                amount={income.transferencia}
                total={income.total}
                color="bg-sky-500"
              />
              <BreakdownRow
                label="Tarjeta"
                amount={income.tarjeta}
                total={income.total}
                color="bg-violet-500"
              />
              {income.otros > 0 && (
                <BreakdownRow
                  label="Sin método"
                  amount={income.otros}
                  total={income.total}
                  color="bg-slate-400"
                />
              )}
            </div>
          )}
          <div className="mt-4 flex justify-between border-t border-slate-100 pt-3 text-sm font-semibold">
            <span>Total ingresos</span>
            <span className="tabular-nums text-emerald-700">
              {formatMoney(income.total)}
            </span>
          </div>
        </Card>

        <Card className="p-4">
          <h3 className="mb-3 flex items-center gap-2 font-semibold text-slate-900">
            <span aria-hidden>🧾</span> Egresos por categoría
          </h3>
          {expense.rows.length === 0 ? (
            <p className="text-sm text-slate-500">Sin costos en el período.</p>
          ) : (
            <div className="space-y-3">
              {expense.rows.map((r) => (
                <BreakdownRow
                  key={r.name}
                  label={r.name}
                  amount={r.amount}
                  total={expense.total}
                  color="bg-red-400"
                />
              ))}
            </div>
          )}
          <div className="mt-4 flex justify-between border-t border-slate-100 pt-3 text-sm font-semibold">
            <span>Total egresos</span>
            <span className="tabular-nums text-red-700">
              {formatMoney(expense.total)}
            </span>
          </div>
        </Card>
      </div>

      {showUnpaid && (
        <Card className="mt-4 p-4">
          <h3 className="mb-3 flex items-center gap-2 font-semibold text-slate-900">
            <span aria-hidden>⏳</span> Pedidos por cobrar
          </h3>
          {unpaid.rows.length === 0 ? (
            <p className="text-sm text-slate-500">
              No hay pedidos por cobrar.
            </p>
          ) : (
            <div className="space-y-1.5">
              {unpaid.rows.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center justify-between gap-3 text-sm"
                >
                  <span className="min-w-0 truncate text-slate-700">
                    {r.date.split('-').reverse().join('-')} · {r.name}
                  </span>
                  <span className="shrink-0 tabular-nums font-medium text-amber-700">
                    {formatMoney(r.total)}
                  </span>
                </div>
              ))}
            </div>
          )}
          <div className="mt-4 flex justify-between border-t border-slate-100 pt-3 text-sm font-semibold">
            <span>Total por cobrar</span>
            <span className="tabular-nums text-amber-700">
              {formatMoney(unpaid.total)}
            </span>
          </div>
        </Card>
      )}
    </div>
  )
}

function KpiCard({
  label,
  value,
  tone,
  hint,
}: {
  label: string
  value: number
  tone: 'green' | 'red' | 'amber'
  hint?: string
}) {
  const tones = {
    green: 'border-emerald-100 bg-emerald-50 text-emerald-700',
    red: 'border-red-100 bg-red-50 text-red-700',
    amber: 'border-amber-100 bg-amber-50 text-amber-700',
  }
  return (
    <div className={`rounded-2xl border p-4 ${tones[tone]}`}>
      <p className="flex items-center gap-1.5 text-sm font-medium opacity-80">
        {label}
        {hint && <InfoHint text={hint} />}
      </p>
      <p className="mt-1 text-2xl font-bold tabular-nums">
        {formatMoney(value)}
      </p>
    </div>
  )
}

function BreakdownRow({
  label,
  amount,
  total,
  color,
}: {
  label: string
  amount: number
  total: number
  color: string
}) {
  const pct = total > 0 ? Math.round((amount / total) * 100) : 0
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2 text-sm">
        <span className="min-w-0 truncate text-slate-700">{label}</span>
        <span className="shrink-0 tabular-nums font-medium text-slate-800">
          {formatMoney(amount)}{' '}
          <span className="text-xs text-slate-400">({pct}%)</span>
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
        <div
          className={`h-full rounded-full ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

// ============================================================================
//  Reporte por repartidor: mismas cifras que ve el repartidor, pero elegidas
//  desde un filtro. No muestra nada hasta seleccionar un repartidor.
// ============================================================================
function RepartidoresTab({
  products,
  supplies,
  drivers,
  companyName,
  registerExporter,
}: {
  products: Product[]
  supplies: Supply[]
  drivers: Driver[]
  companyName?: string
  registerExporter: (fn: (() => void) | null) => void
}) {
  const [driverId, setDriverId] = useState('')
  // Rango de FECHA DE RUTA: arranca en el mes actual y se filtra EN EL
  // SERVIDOR (ahorro de egress). Los datos se piden sólo al elegir repartidor.
  const [defaultRange] = useState(currentMonthRange)
  const [fromDate, setFromDate] = useState(defaultRange.from)
  const [toDate, setToDate] = useState(defaultRange.to)
  const range = { from: fromDate, to: toDate }
  const hasRange = Boolean(fromDate || toDate)

  // Con rango: pedidos de las rutas de esas fechas. Sin rango: todos (incluye
  // pedidos fuera de ruta, igual que antes).
  const ordersQuery = useQuery({
    queryKey: hasRange
      ? ['orders', 'by-route-date', range]
      : ['orders', 'report', ALL_TIME],
    queryFn: () =>
      hasRange ? listOrdersByRouteDate(range) : listOrders(ALL_TIME),
    enabled: Boolean(driverId),
    placeholderData: keepPreviousData,
  })
  const costsQuery = useQuery({
    queryKey: ['costs', range],
    queryFn: () => listCosts(range),
    enabled: Boolean(driverId),
    placeholderData: keepPreviousData,
  })
  const orders = useMemo(() => ordersQuery.data ?? [], [ordersQuery.data])
  const costs = useMemo(() => costsQuery.data ?? [], [costsQuery.data])

  const productSupply = useMemo(() => {
    const m = new Map<string, { supply_id: string; quantity: number }[]>()
    products.forEach((p) => {
      if (p.supplies?.length) m.set(p.id, p.supplies)
    })
    return m
  }, [products])
  const supplyName = useMemo(() => {
    const m = new Map<string, string>()
    supplies.forEach((s) => m.set(s.id, s.name))
    return m
  }, [supplies])

  const summary = useMemo(() => {
    if (!driverId) return null
    // "__all__" = todos los repartidores (se agregan las cifras de todos).
    const isAll = driverId === '__all__'
    const driverIdSet = new Set(drivers.map((d) => d.id))
    const matches = (id: string | null | undefined) =>
      isAll ? Boolean(id && driverIdSet.has(id)) : id === driverId
    let efectivo = 0
    const productQty = new Map<string, { name: string; qty: number }>()
    const supplyQty = new Map<string, number>()
    for (const o of orders) {
      if (!matches(o.driverId)) continue
      // Se filtra por la FECHA DE LA RUTA (igual que la "Carga de la ruta" y el
      // módulo Entregas). Los pedidos fuera de ruta no tienen fecha de ruta, así
      // que sólo entran cuando no hay filtro de fechas.
      const date = o.routeDate ?? null
      if (fromDate || toDate) {
        if (!date) continue
        if (fromDate && date < fromDate) continue
        if (toDate && date > toDate) continue
      }
      efectivo += paidWithMethod(o, 'efectivo')
      if (o.status === 'delivered') {
        for (const it of o.items) {
          const cur = productQty.get(it.product_id) ?? {
            name: it.product?.name ?? 'Producto',
            qty: 0,
          }
          cur.qty += it.quantity
          productQty.set(it.product_id, cur)
          const links = productSupply.get(it.product_id)
          if (links)
            for (const l of links)
              supplyQty.set(
                l.supply_id,
                (supplyQty.get(l.supply_id) ?? 0) + it.quantity * l.quantity
              )
        }
      }
    }
    let costos = 0
    for (const c of costs) {
      if (!matches(c.created_by)) continue
      if (fromDate && c.issue_date < fromDate) continue
      if (toDate && c.issue_date > toDate) continue
      costos += Number(c.amount)
    }
    const productos = Array.from(productQty.values()).sort((a, b) =>
      a.name.localeCompare(b.name)
    )
    const insumos = Array.from(supplyQty, ([id, qty]) => ({
      name: supplyName.get(id) ?? 'Insumo',
      qty,
    })).sort((a, b) => b.qty - a.qty)
    return { efectivo, costos, balance: efectivo - costos, productos, insumos }
  }, [driverId, drivers, orders, costs, fromDate, toDate, productSupply, supplyName])

  function exportPdf() {
    if (!summary) return
    const driverName =
      driverId === '__all__'
        ? 'Todos los repartidores'
        : drivers.find((d) => d.id === driverId)?.full_name ||
          drivers.find((d) => d.id === driverId)?.email ||
          'Repartidor'
    const periodo =
      fromDate || toDate
        ? `Período: ${fromDate || 'inicio'} a ${toDate || 'hoy'}`
        : 'Período: todo'
    const r = makeReportDoc(
      `Repartidor: ${driverName}`,
      companyName,
      `${periodo} · Generado ${new Date().toLocaleDateString('es-CL')}`
    )
    addReportTable(
      r,
      ['Resumen', 'Monto'],
      [
        ['Ventas en efectivo', formatMoney(summary.efectivo)],
        ['Costos', formatMoney(summary.costos)],
        ['Balance efectivo', formatMoney(summary.balance)],
      ],
      { title: 'Resumen' }
    )
    addReportTable(
      r,
      ['Insumo', 'Cantidad'],
      summary.insumos.map((s) => [s.name, s.qty]),
      { title: 'Insumos entregados' }
    )
    addReportTable(
      r,
      ['Producto', 'Cantidad'],
      summary.productos.map((p) => [p.name, p.qty]),
      { title: 'Productos entregados' }
    )
    saveReport(r, 'reporte-repartidor.pdf')
  }

  // Registra el exportador para el botón del encabezado.
  const exportRef = useRef(exportPdf)
  exportRef.current = exportPdf
  const canExport = Boolean(summary)
  useEffect(() => {
    registerExporter(canExport ? () => exportRef.current() : null)
    return () => registerExporter(null)
  }, [canExport, registerExporter])

  return (
    <div>
      {/* Filtros */}
      <Card className="mb-4 p-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label>Repartidor</Label>
            <select
              value={driverId}
              onChange={(e) => setDriverId(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
            >
              <option value="">Selecciona un repartidor…</option>
              <option value="__all__">Todos los repartidores</option>
              {drivers.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.full_name || d.email || 'Sin nombre'}
                </option>
              ))}
            </select>
          </div>
          <DateRangeFilter
            from={fromDate}
            to={toDate}
            onChange={(f, t) => {
              setFromDate(f)
              setToDate(t)
            }}
            label="Fecha de la ruta"
            hint="Se filtra por la fecha de la ruta en que se entregó el pedido (coincide con la Carga de la ruta y Entregas)."
            presets
          />
        </div>
      </Card>

      {!summary ? (
        <EmptyState>
          Selecciona un repartidor para ver sus ventas en efectivo, sus costos y
          los insumos que entregó.
        </EmptyState>
      ) : (
        <>
          <div className="mb-4 grid gap-3 sm:grid-cols-3">
            <KpiCard
              label="Ventas en efectivo"
              value={summary.efectivo}
              tone="green"
              hint="Total cobrado en EFECTIVO de los pedidos de este repartidor marcados como Pagado dentro del rango. No incluye transferencias."
            />
            <KpiCard
              label="Costos"
              value={summary.costos}
              tone="red"
              hint="Suma de los costos que este repartidor registró (módulo Costos) dentro del rango."
            />
            <KpiCard
              label="Balance efectivo"
              value={summary.balance}
              tone={summary.balance >= 0 ? 'green' : 'red'}
              hint="Ventas en efectivo menos los costos del repartidor. Aproximadamente el efectivo que debería tener en mano."
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="overflow-hidden">
              <div className="border-b border-slate-100 bg-slate-50 px-4 py-3 font-semibold text-slate-900">
                🛒 Insumos entregados
              </div>
              {summary.insumos.length === 0 ? (
                <p className="px-4 py-3 text-sm text-slate-500">
                  Sin insumos en el período.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
                        <th className="px-4 py-2">Insumo</th>
                        <th className="px-4 py-2 text-right">Cantidad</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.insumos.map((s) => (
                        <tr
                          key={s.name}
                          className="border-b border-slate-100 last:border-0"
                        >
                          <td className="px-4 py-2 text-slate-800">{s.name}</td>
                          <td className="px-4 py-2 text-right font-medium tabular-nums text-slate-900">
                            {s.qty}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            <Card className="overflow-hidden">
              <div className="border-b border-slate-100 bg-slate-50 px-4 py-3 font-semibold text-slate-900">
                📦 Productos entregados
              </div>
              {summary.productos.length === 0 ? (
                <p className="px-4 py-3 text-sm text-slate-500">
                  Sin productos entregados en el período.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
                        <th className="px-4 py-2">Producto</th>
                        <th className="px-4 py-2 text-right">Cantidad</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.productos.map((p) => (
                        <tr
                          key={p.name}
                          className="border-b border-slate-100 last:border-0"
                        >
                          <td className="px-4 py-2 text-slate-800">{p.name}</td>
                          <td className="px-4 py-2 text-right font-medium tabular-nums text-slate-900">
                            {p.qty}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  )
}
