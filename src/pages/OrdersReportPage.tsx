import { useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { listOrders } from '../api/orders'
import { listClients } from '../api/clients'
import { listCosts } from '../api/costs'
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
  CostWithCategory,
  OrderDetail,
  OrderStatus,
  PaymentMethod,
  Product,
  Supply,
} from '../types/db'
import { formatDate, formatMoney, toLocalDateStr } from '../lib/format'
import { orderClientName, orderPaymentList, paidWithMethod } from '../lib/order'
import { ClientCombobox } from '../components/ClientCombobox'
import {
  PAYMENT_LABELS,
  STATUS_LABELS,
  StatusBadge,
} from '../components/StatusBadge'
import {
  Button,
  Card,
  EmptyState,
  InfoHint,
  Label,
  Pagination,
  PageHeader,
  Spinner,
  TextInput,
} from '../components/ui'

const PAGE_SIZE = 15

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


export default function OrdersReportPage() {
  const { company } = useAuth()
  const { data: orders, isLoading } = useQuery({
    queryKey: ['orders'],
    queryFn: listOrders,
  })
  const { data: clients } = useQuery({
    queryKey: ['clients'],
    queryFn: listClients,
  })
  const { data: costs } = useQuery({
    queryKey: ['costs'],
    queryFn: listCosts,
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

  const [tab, setTab] = useState<'pedidos' | 'repartidores' | 'caja'>('pedidos')
  // Cada pestaña "registra" su exportador; el botón del encabezado ejecuta el
  // de la pestaña activa, para que el botón se vea igual en todas.
  const exporterRef = useRef<null | (() => void)>(null)
  const [childCanExport, setChildCanExport] = useState(false)
  const registerExporter = useCallback((fn: (() => void) | null) => {
    exporterRef.current = fn
    setChildCanExport(Boolean(fn))
  }, [])
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
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

  const totalSum = useMemo(
    () => filtered.reduce((sum, o) => sum + Number(o.total), 0),
    [filtered]
  )

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount)
  const pageItems = filtered.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE
  )

  const hasFilters = Boolean(
    fromDate ||
      toDate ||
      clientId ||
      statusFilter !== 'all' ||
      paidFilter !== 'all' ||
      paymentFilter !== 'all' ||
      driverId
  )

  function clearAll() {
    setFromDate('')
    setToDate('')
    setStatusFilter('all')
    setPaidFilter('all')
    setClientId('')
    setPaymentFilter('all')
    setDriverId('')
    setPage(1)
  }

  function exportPdf() {
    if (filtered.length === 0) return
    const subtitle = `${filtered.length} pedidos · Total ${formatMoney(totalSum)} · Generado ${new Date().toLocaleDateString('es-CL')}`
    const r = makeReportDoc('Reporte de pedidos', company?.name, subtitle, true)
    addReportTable(
      r,
      [
        'Fecha',
        'Cliente',
        'Repartidor',
        'Teléfono',
        'Dirección',
        'Detalle',
        'Total',
        'Estado',
        'Pago',
      ],
      filtered.map((o) => [
        formatDate(o.created_at),
        orderClientName(o),
        o.driverName ?? '',
        o.client?.phone ?? '',
        o.address
          ? [o.address.address, o.address.comuna].filter(Boolean).join(', ')
          : '',
        o.items
          .map((it) => `${it.quantity} x ${it.product?.name ?? 'Producto'}`)
          .join('; '),
        formatMoney(o.total),
        STATUS_LABELS[o.status],
        o.paid
          ? orderPaymentList(o)
              .map((p) => PAYMENT_LABELS[p.method])
              .join(' + ')
          : '',
      ])
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
            disabled={
              tab === 'pedidos' ? filtered.length === 0 : !childCanExport
            }
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
          orders={orders ?? []}
          costs={costs ?? []}
          products={products ?? []}
          supplies={supplies ?? []}
          drivers={driversList ?? []}
          companyName={company?.name}
          registerExporter={registerExporter}
        />
      )}
      {tab === 'caja' && (
        <CashFlowTab
          orders={orders ?? []}
          costs={costs ?? []}
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
          <div>
            <div className="mb-1 flex items-center gap-1.5">
              <span className="text-sm font-medium text-slate-700">
                Rango de fechas
              </span>
              <InfoHint text="Deja ambas para ver todo, o pon la misma fecha en las dos para un solo día." />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <TextInput
                type="date"
                value={fromDate}
                max={toDate || undefined}
                onChange={(e) => {
                  setFromDate(e.target.value)
                  setPage(1)
                }}
                className="w-full sm:w-auto"
                aria-label="Desde"
              />
              <span className="hidden text-sm text-slate-400 sm:inline">a</span>
              <TextInput
                type="date"
                value={toDate}
                min={fromDate || undefined}
                onChange={(e) => {
                  setToDate(e.target.value)
                  setPage(1)
                }}
                className="w-full sm:w-auto"
                aria-label="Hasta"
              />
            </div>
          </div>
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

        <div className="mt-4 flex gap-6 overflow-x-auto pb-1">
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
        </span>
        <span className="font-semibold text-slate-900">
          Total: {formatMoney(totalSum)}
        </span>
      </div>

      {isLoading ? (
        <Spinner />
      ) : filtered.length === 0 ? (
        <EmptyState>No hay pedidos con esos filtros.</EmptyState>
      ) : (
        <>
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase text-slate-500">
                    <th className="px-3 py-2">Fecha</th>
                    <th className="px-3 py-2">Cliente</th>
                    <th className="px-3 py-2">Repartidor</th>
                    <th className="px-3 py-2 text-center">Ítems</th>
                    <th className="px-3 py-2 text-right">Total</th>
                    <th className="px-3 py-2">Estado</th>
                    <th className="px-3 py-2">Pago</th>
                  </tr>
                </thead>
                <tbody>
                  {pageItems.map((o) => {
                    const itemCount = o.items.reduce(
                      (s, it) => s + it.quantity,
                      0
                    )
                    return (
                      <tr
                        key={o.id}
                        className="border-b border-slate-100 last:border-0"
                      >
                        <td className="whitespace-nowrap px-3 py-2 text-slate-500">
                          {formatDate(o.created_at)}
                        </td>
                        <td className="px-3 py-2 font-medium text-slate-800">
                          {orderClientName(o)}
                        </td>
                        <td className="px-3 py-2 text-slate-600">
                          {o.driverName ?? '—'}
                        </td>
                        <td className="px-3 py-2 text-center text-slate-600">
                          {itemCount}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right font-medium text-slate-800">
                          {formatMoney(o.total)}
                        </td>
                        <td className="px-3 py-2">
                          <StatusBadge status={o.status} />
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-slate-600">
                          {o.paid
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

// ============================================================================
//  Flujo de caja: ingresos (pedidos pagados) vs egresos (costos), por fecha.
// ============================================================================
function CashFlowTab({
  orders,
  costs,
  companyName,
  registerExporter,
}: {
  orders: OrderDetail[]
  costs: CostWithCategory[]
  companyName?: string
  registerExporter: (fn: (() => void) | null) => void
}) {
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')

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
    return {
      efectivo,
      transferencia,
      tarjeta,
      otros,
      total: efectivo + transferencia + tarjeta + otros,
    }
  }, [orders, fromDate, toDate])

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
    const rows = Array.from(byCat, ([name, amount]) => ({ name, amount })).sort(
      (a, b) => b.amount - a.amount
    )
    return { rows, total }
  }, [costs, fromDate, toDate])

  const balance = income.total - expense.total

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
      { title: 'Costos por categoría' }
    )

    // Detalle de movimientos (ingresos + costos) ordenado por fecha.
    const short = (d: string) => d.split('-').reverse().join('-')
    type Mov = { date: string; tipo: string; detalle: string; monto: string }
    const movimientos: Mov[] = []
    for (const o of orders) {
      if (!o.paid) continue
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

    saveReport(r, 'flujo-de-caja.pdf')
  }

  const hasData = income.total > 0 || expense.total > 0

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
        <div className="mb-1 flex items-center gap-1.5">
          <span className="text-sm font-medium text-slate-700">
            Rango de fechas
          </span>
          <InfoHint text="Deja ambas para ver todo, o pon la misma fecha en las dos para un solo día." />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <TextInput
            type="date"
            value={fromDate}
            max={toDate || undefined}
            onChange={(e) => setFromDate(e.target.value)}
            className="w-full sm:w-auto"
            aria-label="Desde"
          />
          <span className="hidden text-sm text-slate-400 sm:inline">a</span>
          <TextInput
            type="date"
            value={toDate}
            min={fromDate || undefined}
            onChange={(e) => setToDate(e.target.value)}
            className="w-full sm:w-auto"
            aria-label="Hasta"
          />
          {(fromDate || toDate) && (
            <Button
              variant="ghost"
              onClick={() => {
                setFromDate('')
                setToDate('')
              }}
            >
              Limpiar
            </Button>
          )}
        </div>
      </Card>

      {/* KPIs */}
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <KpiCard
          label="Ingresos"
          value={income.total}
          tone="green"
          hint="Total de los pedidos marcados como Pagado (efectivo + transferencia) dentro del rango de fechas."
        />
        <KpiCard
          label="Egresos (costos)"
          value={expense.total}
          tone="red"
          hint="Suma de todos los costos de la empresa registrados dentro del rango de fechas."
        />
        <KpiCard
          label="Balance"
          value={balance}
          tone={balance >= 0 ? 'green' : 'red'}
          hint="Ingresos menos egresos. Positivo = ganancia; negativo = pérdida en el período."
        />
      </div>

      {/* Detalle */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <h3 className="mb-3 flex items-center gap-2 font-semibold text-slate-900">
            <span aria-hidden>💵</span> Ingresos
          </h3>
          {income.total === 0 ? (
            <p className="text-sm text-slate-500">
              Sin pedidos pagados en el período.
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
            <span aria-hidden>🧾</span> Costos por categoría
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
  tone: 'green' | 'red'
  hint?: string
}) {
  const tones = {
    green: 'border-emerald-100 bg-emerald-50 text-emerald-700',
    red: 'border-red-100 bg-red-50 text-red-700',
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
  orders,
  costs,
  products,
  supplies,
  drivers,
  companyName,
  registerExporter,
}: {
  orders: OrderDetail[]
  costs: CostWithCategory[]
  products: Product[]
  supplies: Supply[]
  drivers: Driver[]
  companyName?: string
  registerExporter: (fn: (() => void) | null) => void
}) {
  const [driverId, setDriverId] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')

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
    let efectivo = 0
    const productQty = new Map<string, { name: string; qty: number }>()
    const supplyQty = new Map<string, number>()
    for (const o of orders) {
      if (o.driverId !== driverId) continue
      // La fecha del reporte es la de ENTREGA. Si el pedido no está entregado no
      // tiene fecha de entrega: sólo se incluye cuando no hay filtro de fechas.
      const date = o.delivered_at ? toLocalDateStr(o.delivered_at) : null
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
      if (c.created_by !== driverId) continue
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
  }, [driverId, orders, costs, fromDate, toDate, productSupply, supplyName])

  function exportPdf() {
    if (!summary) return
    const driverName =
      drivers.find((d) => d.id === driverId)?.full_name ||
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
              {drivers.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.full_name || d.email || 'Sin nombre'}
                </option>
              ))}
            </select>
          </div>
          <div>
            <div className="mb-1 flex items-center gap-1.5">
              <span className="text-sm font-medium text-slate-700">
                Rango de fechas (de entrega)
              </span>
              <InfoHint text="Se filtra por la fecha en que se marcó el pedido como entregado. Deja ambas para ver todo, o pon la misma fecha en las dos para un solo día." />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <TextInput
                type="date"
                value={fromDate}
                max={toDate || undefined}
                onChange={(e) => setFromDate(e.target.value)}
                className="w-full sm:w-auto"
                aria-label="Desde"
              />
              <span className="hidden text-sm text-slate-400 sm:inline">a</span>
              <TextInput
                type="date"
                value={toDate}
                min={fromDate || undefined}
                onChange={(e) => setToDate(e.target.value)}
                className="w-full sm:w-auto"
                aria-label="Hasta"
              />
            </div>
          </div>
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
