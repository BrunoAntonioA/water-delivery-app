import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { getDeliverySummary, type DeliverySummaryRow } from '../api/deliveries'
import { listDrivers } from '../api/routes'
import { useAuth } from '../lib/auth'
import {
  Button,
  Card,
  EmptyState,
  Label,
  PageHeader,
  Spinner,
  TextInput,
} from '../components/ui'

interface DriverGroup {
  driver_id: string
  name: string
  rows: DeliverySummaryRow[]
  total: number
}

export default function DeliveriesSummaryPage() {
  const { profile } = useAuth()
  const isRepartidor = profile?.role === 'repartidor'

  const [driverId, setDriverId] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')

  // El repartidor sólo ve lo suyo: nunca enviamos filtro de repartidor.
  const effectiveDriverId = isRepartidor ? null : driverId || null

  const { data: drivers } = useQuery({
    queryKey: ['drivers'],
    queryFn: listDrivers,
    enabled: !isRepartidor,
  })

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['delivery-summary', effectiveDriverId, fromDate, toDate],
    queryFn: () =>
      getDeliverySummary({
        driverId: effectiveDriverId,
        from: fromDate || null,
        to: toDate || null,
      }),
  })

  const groups: DriverGroup[] = useMemo(() => {
    const m = new Map<string, DriverGroup>()
    for (const r of data ?? []) {
      let g = m.get(r.driver_id)
      if (!g) {
        g = { driver_id: r.driver_id, name: r.driver_name, rows: [], total: 0 }
        m.set(r.driver_id, g)
      }
      g.rows.push(r)
      g.total += Number(r.total_quantity)
    }
    return Array.from(m.values())
  }, [data])

  const hasFilters = Boolean(driverId || fromDate || toDate)

  function clearAll() {
    setDriverId('')
    setFromDate('')
    setToDate('')
  }

  function exportCsv() {
    if (!data || data.length === 0) return
    const headers = ['Repartidor', 'Producto', 'Cantidad']
    const esc = (v: string) => `"${String(v).replace(/"/g, '""')}"`
    const lines = [
      headers,
      ...data.map((r) => [
        r.driver_name,
        r.product_name,
        String(Number(r.total_quantity)),
      ]),
    ].map((row) => row.map(esc).join(','))
    const csv = '﻿' + lines.join('\r\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'resumen-entregas.csv'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  return (
    <div>
      <PageHeader
        title="Resumen de entregas"
        subtitle={
          isRepartidor
            ? 'Cantidad entregada de cada producto, por rango de fechas.'
            : 'Cantidad entregada de cada producto por repartidor, por rango de fechas.'
        }
        action={
          data && data.length > 0 ? (
            <Button variant="secondary" onClick={exportCsv}>
              ⬇ Descargar CSV
            </Button>
          ) : undefined
        }
      />

      {/* --- Filtros --- */}
      <Card className="mb-4 p-4">
        <div className="grid gap-4 sm:grid-cols-2">
          {!isRepartidor && (
            <div>
              <Label>Repartidor</Label>
              <select
                value={driverId}
                onChange={(e) => setDriverId(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
              >
                <option value="">Todos los repartidores</option>
                {(drivers ?? []).map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.full_name || d.email || 'Sin nombre'}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div>
            <Label>Rango de fechas (de la ruta)</Label>
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
            <p className="mt-1 text-xs text-slate-400">
              Deja ambas para ver todo, o pon la misma fecha en las dos para un
              solo día.
            </p>
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

      {isLoading ? (
        <Spinner />
      ) : isError ? (
        <Card className="border-red-200 bg-red-50 p-4 text-sm text-red-700">
          No se pudo cargar el resumen: {(error as Error).message}
        </Card>
      ) : groups.length === 0 ? (
        <EmptyState>No hay entregas con esos filtros.</EmptyState>
      ) : (
        <div className="grid gap-4">
          {groups.map((g) => (
            <Card key={g.driver_id} className="overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50 px-4 py-3">
                <span className="font-semibold text-slate-900">
                  🚚 {g.name}
                </span>
                <span className="text-sm text-slate-500">
                  {g.total} {g.total === 1 ? 'unidad' : 'unidades'} en total
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
                      <th className="px-4 py-2">Producto</th>
                      <th className="px-4 py-2 text-right">Cantidad entregada</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.rows.map((r) => (
                      <tr
                        key={r.product_id}
                        className="border-b border-slate-100 last:border-0"
                      >
                        <td className="px-4 py-2 text-slate-800">
                          {r.product_name}
                        </td>
                        <td className="px-4 py-2 text-right font-medium tabular-nums text-slate-900">
                          {Number(r.total_quantity)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
