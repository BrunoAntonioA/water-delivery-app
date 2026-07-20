import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { listOrders } from '../api/orders'
import { listClients } from '../api/clients'
import type { OrderStatus } from '../types/db'
import { formatDate, formatMoney, toLocalDateStr } from '../lib/format'
import { ClientCombobox } from '../components/ClientCombobox'
import { PAYMENT_LABELS, StatusBadge } from '../components/StatusBadge'
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

  const [dateFilter, setDateFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [clientId, setClientId] = useState('')
  const [page, setPage] = useState(1)

  const filtered = useMemo(() => {
    return (orders ?? []).filter((o) => {
      if (dateFilter && toLocalDateStr(o.created_at) !== dateFilter) return false
      if (clientId && o.client_id !== clientId) return false
      if (statusFilter === 'all') return true
      if (statusFilter === 'unpaid') return o.status !== 'paid'
      return o.status === statusFilter
    })
  }, [orders, dateFilter, statusFilter, clientId])

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

  const hasFilters = Boolean(dateFilter || clientId || statusFilter !== 'all')

  function clearAll() {
    setDateFilter('')
    setStatusFilter('all')
    setClientId('')
    setPage(1)
  }

  return (
    <div>
      <PageHeader
        title="Reportes"
        subtitle="Consulta y filtra todos los pedidos por fecha, estado y cliente."
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
            <Label>Fecha</Label>
            <TextInput
              type="date"
              value={dateFilter}
              onChange={(e) => {
                setDateFilter(e.target.value)
                setPage(1)
              }}
            />
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
                          {o.client
                            ? `${o.client.name} ${o.client.surname}`
                            : 'Cliente eliminado'}
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
