import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { listOrders } from '../api/orders'
import { listClients } from '../api/clients'
import type { OrderDetail, OrderStatus } from '../types/db'
import { formatDate, formatMoney, toLocalDateStr } from '../lib/format'
import { orderClientName } from '../lib/order'
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
  Label,
  Pagination,
  PageHeader,
  Spinner,
  TextInput,
} from '../components/ui'

const PAGE_SIZE = 15

type StatusFilter = 'all' | 'unpaid' | OrderStatus

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'unpaid', label: 'Pendientes de pago' },
  { value: 'ordered', label: 'Pedido' },
  { value: 'delivered', label: 'Entregado' },
  { value: 'paid', label: 'Pagado' },
]

export default function OrdersReportPage() {
  const { data: orders, isLoading } = useQuery({
    queryKey: ['orders'],
    queryFn: listOrders,
  })
  const { data: clients } = useQuery({
    queryKey: ['clients'],
    queryFn: listClients,
  })

  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [clientId, setClientId] = useState('')
  const [page, setPage] = useState(1)

  const filtered = useMemo(() => {
    return (orders ?? []).filter((o) => {
      // Rango de fechas: 'YYYY-MM-DD' se compara lexicográficamente (= por fecha).
      const date = toLocalDateStr(o.created_at)
      if (fromDate && date < fromDate) return false
      if (toDate && date > toDate) return false
      if (clientId && o.client_id !== clientId) return false
      if (statusFilter === 'all') return true
      if (statusFilter === 'unpaid') return o.status !== 'paid'
      return o.status === statusFilter
    })
  }, [orders, fromDate, toDate, statusFilter, clientId])

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
    fromDate || toDate || clientId || statusFilter !== 'all'
  )

  function clearAll() {
    setFromDate('')
    setToDate('')
    setStatusFilter('all')
    setClientId('')
    setPage(1)
  }

  function exportCsv() {
    if (filtered.length === 0) return

    const headers = [
      'Fecha',
      'Cliente',
      'Teléfono',
      'Dirección',
      'Detalle',
      'Total',
      'Estado',
      'Pago',
    ]

    const rowOf = (o: OrderDetail) => [
      formatDate(o.created_at),
      orderClientName(o),
      o.client?.phone ?? '',
      o.address
        ? [o.address.address, o.address.comuna].filter(Boolean).join(', ')
        : '',
      o.items
        .map((it) => `${it.quantity} x ${it.product?.name ?? 'Producto'}`)
        .join('; '),
      String(Number(o.total)),
      STATUS_LABELS[o.status],
      o.status === 'paid' && o.payment_method
        ? PAYMENT_LABELS[o.payment_method]
        : '',
    ]

    // Escapa cada campo para CSV (comillas, comas y saltos de línea).
    const esc = (v: string) => `"${String(v).replace(/"/g, '""')}"`
    const lines = [headers, ...filtered.map(rowOf)].map((row) =>
      row.map(esc).join(',')
    )
    // BOM para que Excel abra los acentos correctamente.
    const csv = '﻿' + lines.join('\r\n')

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'reporte-pedidos.csv'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  return (
    <div>
      <PageHeader
        title="Reportes"
        subtitle="Consulta y filtra todos los pedidos por fecha, estado y cliente."
        action={
          filtered.length > 0 ? (
            <Button variant="secondary" onClick={exportCsv}>
              ⬇ Descargar CSV
            </Button>
          ) : undefined
        }
      />

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
            <Label>Rango de fechas</Label>
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
            <p className="mt-1 text-xs text-slate-400">
              Deja ambas para ver todo, o pon la misma fecha en las dos para un
              solo día.
            </p>
          </div>
        </div>

        <div className="mt-4">
          <Label>Estado</Label>
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
                          {o.status === 'paid' && o.payment_method
                            ? PAYMENT_LABELS[o.payment_method]
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
    </div>
  )
}
