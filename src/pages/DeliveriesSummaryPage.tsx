import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { driverLabel, listDrivers, listRouteLoads } from '../api/routes'
import { listOrders } from '../api/orders'
import { listCosts } from '../api/costs'
import { listProducts } from '../api/products'
import { listSupplies } from '../api/supplies'
import { useAuth } from '../lib/auth'
import { paidWithMethod } from '../lib/order'
import { formatMoney } from '../lib/format'
import { makeReportDoc, addReportTable, saveReport } from '../lib/reportPdf'
import { DateRangeFilter } from '../components/DateRangeFilter'
import {
  Button,
  Card,
  EmptyState,
  InfoHint,
  Label,
  PageHeader,
  Spinner,
} from '../components/ui'

export default function DeliveriesSummaryPage() {
  const { profile, company } = useAuth()
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

  // Se cuenta a partir de los pedidos entregados y sus ítems (igual que la
  // "Carga de la ruta"), no de un resumen agregado, para que ambos coincidan.
  const {
    data: orders,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ['orders'],
    queryFn: listOrders,
  })

  const { data: myCosts } = useQuery({
    queryKey: ['costs'],
    queryFn: listCosts,
    enabled: isRepartidor,
  })
  // Productos e insumos: necesarios para la tabla de insumos, que ven todos.
  const { data: products } = useQuery({
    queryKey: ['products'],
    queryFn: listProducts,
  })
  const { data: supplies } = useQuery({
    queryKey: ['supplies'],
    queryFn: listSupplies,
  })
  // Cargas de ruta (carga inicial): columna "Carga" de los movimientos de insumos.
  const { data: routeLoads } = useQuery({
    queryKey: ['route-loads'],
    queryFn: listRouteLoads,
  })

  const inRange = (dateStr: string) =>
    (!fromDate || dateStr >= fromDate) && (!toDate || dateStr <= toDate)

  // Ventas en efectivo (pedidos pagados en efectivo dentro del rango).
  const ventasEfectivo = useMemo(() => {
    let sum = 0
    for (const o of orders ?? []) {
      if (!o.paid) continue
      // Se cuenta por la FECHA DE LA RUTA (igual que las tablas de abajo).
      if (fromDate || toDate) {
        if (!o.routeDate) continue
        if (!inRange(o.routeDate)) continue
      }
      sum += paidWithMethod(o, 'efectivo')
    }
    return sum
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders, fromDate, toDate])

  // Total de mis costos en el rango.
  const totalCostos = useMemo(() => {
    let sum = 0
    for (const c of myCosts ?? []) {
      if (!inRange(c.issue_date)) continue
      sum += Number(c.amount)
    }
    return sum
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myCosts, fromDate, toDate])

  // Pedidos ENTREGADOS según el filtro actual (repartidor + fecha de entrega).
  const deliveredOrders = useMemo(() => {
    return (orders ?? []).filter((o) => {
      if (o.status !== 'delivered') return false
      if (effectiveDriverId && o.driverId !== effectiveDriverId) return false
      // Se filtra por la FECHA DE LA RUTA, igual que la "Carga de la ruta"
      // (así ambos cuadran aunque un pedido se haya marcado entregado otro día).
      if (fromDate || toDate) {
        if (!o.routeDate) return false
        if (!inRange(o.routeDate)) return false
      }
      return true
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders, effectiveDriverId, fromDate, toDate])

  // Productos entregados: se suman las cantidades de los ítems de cada pedido.
  const productsSummary = useMemo(() => {
    const totals = new Map<string, { name: string; qty: number }>()
    for (const o of deliveredOrders) {
      for (const it of o.items) {
        const cur = totals.get(it.product_id)
        if (cur) cur.qty += it.quantity
        else
          totals.set(it.product_id, {
            name: it.product?.name ?? 'Producto',
            qty: it.quantity,
          })
      }
    }
    return Array.from(totals.values()).sort((a, b) => b.qty - a.qty)
  }, [deliveredOrders])

  // Insumos entregados: cada ítem entregado descuenta cantidad × insumos que
  // componen el producto (misma lógica que la "Carga de la ruta").
  const suppliesSummary = useMemo(() => {
    const productSupply = new Map<string, { supply_id: string; quantity: number }[]>()
    products?.forEach((p) => {
      if (p.supplies?.length) productSupply.set(p.id, p.supplies)
    })
    const supplyName = new Map<string, string>()
    supplies?.forEach((s) => supplyName.set(s.id, s.name))

    const totals = new Map<string, number>()
    for (const o of deliveredOrders) {
      for (const it of o.items) {
        const links = productSupply.get(it.product_id)
        if (!links) continue
        for (const link of links) {
          totals.set(
            link.supply_id,
            (totals.get(link.supply_id) ?? 0) + it.quantity * link.quantity
          )
        }
      }
    }
    return Array.from(totals, ([id, qty]) => ({
      name: supplyName.get(id) ?? 'Insumo',
      qty,
    })).sort((a, b) => b.qty - a.qty)
  }, [deliveredOrders, products, supplies])

  // Movimientos de insumos por insumo: Carga (carga inicial de la ruta),
  // Entregados (insumos que salieron en los productos entregados), Devueltos
  // vacíos (insumos vacíos que el cliente devolvió) y En ruta = Carga −
  // Entregados (lo lleno que debería quedar en el camión).
  const movimientos = useMemo(() => {
    const supplyName = new Map<string, string>()
    supplies?.forEach((s) => supplyName.set(s.id, s.name))
    const productSupply = new Map<
      string,
      { supply_id: string; quantity: number }[]
    >()
    products?.forEach((p) => {
      if (p.supplies?.length) productSupply.set(p.id, p.supplies)
    })

    type Row = {
      name: string
      carga: number
      entregados: number
      devueltos: number
    }
    const map = new Map<string, Row>()
    const row = (id: string): Row => {
      let r = map.get(id)
      if (!r) {
        r = { name: supplyName.get(id) ?? 'Insumo', carga: 0, entregados: 0, devueltos: 0 }
        map.set(id, r)
      }
      return r
    }

    // Carga (route_loads filtrados por repartidor + rango de fecha de la ruta).
    for (const l of routeLoads ?? []) {
      if (effectiveDriverId && l.driver_id !== effectiveDriverId) continue
      if ((fromDate || toDate) && !inRange(l.route_date)) continue
      row(l.supply_id).carga += l.quantity
    }

    // Entregados y Devueltos vacíos (de los pedidos entregados ya filtrados).
    for (const o of deliveredOrders) {
      for (const it of o.items) {
        const links = productSupply.get(it.product_id)
        if (!links) continue
        for (const link of links) {
          row(link.supply_id).entregados += it.quantity * link.quantity
        }
      }
      for (const rs of o.returned_supplies ?? []) {
        row(rs.supply_id).devueltos += rs.quantity
      }
    }

    return Array.from(map, ([id, r]) => ({
      id,
      ...r,
      enRuta: r.carga - r.entregados,
    }))
      .filter((r) => r.carga || r.entregados || r.devueltos)
      .sort((a, b) => b.carga - a.carga || b.entregados - a.entregados)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeLoads, deliveredOrders, products, supplies, effectiveDriverId, fromDate, toDate])

  const totalUnits = useMemo(
    () => productsSummary.reduce((s, p) => s + p.qty, 0),
    [productsSummary]
  )

  // Nombre que se muestra sobre las tablas: el repartidor filtrado o "Todos".
  const filterLabel = isRepartidor
    ? profile?.full_name || profile?.email || 'Mis entregas'
    : driverId
      ? drivers?.find((d) => d.id === driverId)?.full_name ||
        drivers?.find((d) => d.id === driverId)?.email ||
        'Sin nombre'
      : 'Todos los repartidores'

  const hasFilters = Boolean(driverId || fromDate || toDate)

  function clearAll() {
    setDriverId('')
    setFromDate('')
    setToDate('')
  }

  const hasData =
    productsSummary.length > 0 ||
    suppliesSummary.length > 0 ||
    movimientos.length > 0

  function exportPdf() {
    if (!hasData) return
    const parts: string[] = [filterLabel]
    if (fromDate || toDate) {
      parts.push(`Rango ${fromDate || '…'} a ${toDate || '…'}`)
    }
    parts.push(`Generado ${new Date().toLocaleDateString('es-CL')}`)

    const r = makeReportDoc(
      'Resumen de entregas',
      company?.name,
      parts.join(' · ')
    )

    if (movimientos.length) {
      addReportTable(
        r,
        ['Insumo', 'Carga', 'Entregados', 'Devueltos vacíos', 'En ruta'],
        movimientos.map((m) => [
          m.name,
          m.carga,
          m.entregados,
          m.devueltos,
          m.enRuta,
        ]),
        { title: 'Movimientos de insumos' }
      )
    }

    if (suppliesSummary.length) {
      addReportTable(
        r,
        ['Insumo', 'Cantidad entregada'],
        suppliesSummary.map((s) => [s.name, s.qty]),
        { title: 'Insumos entregados' }
      )
    }

    addReportTable(
      r,
      ['Producto', 'Cantidad entregada'],
      productsSummary.map((p) => [p.name, p.qty]),
      { title: `Productos entregados (${totalUnits} u.)` }
    )

    saveReport(r, 'resumen-entregas.pdf')
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
          hasData ? (
            <Button variant="secondary" onClick={exportPdf}>
              ⬇ Descargar PDF
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
                    {driverLabel(d)}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className={isRepartidor ? 'sm:col-span-2' : undefined}>
            <DateRangeFilter
              from={fromDate}
              to={toDate}
              onChange={(f, t) => {
                setFromDate(f)
                setToDate(t)
              }}
              label="Fecha de la ruta"
              hint="Se filtra por la fecha de la ruta en que se entregó el pedido (coincide con la Carga de la ruta)."
            />
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

      {/* Resumen personal del repartidor */}
      {isRepartidor && (
        <div className="mb-4 space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4">
              <p className="flex items-center gap-1.5 text-sm font-medium text-emerald-700 opacity-80">
                Ventas en efectivo
                <InfoHint text="Total cobrado en EFECTIVO de tus pedidos marcados como Pagado dentro del rango de fechas. No incluye transferencias." />
              </p>
              <p className="mt-1 text-2xl font-bold tabular-nums text-emerald-700">
                {formatMoney(ventasEfectivo)}
              </p>
            </div>
            <div className="rounded-2xl border border-red-100 bg-red-50 p-4">
              <p className="flex items-center gap-1.5 text-sm font-medium text-red-700 opacity-80">
                Mis costos
                <InfoHint text="Suma de los costos que TÚ registraste (en el módulo Costos) dentro del rango de fechas." />
              </p>
              <p className="mt-1 text-2xl font-bold tabular-nums text-red-700">
                {formatMoney(totalCostos)}
              </p>
            </div>
            <div
              className={`rounded-2xl border p-4 ${
                ventasEfectivo - totalCostos >= 0
                  ? 'border-emerald-100 bg-emerald-50 text-emerald-700'
                  : 'border-red-100 bg-red-50 text-red-700'
              }`}
            >
              <p className="flex items-center gap-1.5 text-sm font-medium opacity-80">
                Balance efectivo
                <InfoHint text="Ventas en efectivo menos tus costos. Es aproximadamente el efectivo que deberías tener en mano." />
              </p>
              <p className="mt-1 text-2xl font-bold tabular-nums">
                {formatMoney(ventasEfectivo - totalCostos)}
              </p>
            </div>
          </div>
        </div>
      )}

      {isLoading ? (
        <Spinner />
      ) : isError ? (
        <Card className="border-red-200 bg-red-50 p-4 text-sm text-red-700">
          No se pudo cargar el resumen: {(error as Error).message}
        </Card>
      ) : !hasData ? (
        <EmptyState>No hay entregas con esos filtros.</EmptyState>
      ) : (
        <div>
          {/* Encabezado: a quién corresponden las tablas de abajo. */}
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
              🚚 {filterLabel}
            </h2>
            <span className="text-sm text-slate-500">
              {totalUnits} {totalUnits === 1 ? 'unidad' : 'unidades'} en total
            </span>
          </div>

          <div className="mb-4">
            <MovimientosCard rows={movimientos} />
          </div>

          <div className="grid items-start gap-4 lg:grid-cols-2">
            <SummaryCard
              title="🛒 Insumos entregados"
              colLabel="Insumo"
              rows={suppliesSummary}
            />
            <SummaryCard
              title="📦 Productos entregados"
              colLabel="Producto"
              rows={productsSummary}
            />
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Movimientos de insumos: por cada insumo muestra la Carga inicial de la ruta,
 * lo Entregado, los Devueltos vacíos, y el resumen de lo que debería ir en el
 * camión: En ruta (llenos = Carga − Entregados) + los vacíos devueltos.
 */
function MovimientosCard({
  rows,
}: {
  rows: {
    id: string
    name: string
    carga: number
    entregados: number
    devueltos: number
    enRuta: number
  }[]
}) {
  const tot = rows.reduce(
    (a, r) => ({
      carga: a.carga + r.carga,
      entregados: a.entregados + r.entregados,
      devueltos: a.devueltos + r.devueltos,
      enRuta: a.enRuta + r.enRuta,
    }),
    { carga: 0, entregados: 0, devueltos: 0, enRuta: 0 }
  )
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-4 py-3 font-semibold text-slate-900">
        🔄 Movimientos de insumos
        <InfoHint text="Carga: insumos con que salió la ruta. Entregados: los que salieron en los productos entregados. Devueltos vacíos: envases vacíos que el cliente devolvió. En ruta = Carga − Entregados (llenos que deberían quedar en el camión)." />
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-3 text-sm text-slate-500">
          Sin movimientos en el período.
        </p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase text-slate-500">
                  <th className="px-4 py-2 text-left">Insumo</th>
                  <th className="px-3 py-2 text-right">Carga</th>
                  <th className="px-3 py-2 text-right">Entregados</th>
                  <th className="px-3 py-2 text-right">Devueltos vacíos</th>
                  <th className="bg-sky-50 px-3 py-2 text-right text-sky-700">
                    En ruta
                    <span className="block font-normal normal-case text-sky-500">
                      Carga − Entregados
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.id}
                    className="border-b border-slate-100 last:border-0"
                  >
                    <td className="px-4 py-2 text-slate-800">{r.name}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                      {r.carga}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                      {r.entregados}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                      {r.devueltos}
                    </td>
                    <td className="bg-sky-50 px-3 py-2 text-right font-semibold tabular-nums text-sky-800">
                      {r.enRuta}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-slate-200 font-semibold text-slate-900">
                  <td className="px-4 py-2 text-left">Total</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {tot.carga}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {tot.entregados}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {tot.devueltos}
                  </td>
                  <td className="bg-sky-50 px-3 py-2 text-right tabular-nums text-sky-800">
                    {tot.enRuta}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">
            En el camión deberían ir: los <strong>llenos</strong> de la columna
            «En ruta» + los <strong>vacíos</strong> de «Devueltos vacíos».
          </p>
        </>
      )}
    </Card>
  )
}

/** Tabla resumen (insumos o productos) con encabezado y una columna de cantidad. */
function SummaryCard({
  title,
  colLabel,
  rows,
}: {
  title: string
  colLabel: string
  rows: { name: string; qty: number }[]
}) {
  return (
    <Card className="overflow-hidden">
      <div className="border-b border-slate-100 bg-slate-50 px-4 py-3 font-semibold text-slate-900">
        {title}
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-3 text-sm text-slate-500">
          Sin registros en el período.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
                <th className="px-4 py-2">{colLabel}</th>
                <th className="px-4 py-2 text-right">Cantidad entregada</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
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
  )
}
